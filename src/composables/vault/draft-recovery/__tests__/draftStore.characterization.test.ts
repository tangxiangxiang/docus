import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDraftStore,
  createMemoryDraftBackend,
  type MemoryDraftStorageBackend,
} from '../draftStore'
import type { UnsavedDraft } from '../draftTypes'

function draft(
  documentId: string,
  updatedAt: number,
  overrides: Partial<UnsavedDraft> = {},
): UnsavedDraft {
  return {
    version: 1,
    vaultId: 'vault-a',
    documentId,
    documentPath: `notes/${documentId}`,
    content: `content:${documentId}:${updatedAt}`,
    baseContentHash: `hash:${documentId}`,
    baseModifiedAt: 100,
    createdAt: 10,
    updatedAt,
    ...overrides,
  }
}

describe('draftStore characterization', () => {
  let backend: MemoryDraftStorageBackend
  let store: ReturnType<typeof createDraftStore>

  beforeEach(() => {
    backend = createMemoryDraftBackend()
    store = createDraftStore({ backend })
  })

  it('round-trips valid drafts without sharing mutable references', async () => {
    const value = draft('a', 20)

    expect(await store.saveDraft(value)).toBe(true)
    value.content = 'caller mutation'

    const firstRead = await store.getDraft('vault-a', 'a')
    expect(firstRead?.content).toBe('content:a:20')

    firstRead!.content = 'read mutation'
    expect((await store.getDraft('vault-a', 'a'))?.content).toBe('content:a:20')
  })

  it('keeps vaults isolated and lists newest drafts first deterministically', async () => {
    await store.saveDraft(draft('b', 30))
    await store.saveDraft(draft('a', 30))
    await store.saveDraft(draft('old', 20))
    await store.saveDraft(draft('other', 99, { vaultId: 'vault-b' }))

    expect((await store.listDrafts('vault-a')).map((value) => value.documentId))
      .toEqual(['a', 'b', 'old'])
    expect((await store.listDrafts('vault-b')).map((value) => value.documentId))
      .toEqual(['other'])
  })

  it('rejects stale and conflicting equal-timestamp writes', async () => {
    expect(await store.saveDraft(draft('a', 30))).toBe(true)
    expect(await store.saveDraft(draft('a', 20, { content: 'stale' }))).toBe(false)
    expect(await store.saveDraft(draft('a', 30))).toBe(true)
    expect(await store.saveDraft(draft('a', 30, { content: 'conflict' }))).toBe(false)

    expect((await store.getDraft('vault-a', 'a'))?.content).toBe('content:a:30')
  })

  it('does not overwrite a future-version record at the same identity', async () => {
    const future = { ...draft('a', 40), version: 2, content: 'future data' }
    await backend.seedRaw(future)

    expect(await store.saveDraft(draft('a', 50))).toBe(false)
    expect(await backend.get(['vault-a', 'a'])).toEqual(future)
  })

  it('preserves the original createdAt when updating a draft', async () => {
    await store.saveDraft(draft('a', 20, { createdAt: 5 }))

    expect(await store.saveDraft(draft('a', 30, { createdAt: 25 }))).toBe(true)
    expect(await store.getDraft('vault-a', 'a')).toEqual(
      draft('a', 30, { createdAt: 5 }),
    )
  })

  it('rejects invalid records without affecting existing drafts', async () => {
    await store.saveDraft(draft('valid', 20))

    expect(await store.saveDraft(draft('', 20))).toBe(false)
    expect(await store.saveDraft(draft('bad-time', 5, { createdAt: 10 }))).toBe(false)
    expect(await store.saveDraft({
      ...draft('future', 20),
      version: 2,
    } as unknown as UnsavedDraft)).toBe(false)

    expect((await store.listDrafts('vault-a')).map((value) => value.documentId))
      .toEqual(['valid'])
  })

  it('deletes and clears idempotently without crossing vault boundaries', async () => {
    await store.saveDraft(draft('a', 20))
    await store.saveDraft(draft('b', 21))
    await store.saveDraft(draft('a', 22, { vaultId: 'vault-b' }))

    expect(await store.deleteDraft('vault-a', 'a')).toEqual({ status: 'deleted' })
    expect(await store.deleteDraft('vault-a', 'a')).toEqual({ status: 'missing' })
    expect(await store.clearVaultDrafts('vault-a')).toBe(true)
    expect(await store.listDrafts('vault-a')).toEqual([])
    expect((await store.getDraft('vault-b', 'a'))?.content).toBe('content:a:22')
  })

  it('does not delete unsupported records during normal lifecycle cleanup', async () => {
    const future = { ...draft('future', 30), version: 2 }
    const corrupt = { ...draft('corrupt', 31), content: 42 }
    await backend.seedRaw(future)
    await backend.seedRaw(corrupt)
    await store.saveDraft(draft('valid', 32))

    expect(await store.deleteDraft('vault-a', 'future'))
      .toEqual({ status: 'unsupported' })
    expect(await store.clearVaultDrafts('vault-a')).toBe(true)
    expect(await backend.get(['vault-a', 'future'])).toEqual(future)
    expect(await backend.get(['vault-a', 'corrupt'])).toEqual(corrupt)
    expect(await store.getDraft('vault-a', 'valid')).toBeNull()
  })

  it('lists safe-integer record timestamps and accepts finite filesystem mtimes', async () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1

    expect(await store.saveDraft(draft('boundary', Number.MAX_SAFE_INTEGER, {
      baseModifiedAt: 1_721_234_567_890.625,
    }))).toBe(true)
    expect(await store.saveDraft(draft('created', unsafe, {
      createdAt: unsafe,
    }))).toBe(false)
    expect(await store.saveDraft(draft('updated', unsafe))).toBe(false)
    expect(await store.saveDraft(draft('large-mtime', 30, {
      baseModifiedAt: unsafe,
    }))).toBe(true)
    expect(await store.saveDraft(draft('infinite-mtime', 31, {
      baseModifiedAt: Number.POSITIVE_INFINITY,
    }))).toBe(false)
    expect((await store.listDrafts('vault-a')).map((value) => value.documentId))
      .toEqual(['boundary', 'large-mtime'])
  })

  it('moves a draft atomically while preserving its content and baseline', async () => {
    const original = draft('a', 20)
    await store.saveDraft(original)

    expect(await store.moveDraft('vault-a', 'a', 'x', 'renamed/x'))
      .toEqual({ status: 'moved' })
    expect(await store.getDraft('vault-a', 'a')).toBeNull()
    expect(await store.getDraft('vault-a', 'x')).toEqual({
      ...original,
      documentId: 'x',
      documentPath: 'renamed/x',
    })
  })

  it('preserves both drafts when a different move target already exists', async () => {
    await store.saveDraft(draft('source', 40, { createdAt: 4 }))
    const target = draft('target', 30, {
      content: 'different target',
      createdAt: 3,
    })
    await store.saveDraft(target)

    expect(await store.moveDraft(
      'vault-a',
      'source',
      'target',
      'renamed/target',
    )).toEqual({ status: 'conflict' })
    expect(await store.getDraft('vault-a', 'source'))
      .toEqual(draft('source', 40, { createdAt: 4 }))
    expect(await store.getDraft('vault-a', 'target')).toEqual(target)
  })

  it('fails an equal-timestamp duplicate move without changing either record', async () => {
    const source = draft('source', 30)
    const target = draft('target', 30, { content: 'different target' })
    await store.saveDraft(source)
    await store.saveDraft(target)

    expect(await store.moveDraft(
      'vault-a',
      'source',
      'target',
      'renamed/target',
    )).toEqual({ status: 'conflict' })
    expect(await store.getDraft('vault-a', 'source')).toEqual(source)
    expect(await store.getDraft('vault-a', 'target')).toEqual(target)
  })

  it('leaves the source intact when an atomic move fails', async () => {
    const original = draft('source', 30)
    await store.saveDraft(original)
    backend.failNext('move')

    expect(await store.moveDraft(
      'vault-a',
      'source',
      'target',
      'renamed/target',
    )).toEqual({ status: 'failed' })
    expect(await store.getDraft('vault-a', 'source')).toEqual(original)
    expect(await store.getDraft('vault-a', 'target')).toBeNull()
  })

  it('does not overwrite a corrupt move target', async () => {
    const source = draft('source', 30)
    const corruptTarget = { ...draft('target', 20), content: 42 }
    await store.saveDraft(source)
    await backend.seedRaw(corruptTarget)

    expect(await store.moveDraft(
      'vault-a',
      'source',
      'target',
      'renamed/target',
    )).toEqual({ status: 'unsupported' })
    expect(await store.getDraft('vault-a', 'source')).toEqual(source)
    expect(await backend.get(['vault-a', 'target'])).toEqual(corruptTarget)
  })

  it('reports a missing source as an idempotent no-op', async () => {
    expect(await store.moveDraft(
      'vault-a',
      'missing',
      'target',
      'renamed/target',
    )).toEqual({ status: 'missing' })
  })

  it('skips corrupt and future records without hiding valid drafts', async () => {
    await backend.seedRaw(draft('valid', 30))
    await backend.seedRaw({ ...draft('future', 40), version: 2 })
    await backend.seedRaw({ ...draft('broken', 50), content: 42 })

    expect((await store.listDrafts('vault-a')).map((value) => value.documentId))
      .toEqual(['valid'])
    expect(await store.getDraft('vault-a', 'future')).toBeNull()
    expect(await store.getDraft('vault-a', 'broken')).toBeNull()
  })

  it('turns backend failures into safe results without rejected promises', async () => {
    backend.failNext('save')
    await expect(store.saveDraft(draft('a', 20))).resolves.toBe(false)

    backend.failNext('get')
    await expect(store.getDraft('vault-a', 'a')).resolves.toBeNull()

    backend.failNext('list')
    await expect(store.listDrafts('vault-a')).resolves.toEqual([])

    backend.failNext('delete')
    await expect(store.deleteDraft('vault-a', 'a'))
      .resolves.toEqual({ status: 'failed' })

    backend.failNext('clear')
    await expect(store.clearVaultDrafts('vault-a')).resolves.toBe(false)
  })

  it('fails safely when IndexedDB is unavailable', async () => {
    const unavailable = createDraftStore({ indexedDB: undefined })

    await expect(unavailable.saveDraft(draft('a', 20))).resolves.toBe(false)
    await expect(unavailable.getDraft('vault-a', 'a')).resolves.toBeNull()
    await expect(unavailable.listDrafts('vault-a')).resolves.toEqual([])
    await expect(unavailable.deleteDraft('vault-a', 'a'))
      .resolves.toEqual({ status: 'failed' })
    await expect(
      unavailable.moveDraft('vault-a', 'a', 'x', 'notes/x'),
    ).resolves.toEqual({ status: 'failed' })
    await expect(unavailable.clearVaultDrafts('vault-a')).resolves.toBe(false)
  })
})
