import { describe, expect, it, vi } from 'vitest'
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
