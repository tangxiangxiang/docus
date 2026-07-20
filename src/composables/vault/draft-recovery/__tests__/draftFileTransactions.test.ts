import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDraftStore,
  createMemoryDraftBackend,
} from '../draftStore'
import type { DraftConflictRecord, UnsavedDraft } from '../draftTypes'
import {
  createUnsavedDraftPersistence,
  type DraftBufferSnapshot,
} from '../useUnsavedDraftPersistence'

function snapshot(
  content: string,
  documentPath = 'notes/a',
  revision = 1,
): DraftBufferSnapshot {
  return {
    vaultId: 'vault',
    documentId: 'doc-a',
    documentPath,
    content,
    authoritativeContent: 'disk',
    baseContentHash: 'base-hash',
    baseModifiedAt: 10.5,
    revision,
    loaded: true,
  }
}

function draft(
  content: string,
  documentPath = 'notes/a',
  updatedAt = 10,
): UnsavedDraft {
  return {
    version: 1,
    vaultId: 'vault',
    documentId: 'doc-a',
    documentPath,
    content,
    baseContentHash: 'base-hash',
    baseModifiedAt: 10.5,
    createdAt: 5,
    updatedAt,
  }
}

describe('draft file transaction integration', () => {
  it('discards an unpersisted debounce snapshot captured at confirmation', async () => {
    vi.useFakeTimers()
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 10,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    persistence.schedule(snapshot('confirmed'))
    const confirmation = persistence.captureDeleteConfirmation(identity, 1)
    const barrier = await persistence.prepareFileMutation([identity])

    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    vi.advanceTimersByTime(800)

    expect(result.status).toBe('missing')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([])
    expect(persistence.captureDeleteConfirmation(identity, 1)).toMatchObject({
      expectedDraft: null,
      expectedSnapshot: null,
    })
    await persistence.dispose()
    vi.useRealTimers()
  })

  it('discards a confirmation-time pending write after it completes', async () => {
    vi.useFakeTimers()
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const originalSave = store.saveDraft.bind(store)
    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    vi.spyOn(store, 'saveDraft').mockImplementation(async (value) => {
      await saveGate
      return originalSave(value)
    })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 10,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    persistence.schedule(snapshot('confirmed'))
    const confirmation = persistence.captureDeleteConfirmation(identity, 1)
    vi.advanceTimersByTime(800)
    const preparing = persistence.prepareFileMutation([identity])
    releaseSave()
    const barrier = await preparing
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    expect(result.status).toBe('deleted')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    await persistence.dispose()
    vi.useRealTimers()
  })

  it('rolls a confirmation snapshot back when the server delete fails', async () => {
    vi.useFakeTimers()
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 10,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    persistence.schedule(snapshot('confirmed'))
    persistence.captureDeleteConfirmation(identity, 1)
    const barrier = await persistence.prepareFileMutation([identity])

    await barrier.rollback()
    await vi.advanceTimersByTimeAsync(800)

    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      documentPath: 'notes/a',
      content: 'confirmed',
    })
    await persistence.dispose()
    vi.useRealTimers()
  })

  it('prefers the coordinator-owned draft over a stale recovery snapshot', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const stale = draft('stale', 'notes/a', 10)
    const current = draft('current', 'notes/a', 20)
    await store.saveDraft(current)
    const persistence = createUnsavedDraftPersistence({
      store,
      targetWindow: undefined,
    })
    await persistence.adoptRecoveredDraft(current, snapshot('current'))
    const confirmation = persistence.captureDeleteConfirmation({
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }, 1, stale)

    expect(confirmation.expectedDraft).toEqual(current)
    await persistence.dispose()
  })

  it('holds edits during a move and writes only the actual server path', async () => {
    vi.useFakeTimers()
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 20,
      targetWindow: undefined,
    })

    persistence.schedule(snapshot('before'))
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    persistence.schedule(snapshot('during-1', 'notes/a', 2))
    persistence.schedule(snapshot('during-2', 'notes/a', 3))

    await vi.advanceTimersByTimeAsync(1_600)
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()

    const [result] = await barrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a-2',
    }])
    await barrier.finalizeAfterTabMigration()

    expect(result.status).toBe('missing')
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      documentPath: 'archive/a-2',
      content: 'during-2',
    })
    await persistence.dispose()
    vi.useRealTimers()
  })

  it('moves an exact persisted draft without changing its timestamps or baseline', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const original = draft('unsaved')
    await store.saveDraft(original)
    const persistence = createUnsavedDraftPersistence({
      store,
      targetWindow: undefined,
    })
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    const [result] = await barrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a-2',
    }])

    expect(result.status).toBe('moved')
    expect(await store.getDraft('vault', 'doc-a')).toEqual({
      ...original,
      documentPath: 'archive/a-2',
    })
    await persistence.dispose()
  })

  it('rolls edits captured during a failed rename back to the old path', async () => {
    vi.useFakeTimers()
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 20,
      targetWindow: undefined,
    })

    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    persistence.schedule(snapshot('latest', 'notes/a', 2))
    await barrier.rollback()
    await vi.advanceTimersByTimeAsync(800)

    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      documentPath: 'notes/a',
      content: 'latest',
    })
    await persistence.dispose()
    vi.useRealTimers()
  })

  it('preserves by default and conditionally deletes only the confirmed draft', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const original = draft('confirmed')
    await store.saveDraft(original)
    const persistence = createUnsavedDraftPersistence({
      store,
      targetWindow: undefined,
    })
    await persistence.adoptRecoveredDraft(original, snapshot('confirmed'))

    const preserved = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    expect((await preserved.commitDeletes([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      policy: 'preserve',
    }]))[0].status).toBe('preserved')
    expect(await store.getDraft('vault', 'doc-a')).toEqual(original)

    const discarded = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    const confirmation = persistence.captureDeleteConfirmation({
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }, 1)
    expect((await discarded.commitDeletes([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      policy: 'discard-confirmed',
      confirmation,
    }]))[0].status).toBe('deleted')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    await persistence.dispose()
  })

  it('preserves edits created after delete confirmation', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 0,
      now: () => 30,
      targetWindow: undefined,
    })
    const owner = persistence.schedule(snapshot('confirmed', 'notes/a', 1))!
    await persistence.flush('vault', 'doc-a')
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    const confirmation = persistence.captureDeleteConfirmation(identity, 1)
    const barrier = await persistence.prepareFileMutation([identity])

    persistence.schedule(snapshot('after-confirmation', 'notes/a', 2))
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    expect(owner.generation).toBe(1)
    expect(result.status).toBe('stale')
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      content: 'after-confirmation',
      documentPath: 'notes/a',
    })
    await persistence.dispose()
  })

  it('keeps move scheduling paused until the tab path migration is finalized', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 0,
      now: () => 40,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    const barrier = await persistence.prepareFileMutation([identity])
    await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/a',
      toPath: 'archive/a-2',
    }])

    // The UI can still emit an old-path snapshot until its tab migration.
    persistence.schedule(snapshot('during-report-gap', 'notes/a', 2))
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()

    await barrier.finalizeAfterTabMigration()
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      content: 'during-report-gap',
      documentPath: 'archive/a-2',
    })
    await persistence.dispose()
  })

  it('persists transaction-time edits at the old path when identity is preserved', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 0,
      now: () => 50,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    const barrier = await persistence.prepareFileMutation([identity])
    persistence.schedule(snapshot('orphan-latest', 'notes/a', 2))

    await barrier.commitMoves([], [identity])
    await barrier.finalizeAfterTabMigration()

    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      content: 'orphan-latest',
      documentPath: 'notes/a',
    })
    await persistence.dispose()
  })

  it('keeps a newer cross-context draft after delete confirmation', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    await store.saveDraft(draft('confirmed', 'notes/a', 10))
    const persistence = createUnsavedDraftPersistence({
      store,
      targetWindow: undefined,
    })
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    await store.saveDraft(draft('newer', 'notes/a', 11))

    const [result] = await barrier.commitDeletes([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      policy: 'discard-confirmed',
    }])

    expect(result.status).toBe('stale')
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      content: 'newer',
    })
    await persistence.dispose()
  })

  it('preserves and persists edits made after delete confirmation', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    await store.saveDraft(draft('confirmed'))
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 20,
      targetWindow: undefined,
    })
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    persistence.schedule(snapshot('after-confirmation', 'notes/a', 2))

    const [result] = await barrier.commitDeletes([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      policy: 'discard-confirmed',
    }])
    await persistence.flush('vault', 'doc-a')

    expect(result.status).toBe('stale')
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      content: 'after-confirmation',
      documentPath: 'notes/a',
    })
    await persistence.dispose()
  })

  it('persists edits captured by a preserve delete as orphan recovery', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 20,
      targetWindow: undefined,
    })
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    persistence.schedule(snapshot('orphan', 'notes/a', 2))
    await barrier.commitDeletes([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      policy: 'preserve',
    }])
    await persistence.flush('vault', 'doc-a')

    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      content: 'orphan',
      documentPath: 'notes/a',
    })
    await persistence.dispose()
  })

  it('settles a barrier only once', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const persistence = createUnsavedDraftPersistence({
      store,
      targetWindow: undefined,
    })
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])

    await barrier.rollback()
    await expect(barrier.commitMoves([])).resolves.toEqual([])
    await expect(barrier.commitDeletes([])).resolves.toEqual([])
    await expect(barrier.rollback()).resolves.toBeUndefined()
    await persistence.dispose()
  })
})

