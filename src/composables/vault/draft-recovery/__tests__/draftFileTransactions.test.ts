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
// These cover the round-3 findings: the conflict handoff must re-verify
// entry ownership across its async save (an edit typed during the save is
// a new candidate, not dropped), a failed handoff must report 'failed'
// and keep the bytes visible, edits made after conflict mode is entered
// must stay on the conflict channel (never overwrite the cross-context
// primary), conflict records must follow renames, and a confirmed delete
// must remove the conflict records frozen at confirmation time.

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

  it('persists an edit typed during the conflict save instead of dropping it', async () => {
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
    // Both local edits survived as conflict candidates — the edit typed
    // during the save was re-verified and persisted, not clobbered.
    const contents = (await store.listConflictDrafts('vault'))
      .map((conflict) => conflict.content)
      .sort()
    expect(contents).toEqual(['local-v3', 'local-v4'])
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
