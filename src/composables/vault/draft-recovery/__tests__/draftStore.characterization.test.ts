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

    expect(await store.deleteDraft('vault-a', 'a')).toBe(true)
    expect(await store.deleteDraft('vault-a', 'a')).toBe(true)
    expect(await store.clearVaultDrafts('vault-a')).toBe(true)
    expect(await store.listDrafts('vault-a')).toEqual([])
    expect((await store.getDraft('vault-b', 'a'))?.content).toBe('content:a:22')
  })

  it('moves a draft atomically while preserving its content and baseline', async () => {
    const original = draft('a', 20)
    await store.saveDraft(original)

    expect(await store.moveDraft('vault-a', 'a', 'x', 'renamed/x')).toBe(true)
    expect(await store.getDraft('vault-a', 'a')).toBeNull()
    expect(await store.getDraft('vault-a', 'x')).toEqual({
      ...original,
      documentId: 'x',
      documentPath: 'renamed/x',
    })
  })

  it('uses the strictly newer draft when a move target already exists', async () => {
    await store.saveDraft(draft('source', 40, { createdAt: 4 }))
    await store.saveDraft(draft('target', 30, {
      content: 'older target',
      createdAt: 3,
    }))

    expect(await store.moveDraft(
      'vault-a',
      'source',
      'target',
      'renamed/target',
    )).toBe(true)
    expect(await store.getDraft('vault-a', 'source')).toBeNull()
    expect(await store.getDraft('vault-a', 'target')).toEqual({
      ...draft('source', 40, { createdAt: 4 }),
      documentId: 'target',
      documentPath: 'renamed/target',
    })

    await store.saveDraft(draft('new-source', 20))
    expect(await store.moveDraft(
      'vault-a',
      'new-source',
      'target',
      'renamed/target',
    )).toBe(true)
    expect(await store.getDraft('vault-a', 'new-source')).toBeNull()
    expect((await store.getDraft('vault-a', 'target'))?.updatedAt).toBe(40)
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
    )).toBe(false)
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
    )).toBe(false)
    expect(await store.getDraft('vault-a', 'source')).toEqual(original)
    expect(await store.getDraft('vault-a', 'target')).toBeNull()
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
    await expect(store.deleteDraft('vault-a', 'a')).resolves.toBe(false)

    backend.failNext('clear')
    await expect(store.clearVaultDrafts('vault-a')).resolves.toBe(false)
  })

  it('fails safely when IndexedDB is unavailable', async () => {
    const unavailable = createDraftStore({ indexedDB: undefined })

    await expect(unavailable.saveDraft(draft('a', 20))).resolves.toBe(false)
    await expect(unavailable.getDraft('vault-a', 'a')).resolves.toBeNull()
    await expect(unavailable.listDrafts('vault-a')).resolves.toEqual([])
    await expect(unavailable.deleteDraft('vault-a', 'a')).resolves.toBe(false)
    await expect(
      unavailable.moveDraft('vault-a', 'a', 'x', 'notes/x'),
    ).resolves.toBe(false)
    await expect(unavailable.clearVaultDrafts('vault-a')).resolves.toBe(false)
  })
})