// --- round-2 conditional-delete race regressions --------------------------
//
// The previous round's commitDeletes() did its ownership check
// BEFORE awaiting IndexedDB CAS, but trusted the CAS result
// blindly after the await — leading to three race windows:
//   (a) new local edits during CAS got silently cleared when CAS
//       returned 'deleted'
//   (b) CAS returning 'stale' triggered a fresh-timestamp
//       queueWrite() that could overwrite the cross-context record
//   (c) CAS returning 'missing' for a record that existed at
//       prepare time was indistinguishable from a real missing
//       record, leaving Recovery to silently drop the identity

describe('draft file transactions — post-CAS race regression', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makePersistence(store = createDraftStore({ backend: createMemoryDraftBackend() })) {
    return {
      store,
      persistence: createUnsavedDraftPersistence({
        store,
        debounceMs: 800,
        now: () => 10,
        targetWindow: undefined,
      }),
    }
  }

  it('preserves an edit created while the conditional delete is in flight', async () => {
    // Wire a deferred deleteIfUnchanged so we can mutate the entry
    // (simulate a post-CAS edit) while the IndexedDB CAS is awaiting.
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    let deleteStarted = false
    const originalDelete = backend.deleteIfUnchanged
    backend.deleteIfUnchanged = vi.fn(async (expected) => {
      deleteStarted = true
      await deleteGate
      return originalDelete.call(backend, expected)
    })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 10,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    persistence.schedule(snapshot('rev1', 'notes/a', 1))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const persistedBefore = await store.getDraft('vault', 'doc-a')
    expect(persistedBefore?.content).toBe('rev1')
    const confirmation = persistence.captureDeleteConfirmation(identity, 1)
    expect(confirmation.expectedDraft).not.toBeNull()

    const barrier = await persistence.prepareFileMutation([identity])
    const deleting = barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    // Wait until the CAS has actually started awaiting.
    await vi.waitFor(() => expect(deleteStarted).toBe(true))
    // Simulate the user typing a new edit while CAS is in flight.
    persistence.schedule(snapshot('rev2', 'notes/a', 2))
    // Now release CAS. It must succeed (rev1 matches the stored
    // record), but the post-CAS check sees the entry advanced, so
    // we must NOT clear the entry — instead re-queue rev2.
    releaseDelete()
    const [result] = await deleting
    expect(result.status).toBe('conflict')
    // Let the post-CAS write of rev2 land.
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const stored = await store.getDraft('vault', 'doc-a')
    expect(stored?.content).toBe('rev2')
    await persistence.dispose()
  })

  it('does not overwrite a cross-context draft after conditional delete returns stale', async () => {
    // Wire a deferred deleteIfUnchanged so we can mutate the entry
    // (simulate a post-CAS edit that pushes latestSnapshotNeedsWrite=true)
    // while the IndexedDB CAS is awaiting a newer cross-context record.
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    let deleteStarted = false
    const originalDelete = backend.deleteIfUnchanged
    backend.deleteIfUnchanged = vi.fn(async (expected) => {
      deleteStarted = true
      await deleteGate
      return originalDelete.call(backend, expected)
    })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 100,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    // Local session has v2 with the latestSnapshot revision we'll
    // confirm for delete.
    persistence.schedule(snapshot('local-v2', 'notes/a', 2))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const localStored = await store.getDraft('vault', 'doc-a')
    expect(localStored?.content).toBe('local-v2')
    expect(localStored?.updatedAt).toBe(100)
    // Another context seeds v3 with a NEWER updatedAt. The CAS
    // will see the newer record and return 'stale'.
    await backend.seedRaw({
      version: 1,
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'remote-v3',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 110,
    })
    const confirmation = persistence.captureDeleteConfirmation(identity, 2)
    const barrier = await persistence.prepareFileMutation([identity])
    const deleting = barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    // Wait until the CAS is awaiting.
    await vi.waitFor(() => expect(deleteStarted).toBe(true))
    // User typed a new edit during CAS — entry generation / snapshot
    // advance and latestSnapshotNeedsWrite flips to true.
    persistence.schedule(snapshot('local-v3', 'notes/a', 3))
    releaseDelete()
    const [result] = await deleting

    expect(result.status).toBe('conflict')
    // IndexedDB must still hold the cross-context record — the fix
    // path does NOT call queueWrite() with a fresh timestamp when
    // CAS returned stale, even with a post-CAS local edit.
    await vi.advanceTimersByTimeAsync(2000)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const stored = await store.getDraft('vault', 'doc-a')
    expect(stored?.content).toBe('remote-v3')
    expect(stored?.updatedAt).toBe(110)
    // The local post-CAS edit was promoted to a separate conflict
    // record so the user can still see both candidates in Recovery
    // — the primary draft keeps the cross-context source, the
    // conflict record keeps the local orphan.
    const conflicts = await store.listConflictDrafts('vault')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.content).toBe('local-v3')
    expect(conflicts[0]?.origin).toBe('delete-conflict')
    expect(conflicts[0]?.crossContextUpdatedAt).toBe(110)
    expect(conflicts[0]?.vaultId).toBe('vault')
    expect(conflicts[0]?.documentId).toBe('doc-a')
    await persistence.dispose()
  })

  it('does not overwrite the cross-context draft during dispose (pagehide simulation)', async () => {
    // Regression: after a stale + post-CAS edit, the entry's
    // pendingConflictId is set. dispose() (called on pagehide or
    // unmount) runs flushAllInternal — that path MUST skip the
    // conflict-pinned entry, otherwise safeTimestamp() would mint a
    // fresh updatedAt > 110 and overwrite the cross-context record.
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    let deleteStarted = false
    const originalDelete = backend.deleteIfUnchanged
    backend.deleteIfUnchanged = vi.fn(async (expected) => {
      deleteStarted = true
      await deleteGate
      return originalDelete.call(backend, expected)
    })
    const targetWindow = new EventTarget()
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 100,
      targetWindow: targetWindow as unknown as Pick<
        Window,
        'addEventListener' | 'removeEventListener'
      >,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    // Pre-persist a local draft so the CAS path runs (an empty
    // expected would short-circuit to `missing` without calling
    // deleteIfUnchanged).
    persistence.schedule(snapshot('local-v2', 'notes/a', 2))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const localStored = await store.getDraft('vault', 'doc-a')
    expect(localStored?.content).toBe('local-v2')
    expect(localStored?.updatedAt).toBe(100)
    // Another context seeds v3 with a NEWER updatedAt.
    await backend.seedRaw({
      version: 1,
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'remote-v3',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 110,
    })
    const confirmation = persistence.captureDeleteConfirmation(identity, 2)
    const barrier = await persistence.prepareFileMutation([identity])
    const deleting = barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    await vi.waitFor(() => expect(deleteStarted).toBe(true))
    persistence.schedule(snapshot('local-v3', 'notes/a', 3))
    releaseDelete()
    await deleting

    targetWindow.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')

    // dispose() must likewise NOT overwrite the cross-context record
    // with a fresh timestamp.
    await persistence.dispose()
    const stored = await store.getDraft('vault', 'doc-a')
    expect(stored?.content).toBe('remote-v3')
    expect(stored?.updatedAt).toBe(110)
  })

  it('does not retry the confirmed snapshot with a newer timestamp after stale (no post-CAS edit)', async () => {
    // No post-CAS edit: latestSnapshotNeedsWrite stays false, so
    // the stale branch must not produce ANY IndexedDB write. Even
    // though `releaseEntry(writeLatest=true)` would no-op here, the
    // test pins the contract so a future refactor doesn't
    // accidentally bypass that guard.
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 100,
      targetWindow: undefined,
    })
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    persistence.schedule(snapshot('local', 'notes/a', 1))
    await backend.seedRaw({
      version: 1,
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'cross-context',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 200,
    })
    const confirmation = persistence.captureDeleteConfirmation(identity, 1)
    const barrier = await persistence.prepareFileMutation([identity])
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    expect(result.status).toBe('stale')
    await vi.advanceTimersByTimeAsync(2000)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const stored = await store.getDraft('vault', 'doc-a')
    expect(stored?.content).toBe('cross-context')
    expect(stored?.updatedAt).toBe(200)
    await persistence.dispose()
  })

  it('reports stale (not missing) when CAS finds no record but prepare saw one', async () => {
    // Refinement of the medium issue: confirmedDraft was non-null
    // at prepareFileMutation, but the IndexedDB record vanished
    // before CAS ran. Surface as 'stale' so the UI can refresh
    // Recovery instead of silently dropping the identity.
    const { store, persistence } = makePersistence()
    const identity = {
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }
    // Schedule a snapshot so the entry has a latestSnapshot, then
    // seed a matching IndexedDB record, then let the debounce write.
    persistence.schedule(snapshot('seeded', 'notes/a', 1))
    await vi.advanceTimersByTimeAsync(800)
    // Let the queueWrite microtask chain run to completion so
    // entry.persistedDraft is populated.
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const persistedAfter = await store.getDraft('vault', 'doc-a')
    expect(persistedAfter?.content).toBe('seeded')
    const confirmation = persistence.captureDeleteConfirmation(identity, 1)
    expect(confirmation.expectedDraft?.content).toBe('seeded')
    // Delete the IndexedDB record between capture and prepare.
    await store.deleteDraft('vault', 'doc-a')
    const barrier = await persistence.prepareFileMutation([identity])
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    // The IndexedDB record vanished — but at prepare time the store
    // getDraft() populated confirmedDraft, so the refined outcome
    // must be 'stale' (refresh Recovery) rather than 'missing'
    // (drop the identity silently).
    expect(result.status).toBe('stale')
    await persistence.dispose()
  })
})

