import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDraftStore,
  createMemoryDraftBackend,
} from '../draftStore'
import type { UnsavedDraft } from '../draftTypes'
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
    await persistence.dispose()
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