// --- conflict handoff atomicity & conflict channel -------------------------
//
// These cover the round-3/round-4/round-5 findings: the conflict handoff
// is bounded to TWO saves — it persists the current snapshot, and an
// edit typed during that save is persisted as the latest snapshot by a
// second immediate attempt, so the transaction never reports success
// while the newest bytes are still only in-memory; yet a steady typer
// cannot keep the file transaction open on a moving target — after two
// attempts the handoff fails closed (tab kept open, conflict debounce
// armed for a background retry). Immediate orphan writes on the delete
// paths are observed: a rejected write maps to 'failed' (never
// preserved / stale / conflict) so the lifecycle keeps the tab open.
// Edits made after conflict mode is entered must stay on the conflict
// channel (never overwrite the cross-context primary); conflict records
// must follow renames as one pre-flight-validated family; a confirmed
// delete must remove the conflict records frozen at confirmation time,
// hold its transaction until that cleanup and the final re-verification
// complete (an edit typed during the cleanup is persisted as a conflict
// BEFORE anything reports deleted), treat an unread conflict store as
// failed, and treat an unreadable same-identity survivor row as
// unsupported rather than an empty list.

describe('draft file transactions — conflict handoff & channel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const identity = {
    vaultId: 'vault',
    documentId: 'doc-a',
    documentPath: 'notes/a',
  }

  function remoteV3() {
    return {
      version: 1 as const,
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'remote-v3',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 110,
    }
  }

  function gatedStore() {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    let deleteStarted = false
    const originalDelete = backend.deleteIfUnchanged
    backend.deleteIfUnchanged = vi.fn(async (expected) => {
      deleteStarted = true
      await deleteGate
      return originalDelete.call(backend, expected)
    })
    return {
      backend,
      store,
      releaseDelete: () => releaseDelete(),
      waitDeleteStarted: () => vi.waitFor(() => expect(deleteStarted).toBe(true)),
    }
  }

  function makePersistence(store: ReturnType<typeof createDraftStore>, targetWindow?: EventTarget) {
    return createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 100,
      targetWindow: targetWindow as unknown as Pick<
        Window,
        'addEventListener' | 'removeEventListener'
      > | undefined,
    })
  }

  // Drive the entry to the stale + post-CAS-edit branch: persist local-v2,
  // seed a newer cross-context remote-v3, confirm delete, then land local-v3
  // while the CAS is in flight. Returns the in-flight commitDeletes promise
  // wrapped in an object — returning the bare promise from an async helper
  // would make `await enterConflictHandoff(...)` block until commitDeletes
  // settles, deadlocking any test that gates the conflict save mid-flight.
  async function enterConflictHandoff(
    persistence: ReturnType<typeof makePersistence>,
    store: ReturnType<typeof createDraftStore>,
    backend: ReturnType<typeof createMemoryDraftBackend>,
    gate: ReturnType<typeof gatedStore>,
  ) {
    persistence.schedule(snapshot('local-v2', 'notes/a', 2))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('local-v2')
    await backend.seedRaw(remoteV3())
    const confirmation = persistence.captureDeleteConfirmation(identity, 2)
    const barrier = await persistence.prepareFileMutation([identity])
    const deleting = barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    await gate.waitDeleteStarted()
    persistence.schedule(snapshot('local-v3', 'notes/a', 3))
    gate.releaseDelete()
    return { deleting }
  }

  it('persists an edit typed during the conflict save with a bounded second attempt', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    // Gate only the FIRST conflict save so we can land local-v4 mid-save.
    let conflictCalls = 0
    let releaseConflict!: () => void
    const conflictGate = new Promise<void>((resolve) => { releaseConflict = resolve })
    const originalSaveConflict = store.saveConflictDraft.bind(store)
    vi.spyOn(store, 'saveConflictDraft').mockImplementation(async (record) => {
      conflictCalls += 1
      if (conflictCalls === 1) await conflictGate
      return originalSaveConflict(record)
    })
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    // First conflict save (local-v3) is now awaiting the gate.
    await vi.waitFor(() => expect(conflictCalls).toBe(1))
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    releaseConflict()
    const [result] = await deleting

    expect(result.status).toBe('conflict')
    // Primary keeps the cross-context record.
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    // The handoff is BOUNDED but OBSERVABLE: exactly two conflict saves
    // ran inside the file transaction — attempt 1 persisted local-v3,
    // and the mid-save edit triggered attempt 2, which persisted the
    // NEW latest snapshot (local-v4) BEFORE the transaction reported.
    // The old single-save path reported 'conflict' here with local-v4
    // still pending in an 800ms debounce: if that save later failed,
    // the tab was already closed and the bytes were lost.
    expect(conflictCalls).toBe(2)
    const contents = (await store.listConflictDrafts('vault'))
      .map((conflict) => conflict.content)
      .sort()
    expect(contents).toEqual(['local-v3', 'local-v4'])
    // The latest snapshot was verified durable inside the transaction —
    // nothing is left tracked in memory for the lifecycle to lose.
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([])
    // And the primary was never touched by either write.
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    await persistence.dispose()
  })

  it('reports failed when the latest conflict save fails on the second attempt', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    // Attempt 1 succeeds (after the gate); attempt 2 — the save that
    // covers the mid-save edit — is rejected by the store.
    let conflictCalls = 0
    let releaseConflict!: () => void
    const conflictGate = new Promise<void>((resolve) => { releaseConflict = resolve })
    const originalSaveConflict = store.saveConflictDraft.bind(store)
    const saveConflict = vi.spyOn(store, 'saveConflictDraft')
      .mockImplementation(async (record) => {
        conflictCalls += 1
        if (conflictCalls === 1) {
          await conflictGate
          return originalSaveConflict(record)
        }
        if (conflictCalls === 2) return { status: 'failed' }
        return originalSaveConflict(record)
      })
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    await vi.waitFor(() => expect(conflictCalls).toBe(1))
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    releaseConflict()
    const [result] = await deleting

    // Attempt 2 failed, so local-v4 is still only in-memory: the
    // transaction must NOT report 'conflict' (the lifecycle would close
    // the tab on it) — 'failed' keeps the tab open as the only visible
    // surface holding local-v4.
    expect(result.status).toBe('failed')
    expect(conflictCalls).toBe(2)
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    expect((await store.listConflictDrafts('vault')).map((c) => c.content))
      .toEqual(['local-v3'])
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    // The release armed the conflict debounce: once the store
    // recovers, the background retry persists local-v4 without any
    // further user action — the failed delete still converges.
    saveConflict.mockRestore()
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
      .toEqual(['local-v3', 'local-v4'])
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    await persistence.dispose()
  })

  it('reports failed when edits keep landing across both bounded attempts', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    // Gate BOTH in-transaction saves so an edit lands during each —
    // the handoff must terminate after two attempts instead of chasing
    // a moving target indefinitely.
    let conflictCalls = 0
    const gates: Array<() => void> = []
    const originalSaveConflict = store.saveConflictDraft.bind(store)
    vi.spyOn(store, 'saveConflictDraft').mockImplementation(async (record) => {
      const callIndex = conflictCalls
      conflictCalls += 1
      if (callIndex <= 1) {
        await new Promise<void>((resolve) => { gates[callIndex] = resolve })
      }
      return originalSaveConflict(record)
    })
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    // local-v4 lands during attempt 1 → triggers attempt 2.
    await vi.waitFor(() => expect(conflictCalls).toBe(1))
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    gates[0]!()
    // local-v5 lands during attempt 2 → the handoff must fail closed
    // instead of starting an attempt 3.
    await vi.waitFor(() => expect(conflictCalls).toBe(2))
    persistence.schedule(snapshot('local-v5', 'notes/a', 5))
    gates[1]!()
    const [result] = await deleting

    expect(result.status).toBe('failed')
    // Bounded: exactly two saves inside the transaction, no matter how
    // fast the user keeps typing — the mutation lock / tab / tree must
    // not wait on a moving target.
    expect(conflictCalls).toBe(2)
    // Both saved candidates are durable; local-v5 is not (yet).
    expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
      .toEqual(['local-v3', 'local-v4'])
    // 'failed' keeps the tab open — the only surface holding local-v5 —
    // while the armed conflict debounce retries it in the background.
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
      .toEqual(['local-v3', 'local-v4', 'local-v5'])
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    await persistence.dispose()
  })

  it('reports failed and keeps the content visible when the conflict save fails', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    vi.spyOn(store, 'saveConflictDraft').mockResolvedValue({ status: 'failed' })
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    const [result] = await deleting

    // A failed handoff surfaces as 'failed' so the lifecycle keeps the
    // tab open (the only surface still holding the bytes).
    expect(result.status).toBe('failed')
    // Primary untouched.
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    // No conflict record was written...
    expect(await store.listConflictDrafts('vault')).toEqual([])
    // ...but the local content is still held in memory, not dropped.
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    // Flushing must not overwrite the primary either (conflict channel).
    await persistence.flush('vault', 'doc-a')
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    await persistence.dispose()
  })

  it('routes post-conflict edits to the conflict channel, never the primary', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    const [result] = await deleting
    expect(result.status).toBe('conflict')

    // The entry is now conflict-pinned. The user types again before the
    // tab closes — this must NOT revert to a primary write.
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()

    const stored = await store.getDraft('vault', 'doc-a')
    expect(stored?.content).toBe('remote-v3')
    expect(stored?.updatedAt).toBe(110)
    const contents = (await store.listConflictDrafts('vault'))
      .map((conflict) => conflict.content)
      .sort()
    expect(contents).toEqual(['local-v3', 'local-v4'])
    await persistence.dispose()
  })

  it('keeps both candidates across pagehide and dispose', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const targetWindow = new EventTarget()
    const persistence = makePersistence(store, targetWindow)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    await deleting

    targetWindow.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    await Promise.resolve()
    await persistence.dispose()

    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    expect((await store.listConflictDrafts('vault')).map((c) => c.content))
      .toEqual(['local-v3'])
  })

  it('flushes a pending conflict-channel edit on pagehide', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const targetWindow = new EventTarget()
    const persistence = makePersistence(store, targetWindow)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    await deleting
    // The entry is conflict-pinned with local-v3 persisted. The user
    // types again and pagehide fires BEFORE the debounce timer elapses
    // — the edit is still only in-memory. flushAll must route it to
    // the conflict channel instead of skipping it (which would drop
    // bytes that live in neither store).
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    targetWindow.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(async () => {
      expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
        .toEqual(['local-v3', 'local-v4'])
    })
    await persistence.dispose()
  })

  it('flushes a pending conflict-channel edit on dispose', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    await deleting
    // Same data-loss window as pagehide, hit through dispose (tab
    // unmount / vault switch) before the debounce timer elapses.
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    await persistence.dispose()
    expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
      .toEqual(['local-v3', 'local-v4'])
  })

  it('does not overwrite the primary while flushing the conflict channel', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const targetWindow = new EventTarget()
    const persistence = makePersistence(store, targetWindow)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    await deleting
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    // Flush the pending conflict-channel edit through pagehide, then
    // dispose: the flush must persist the edit as a conflict candidate
    // and never mint a fresh primary timestamp that overwrites the
    // cross-context record.
    targetWindow.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(async () => {
      expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
        .toEqual(['local-v3', 'local-v4'])
    })
    await persistence.dispose()
    const stored = await store.getDraft('vault', 'doc-a')
    expect(stored?.content).toBe('remote-v3')
    expect(stored?.updatedAt).toBe(110)
  })

  it('keeps failed local bytes visible after folder delete and dispose', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    // Every conflict save fails during the delete transaction — the
    // handoff cannot persist the local bytes and reports 'failed' (a
    // folder delete keeps this path's tab open on that result).
    const saveConflict = vi.spyOn(store, 'saveConflictDraft')
      .mockResolvedValue({ status: 'failed' })
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    const [result] = await deleting
    expect(result.status).toBe('failed')
    expect(await store.listConflictDrafts('vault')).toEqual([])
    // The bytes are still only in-memory. Once the store recovers,
    // dispose (the unmount that follows the failed delete) must retry
    // the conflict write instead of dropping them.
    saveConflict.mockRestore()
    await persistence.dispose()
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    expect((await store.listConflictDrafts('vault')).map((c) => c.content))
      .toEqual(['local-v3'])
  })

  it('reports failed instead of preserved when the immediate orphan write fails', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    const barrier = await persistence.prepareFileMutation([identity])
    persistence.schedule(snapshot('orphan', 'notes/a', 2))
    // The server file is deleted, and the preserve path must write the
    // pending snapshot as an orphan IMMEDIATELY — but IndexedDB
    // rejects the write.
    backend.failNext('save')
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'preserve',
    }])

    // The snapshot is still only in-memory: 'failed' (not 'preserved')
    // keeps the tab open — it is the only surface holding these bytes.
    expect(result.status).toBe('failed')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    await persistence.dispose()
  })

  it('reports failed instead of conflict when the post-CAS orphan write fails', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const persistence = makePersistence(store)
    persistence.schedule(snapshot('local-v2', 'notes/a', 2))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('local-v2')
    const confirmation = persistence.captureDeleteConfirmation(identity, 2)
    const barrier = await persistence.prepareFileMutation([identity])
    // The immediate orphan write of the post-CAS edit will be rejected.
    backend.failNext('save')
    const deleting = barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    await gate.waitDeleteStarted()
    // CAS succeeds on the confirmed record, but this edit lands while
    // the CAS is in flight — the post-CAS branch re-queues it as a new
    // orphan immediately.
    persistence.schedule(snapshot('local-v3', 'notes/a', 3))
    gate.releaseDelete()
    const [result] = await deleting

    // The orphan write failed, so the new edit is still only in-memory:
    // 'failed' (not 'conflict') keeps the tab open.
    expect(result.status).toBe('failed')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    await persistence.dispose()
  })

  it('reports failed instead of stale when the confirmation-mismatch orphan write fails', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    persistence.schedule(snapshot('confirmed', 'notes/a', 1))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    const confirmation = persistence.captureDeleteConfirmation(identity, 1)
    const barrier = await persistence.prepareFileMutation([identity])
    // A newer snapshot than the confirmation's — the stale branch
    // re-queues it as an orphan immediately.
    persistence.schedule(snapshot('after-confirmation', 'notes/a', 2))
    backend.failNext('save')
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    // The immediate write failed — the newer snapshot is still only
    // in-memory: 'failed' (not 'stale') keeps the tab open.
    expect(result.status).toBe('failed')
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    await persistence.dispose()
  })

  it('reports unsupported when an unreadable conflict row survives the confirmed delete', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const original = draft('confirmed')
    await store.saveDraft(original)
    // A future-version conflict row for the SAME identity, seeded
    // behind the store's validation. The UI could never see it, so it
    // was never frozen at confirmation — it always survives the
    // frozen-cleanup deletes.
    await backend.seedRawConflict({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'future data',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    const persistence = createUnsavedDraftPersistence({ store, targetWindow: undefined })
    await persistence.adoptRecoveredDraft(original, snapshot('confirmed'))
    const confirmation = persistence.captureDeleteConfirmation(identity, 1, null, [])
    const barrier = await persistence.prepareFileMutation([identity])
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    // The strict survivor read sees the unreadable same-identity row
    // and refuses to certify a clean delete: 'unsupported' keeps the
    // Recovery identity visible (and warns) instead of removeIdentity()
    // outliving a row the store could not read.
    expect(result.status).toBe('unsupported')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    expect(await backend.listConflicts('vault')).toHaveLength(1)
    await persistence.dispose()
  })

  it('moves conflict record paths along with the primary draft on rename', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    await store.saveDraft(draft('primary', 'notes/a', 10))
    await store.saveConflictDraft({
      version: 1,
      conflictId: 'conflict-a',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'local orphan',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    const persistence = createUnsavedDraftPersistence({ store, targetWindow: undefined })
    const barrier = await persistence.prepareFileMutation([identity])
    const [result] = await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/a',
      toPath: 'archive/a',
    }])

    expect(result.status).toBe('moved')
    expect((await store.getDraft('vault', 'doc-a'))?.documentPath).toBe('archive/a')
    const conflicts = await store.listConflictDrafts('vault')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      conflictId: 'conflict-a',
      documentPath: 'archive/a',
      content: 'local orphan',
      origin: 'delete-conflict',
    })
    await persistence.dispose()
  })

  it('reports a failed rename when the family move cannot migrate conflicts', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    await store.saveDraft(draft('primary', 'notes/a', 10))
    await store.saveConflictDraft({
      version: 1,
      conflictId: 'conflict-a',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'local orphan',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    backend.failNext('moveFamilyConflicts')
    const persistence = createUnsavedDraftPersistence({ store, targetWindow: undefined })
    const barrier = await persistence.prepareFileMutation([identity])
    const [result] = await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/a',
      toPath: 'archive/a',
    }])

    // The family move fails as a unit: no split state where the primary
    // is renamed while conflicts are stranded on the pre-rename path,
    // and no silent 'moved' — reportDraftResults turns 'failed' into a
    // user-visible warning and Recovery refreshes the identity.
    expect(result.status).toBe('failed')
    expect((await store.getDraft('vault', 'doc-a'))?.documentPath).toBe('notes/a')
    expect((await store.listConflictDrafts('vault')).map((c) => c.documentPath))
      .toEqual(['notes/a'])
    await persistence.dispose()
  })

  it('removes the conflict records frozen at confirmation on a conflict-only delete', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    await store.saveConflictDraft({
      version: 1,
      conflictId: 'conflict-a',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'local orphan',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    const persistence = createUnsavedDraftPersistence({ store, targetWindow: undefined })
    // No primary record, no in-memory snapshot: freeze the conflict id
    // directly, as the UI does from its discovered recovery items.
    const confirmation = persistence.captureDeleteConfirmation(identity, 0, null, ['conflict-a'])
    expect(confirmation.expectedConflictIds).toEqual(['conflict-a'])
    const barrier = await persistence.prepareFileMutation([identity])
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    expect(result.status).toBe('missing')
    expect(await store.listConflictDrafts('vault')).toEqual([])
    await persistence.dispose()
  })

  it('reports failed when a frozen conflict delete fails instead of full success', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const original = draft('confirmed')
    await store.saveDraft(original)
    await store.saveConflictDraft({
      version: 1,
      conflictId: 'conflict-a',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'local orphan',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    const persistence = createUnsavedDraftPersistence({ store, targetWindow: undefined })
    await persistence.adoptRecoveredDraft(original, snapshot('confirmed'))
    const confirmation = persistence.captureDeleteConfirmation(identity, 1, null, ['conflict-a'])
    const barrier = await persistence.prepareFileMutation([identity])
    backend.failNext('deleteConflict')
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    // The primary CAS succeeded, but the frozen conflict delete hit a
    // store error — the row survives. Reporting full success ('deleted')
    // would make the UI remove the identity and close its tabs, hiding
    // the survivor until the next refresh. Fail closed: 'failed' keeps
    // the identity visible via refreshIdentity and warns the user.
    expect(result.status).toBe('failed')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    expect((await store.listConflictDrafts('vault')).map((c) => c.conflictId))
      .toEqual(['conflict-a'])
    await persistence.dispose()
  })

  it('persists a cleanup-window edit as a conflict before reporting the delete', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const original = draft('confirmed')
    await store.saveDraft(original)
    await store.saveConflictDraft({
      version: 1,
      conflictId: 'conflict-a',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'local orphan',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    const persistence = createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 100,
      targetWindow: undefined,
    })
    await persistence.adoptRecoveredDraft(original, snapshot('confirmed'))
    const confirmation = persistence.captureDeleteConfirmation(identity, 1, null, ['conflict-a'])
    const barrier = await persistence.prepareFileMutation([identity])
    // Gate the frozen conflict delete to open the cleanup window AFTER
    // the primary CAS has already succeeded — the deferred
    // deleteConflictDraft() is the window an earlier revision missed
    // (it released the file transaction before the cleanup ran).
    let conflictDeleteStarted = false
    let releaseConflictDelete!: () => void
    const conflictDeleteGate = new Promise<void>((resolve) => { releaseConflictDelete = resolve })
    const originalDeleteConflict = store.deleteConflictDraft.bind(store)
    vi.spyOn(store, 'deleteConflictDraft')
      .mockImplementation(async (vaultId, documentId, conflictId) => {
        conflictDeleteStarted = true
        await conflictDeleteGate
        return originalDeleteConflict(vaultId, documentId, conflictId)
      })
    const deleting = barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    await vi.waitFor(() => expect(conflictDeleteStarted).toBe(true))
    // The user types while the frozen conflicts are being deleted.
    persistence.schedule(snapshot('cleanup-edit', 'notes/a', 2))
    // The file transaction must still be held: no primary debounce may
    // fire during the cleanup window. The old code released the
    // transaction up front, armed a primary write here, and could close
    // the tab before it fired — losing bytes that existed only in
    // coordinator memory while the identity was already reported
    // deleted.
    await vi.advanceTimersByTimeAsync(5000)
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    releaseConflictDelete()
    const [result] = await deleting

    // The cleanup-window edit was persisted as a conflict candidate
    // BEFORE the transaction reported — never an unpersisted orphan
    // behind a 'deleted' result. The frozen row was removed.
    expect(result.status).toBe('conflict')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    expect((await store.listConflictDrafts('vault')).map((c) => c.content))
      .toEqual(['cleanup-edit'])
    // The primary channel was never armed for the cleanup-window edit.
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([])
    await persistence.dispose()
  })

  it('reports failed when the surviving conflict list cannot be read', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const original = draft('confirmed')
    await store.saveDraft(original)
    await store.saveConflictDraft({
      version: 1,
      conflictId: 'conflict-a',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'local orphan',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    const persistence = createUnsavedDraftPersistence({ store, targetWindow: undefined })
    await persistence.adoptRecoveredDraft(original, snapshot('confirmed'))
    const confirmation = persistence.captureDeleteConfirmation(identity, 1, null, ['conflict-a'])
    const barrier = await persistence.prepareFileMutation([identity])
    // The frozen delete succeeds, but the survivor read that follows
    // hits a store error — commitDeletes must fail closed instead of
    // falling back to "no survivors" and reporting a full delete.
    backend.failNext('listConflicts')
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    expect(result.status).toBe('failed')
    expect(await store.getDraft('vault', 'doc-a')).toBeNull()
    expect((await store.listConflictDrafts('vault')).map((c) => c.conflictId))
      .toEqual([])
    await persistence.dispose()
  })

  it('does not remove conflicts recorded after the confirmation was captured', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    const frozen: DraftConflictRecord = {
      version: 1,
      conflictId: 'conflict-frozen',
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'frozen',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    }
    await store.saveConflictDraft(frozen)
    const persistence = createUnsavedDraftPersistence({ store, targetWindow: undefined })
    // Only 'conflict-frozen' is frozen. A later conflict appears in the
    // store before the transaction commits but was never confirmed.
    const confirmation = persistence.captureDeleteConfirmation(identity, 0, null, ['conflict-frozen'])
    await store.saveConflictDraft({ ...frozen, conflictId: 'conflict-late', content: 'late', updatedAt: 32, recordedAt: 32 })
    const barrier = await persistence.prepareFileMutation([identity])
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])

    const remaining = (await store.listConflictDrafts('vault')).map((c) => c.conflictId)
    expect(remaining).toEqual(['conflict-late'])
    // The surviving post-confirmation candidate must keep the identity
    // visible: 'conflict' (not 'missing') makes the UI refresh the
    // identity instead of removing it wholesale and closing its tabs.
    expect(result.status).toBe('conflict')
    await persistence.dispose()
  })
})

// The delete transaction releases every entry when it reports, but the
// lifecycle still awaits Recovery synchronization before closing tabs.
// An edit typed during that settlement window arms a fresh debounce
// (the file transaction is already gone) that the tab close could
// outrun — if that write later failed, the bytes would exist nowhere
// visible. finalizeBeforeDocumentClose() seals the window: it persists
// anything still pending IMMEDIATELY (on the entry's active channel)
// and reports 'failed' when the write is rejected, so the lifecycle
// keeps that tab open. finalizeAfterTabMigration() must likewise
// OBSERVE its immediate post-rename writes: a rejected write reports
// 'failed' (with the actual server-suffixed newPath) so the lifecycle
// can warn — the server rename stays successful, but a silent success
// would hide a transaction-time edit that never reached the store.

describe('draft file transactions — UI commit boundary sealing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const identity = {
    vaultId: 'vault',
    documentId: 'doc-a',
    documentPath: 'notes/a',
  }

  function remoteV3() {
    return {
      version: 1 as const,
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'remote-v3',
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 110,
    }
  }

  function gatedStore() {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve })
    let deleteStarted = false
    const originalDelete = backend.deleteIfUnchanged
    backend.deleteIfUnchanged = vi.fn(async (expected) => {
      deleteStarted = true
      await deleteGate
      return originalDelete.call(backend, expected)
    })
    return {
      backend,
      store,
      releaseDelete: () => releaseDelete(),
      waitDeleteStarted: () => vi.waitFor(() => expect(deleteStarted).toBe(true)),
    }
  }

  function makePersistence(
    store: ReturnType<typeof createDraftStore>,
    targetWindow?: EventTarget,
  ) {
    return createUnsavedDraftPersistence({
      store,
      debounceMs: 800,
      now: () => 100,
      targetWindow,
    })
  }

  // Drive the entry to the stale + post-CAS-edit branch and resolve the
  // handoff: persist local-v2, seed newer remote-v3, confirm, land
  // local-v3 while the CAS awaits, release. With conflict saves healthy
  // this settles to a stable 'conflict' (entry pinned to the conflict
  // channel, snapshot promoted); with conflict saves mocked to fail it
  // settles to 'failed'. Returns the in-flight commitDeletes promise
  // plus the barrier so tests can run the finalize gate afterwards.
  async function enterConflictHandoff(
    persistence: ReturnType<typeof makePersistence>,
    store: ReturnType<typeof createDraftStore>,
    backend: ReturnType<typeof createMemoryDraftBackend>,
    gate: ReturnType<typeof gatedStore>,
  ) {
    persistence.schedule(snapshot('local-v2', 'notes/a', 2))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('local-v2')
    await backend.seedRaw(remoteV3())
    const confirmation = persistence.captureDeleteConfirmation(identity, 2)
    const barrier = await persistence.prepareFileMutation([identity])
    const deleting = barrier.commitDeletes([{
      ...identity,
      policy: 'discard-confirmed',
      confirmation,
    }])
    await gate.waitDeleteStarted()
    persistence.schedule(snapshot('local-v3', 'notes/a', 3))
    gate.releaseDelete()
    return { deleting, barrier }
  }

  it('preserves an edit typed while recovery settlement is pending', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    const saveDraft = vi.spyOn(store, 'saveDraft')
    const barrier = await persistence.prepareFileMutation([identity])
    persistence.schedule(snapshot('orphan', 'notes/a', 2))
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'preserve',
    }])
    expect(result.status).toBe('preserved')
    // The transaction has released the entry; the lifecycle now awaits
    // Recovery synchronization. An edit typed during that window arms a
    // fresh 800ms debounce — the file transaction no longer holds it.
    persistence.schedule(snapshot('settlement-edit', 'notes/a', 3))

    // finalizeBeforeDocumentClose must persist it IMMEDIATELY (not let
    // the debounce race the imminent tab close) and clear the armed
    // timer.
    const finalizeResults = await barrier.finalizeBeforeDocumentClose()
    // The successful settlement write is reported (non-warning) so the
    // lifecycle's second sync refreshes the Recovery identity to the
    // new content instead of keeping the pre-window record.
    expect(finalizeResults).toEqual([{
      documentId: 'doc-a',
      oldPath: 'notes/a',
      status: 'preserved',
    }])
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('settlement-edit')
    expect(saveDraft).toHaveBeenCalledTimes(2)
    // After the tab closes, no draft timer may fire: advancing the
    // clock produces no further write — the window timer was cleared,
    // not left armed behind a closed tab.
    await vi.advanceTimersByTimeAsync(2400)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect(saveDraft).toHaveBeenCalledTimes(2)
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('settlement-edit')
    await persistence.dispose()
  })

  it('reports failed when the final pre-close persistence fails', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    const barrier = await persistence.prepareFileMutation([identity])
    persistence.schedule(snapshot('orphan', 'notes/a', 2))
    const [result] = await barrier.commitDeletes([{
      ...identity,
      policy: 'preserve',
    }])
    expect(result.status).toBe('preserved')
    persistence.schedule(snapshot('settlement-edit', 'notes/a', 3))
    // IndexedDB rejects the settlement-window write.
    backend.failNext('save')
    const finalizeResults = await barrier.finalizeBeforeDocumentClose()

    // The settlement edit is still only in-memory: 'failed' keeps the
    // tab open — it is the only surface still holding those bytes.
    expect(finalizeResults).toEqual([{
      documentId: 'doc-a',
      oldPath: 'notes/a',
      status: 'failed',
    }])
    expect(persistence.findTrackedIdentitiesByPaths(['notes/a'])).toEqual([identity])
    await persistence.dispose()
  })

  it('persists a conflict-channel edit typed during settlement before closing', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const persistence = makePersistence(store)
    const { deleting, barrier } = await enterConflictHandoff(persistence, store, backend, gate)
    const [result] = await deleting
    expect(result.status).toBe('conflict')
    // The entry is pinned to the conflict channel (local-v3 promoted,
    // snapshot dropped). The user types during Recovery synchronization
    // — the edit arms a conflict-channel debounce.
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))

    const finalizeResults = await barrier.finalizeBeforeDocumentClose()
    // Successful conflict-channel write → non-warning 'preserved' for
    // the post-close Recovery refresh.
    expect(finalizeResults).toEqual([{
      documentId: 'doc-a',
      oldPath: 'notes/a',
      status: 'preserved',
    }])
    // Persisted as a conflict record IMMEDIATELY — never the primary
    // store (the cross-context record must not be overwritten).
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
      .toEqual(['local-v3', 'local-v4'])
    // The window timer was cleared: no further conflict write fires
    // after the tab closes.
    await vi.advanceTimersByTimeAsync(2400)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.listConflictDrafts('vault')).map((c) => c.content).sort())
      .toEqual(['local-v3', 'local-v4'])
    await persistence.dispose()
  })

  it('skips identities the delete transaction already reported failed', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    // Every conflict save fails during the delete transaction → the
    // handoff reports 'failed' and arms the background debounce.
    const saveConflict = vi.spyOn(store, 'saveConflictDraft')
      .mockResolvedValue({ status: 'failed' })
    const persistence = makePersistence(store)
    const { deleting, barrier } = await enterConflictHandoff(persistence, store, backend, gate)
    const [result] = await deleting
    expect(result.status).toBe('failed')

    // finalize must NOT re-report the identity — its tab stays open on
    // the transaction's own 'failed' result, and re-running the write
    // could only duplicate the user-visible warning.
    expect(await barrier.finalizeBeforeDocumentClose()).toEqual([])
    // The armed background retry is untouched: once the store
    // recovers, the debounce persists local-v3 without any further
    // user action.
    saveConflict.mockRestore()
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.listConflictDrafts('vault')).map((c) => c.content))
      .toEqual(['local-v3'])
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('remote-v3')
    await persistence.dispose()
  })

  it('reports failed when the post-tab-migration primary write fails', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    await store.saveDraft(draft('primary', 'notes/a', 10))
    const barrier = await persistence.prepareFileMutation([identity])
    // An edit typed during the rename request.
    persistence.schedule(snapshot('during', 'notes/a', 2))
    const [move] = await barrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a-2',
    }])
    expect(move.status).toBe('moved')
    // The immediate write of the transaction-time snapshot to the
    // actual new path is rejected by IndexedDB.
    backend.failNext('save')
    const finalizeResults = await barrier.finalizeAfterTabMigration()

    // The failure is OBSERVABLE: 'failed' with the actual server-
    // suffixed path, so the lifecycle can merge it into the reported
    // results and warn. The family move itself succeeded and is NOT
    // reversed — no draft is recreated on the old path; the record
    // holds the moved content at the new path.
    expect(finalizeResults).toEqual([{
      documentId: 'doc-a',
      oldPath: 'notes/a',
      newPath: 'archive/a-2',
      status: 'failed',
    }])
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      documentPath: 'archive/a-2',
      content: 'primary',
    })
    // The edit is still only in-memory — tracked under the actual new
    // path so flush/dispose can still reach it.
    expect(persistence.findTrackedIdentitiesByPaths(['archive/a-2'])).toEqual([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'archive/a-2',
    }])
    await persistence.dispose()
  })

  it('reports failed when the post-tab-migration conflict write fails', async () => {
    const gate = gatedStore()
    const { backend, store } = gate
    const persistence = makePersistence(store)
    const { deleting } = await enterConflictHandoff(persistence, store, backend, gate)
    const [deleteResult] = await deleting
    expect(deleteResult.status).toBe('conflict')
    // The entry is pinned to the conflict channel; a later edit keeps
    // it there, and then the file is renamed: the second transaction
    // moves the family (primary + conflict candidates) to the actual
    // new path.
    persistence.schedule(snapshot('local-v4', 'notes/a', 4))
    const renameBarrier = await persistence.prepareFileMutation([identity])
    const [move] = await renameBarrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a-2',
    }])
    expect(move.status).toBe('moved')
    // The conflict-channel write of the latest snapshot is rejected.
    vi.spyOn(store, 'saveConflictDraft').mockResolvedValue({ status: 'failed' })
    const finalizeResults = await renameBarrier.finalizeAfterTabMigration()

    expect(finalizeResults).toEqual([{
      documentId: 'doc-a',
      oldPath: 'notes/a',
      newPath: 'archive/a-2',
      status: 'failed',
    }])
    // The family already moved — the finalize failure must not reverse
    // it: primary at the new path, the promoted candidate moved with it.
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      documentPath: 'archive/a-2',
      content: 'remote-v3',
    })
    expect((await store.listConflictDrafts('vault')).map((c) => c.content))
      .toEqual(['local-v3'])
    // local-v4 is still only in-memory, tracked under the new path.
    expect(persistence.findTrackedIdentitiesByPaths(['archive/a-2'])).toEqual([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'archive/a-2',
    }])
    await persistence.dispose()
  })

  // A failed family move reports 'failed' from commitMoves AND puts the
  // identity into pendingReleases. finalize must still RELEASE the
  // entry — only suppressing the duplicate 'failed' result. Without the
  // release the entry keeps the dead barrier's fileTransaction token
  // forever: schedule() never arms a timer, flush() returns false, and
  // pagehide/dispose cannot persist the tab's subsequent edits — the
  // tab the failure deliberately kept open is permanently locked.

  function conflictRecord(conflictId: string, documentId: string, path: string, content: string) {
    return {
      version: 1 as const,
      conflictId,
      vaultId: 'vault',
      documentId,
      documentPath: path,
      content,
      baseContentHash: 'base-hash',
      baseModifiedAt: 10.5,
      createdAt: 5,
      updatedAt: 31,
      origin: 'delete-conflict' as const,
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    }
  }

  it('releases the entry after a failed family move', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    await store.saveDraft(draft('primary', 'notes/a', 10))
    await store.saveConflictDraft(conflictRecord('conflict-a', 'doc-a', 'notes/a', 'local orphan'))
    const barrier = await persistence.prepareFileMutation([identity])
    // An edit typed during the rename request.
    persistence.schedule(snapshot('during', 'notes/a', 2))
    backend.failNext('moveFamilyConflicts')
    const [move] = await barrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a',
    }])
    expect(move.status).toBe('failed')

    // finalize must NOT re-report the failure the commit already
    // surfaced ...
    expect(await barrier.finalizeAfterTabMigration()).toEqual([])
    // ... but it MUST release the entry, persisting the transaction-
    // time snapshot at the unchanged old path on the way out.
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      documentPath: 'notes/a',
      content: 'during',
    })
    // The family stays intact on the old path.
    expect((await store.listConflictDrafts('vault')).map((c) => c.documentPath))
      .toEqual(['notes/a'])
    // The entry is functional again — flush is no longer blocked by a
    // transaction token that outlived its barrier.
    expect(await persistence.flush('vault', 'doc-a')).toBe(true)
    await persistence.dispose()
  })

  it('allows scheduling and flushing after a failed family move', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    await store.saveDraft(draft('primary', 'notes/a', 10))
    await store.saveConflictDraft(conflictRecord('conflict-a', 'doc-a', 'notes/a', 'local orphan'))
    const barrier = await persistence.prepareFileMutation([identity])
    backend.failNext('moveFamilyConflicts')
    const [move] = await barrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a',
    }])
    expect(move.status).toBe('failed')
    expect(await barrier.finalizeAfterTabMigration()).toEqual([])

    // A post-rename edit arms the debounce again — before the fix the
    // pinned transaction token swallowed the timer and the edit never
    // left memory.
    persistence.schedule(snapshot('after', 'notes/a', 2))
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('after')
    // An explicit flush persists a further edit instead of returning
    // false behind the dead token.
    persistence.schedule(snapshot('flushed', 'notes/a', 3))
    expect(await persistence.flush('vault', 'doc-a')).toBe(true)
    expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('flushed')
    await persistence.dispose()
  })

  it('flushes on pagehide after a failed family move', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const targetWindow = new EventTarget()
    const persistence = makePersistence(store, targetWindow)
    await store.saveDraft(draft('primary', 'notes/a', 10))
    await store.saveConflictDraft(conflictRecord('conflict-a', 'doc-a', 'notes/a', 'local orphan'))
    const barrier = await persistence.prepareFileMutation([identity])
    backend.failNext('moveFamilyConflicts')
    const [move] = await barrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a',
    }])
    expect(move.status).toBe('failed')
    expect(await barrier.finalizeAfterTabMigration()).toEqual([])

    // The user keeps editing after the failed rename; the page hides
    // BEFORE the fresh debounce fires — flushAll must reach the entry.
    persistence.schedule(snapshot('pagehide-edit', 'notes/a', 2))
    targetWindow.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(async () => {
      expect((await store.getDraft('vault', 'doc-a'))?.content).toBe('pagehide-edit')
    })
    await persistence.dispose()
  })

  it('releases every failed identity in a partial folder rename', async () => {
    const backend = createMemoryDraftBackend()
    const store = createDraftStore({ backend })
    const persistence = makePersistence(store)
    const identityB = { vaultId: 'vault', documentId: 'doc-b', documentPath: 'notes/b' }
    await store.saveDraft(draft('primary-a', 'notes/a', 10))
    await store.saveDraft({ ...draft('primary-b', 'notes/b', 10), documentId: 'doc-b' })
    await store.saveConflictDraft(conflictRecord('conflict-a', 'doc-a', 'notes/a', 'local orphan a'))
    await store.saveConflictDraft(conflictRecord('conflict-b', 'doc-b', 'notes/b', 'local orphan b'))
    const barrier = await persistence.prepareFileMutation([identity, identityB])
    // doc-a's family move fails (the injected failure is consumed by
    // the first family move); doc-b's succeeds.
    backend.failNext('moveFamilyConflicts')
    const [moveA, moveB] = await barrier.commitMoves([
      { vaultId: 'vault', documentId: 'doc-a', fromPath: 'notes/a', toPath: 'archive/a' },
      { vaultId: 'vault', documentId: 'doc-b', fromPath: 'notes/b', toPath: 'archive/b' },
    ])
    expect(moveA.status).toBe('failed')
    expect(moveB.status).toBe('moved')

    // finalize must release BOTH entries — the failed one included —
    // without re-reporting the failure commitMoves already surfaced.
    expect(await barrier.finalizeAfterTabMigration()).toEqual([])
    // Both accept new edits again: the failed identity at its unchanged
    // old path, the moved one at the actual new path.
    persistence.schedule(snapshot('after-a', 'notes/a', 2))
    persistence.schedule({ ...snapshot('after-b', 'archive/b', 2), documentId: 'doc-b' })
    await vi.advanceTimersByTimeAsync(800)
    await vi.runAllTimersAsync()
    await Promise.resolve()
    await Promise.resolve()
    expect(await store.getDraft('vault', 'doc-a')).toMatchObject({
      documentPath: 'notes/a',
      content: 'after-a',
    })
    expect(await store.getDraft('vault', 'doc-b')).toMatchObject({
      documentPath: 'archive/b',
      content: 'after-b',
    })
    await persistence.dispose()
  })
})
