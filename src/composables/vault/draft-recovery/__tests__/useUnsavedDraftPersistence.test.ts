import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDraftStore,
  createMemoryDraftBackend,
  type DraftStore,
} from '../draftStore'
import {
  createUnsavedDraftPersistence,
  type DraftBufferSnapshot,
} from '../useUnsavedDraftPersistence'

function snapshot(
  documentId: string,
  content: string,
  revision = 1,
): DraftBufferSnapshot {
  return {
    vaultId: 'vault-1',
    documentId,
    documentPath: `notes/${documentId}`,
    content,
    authoritativeContent: 'disk',
    baseContentHash: 'baseline-hash',
    baseModifiedAt: 10,
    revision,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('createUnsavedDraftPersistence', () => {
  let store: DraftStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = createDraftStore({ backend: createMemoryDraftBackend() })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces each document independently and snapshots input synchronously', async () => {
    const persistence = createUnsavedDraftPersistence({ store, now: () => 100 })
    const a = snapshot('a', 'a1')
    persistence.schedule(a)
    a.content = 'mutated after schedule'
    vi.advanceTimersByTime(400)
    persistence.schedule(snapshot('a', 'a2', 2))
    persistence.schedule(snapshot('b', 'b1'))

    await vi.advanceTimersByTimeAsync(400)
    expect(await store.getDraft('vault-1', 'a')).toBeNull()
    expect(await store.getDraft('vault-1', 'b')).toBeNull()

    await vi.advanceTimersByTimeAsync(400)
    expect((await store.getDraft('vault-1', 'a'))?.content).toBe('a2')
    expect((await store.getDraft('vault-1', 'b'))?.content).toBe('b1')
  })

  it('persists drafts with fractional filesystem mtime', async () => {
    const persistence = createUnsavedDraftPersistence({ store })
    persistence.schedule({
      ...snapshot('a', 'dirty'),
      baseModifiedAt: 1_721_234_567_890.625,
    })

    await vi.advanceTimersByTimeAsync(800)

    expect((await store.getDraft('vault-1', 'a'))?.baseModifiedAt)
      .toBe(1_721_234_567_890.625)
  })

  it('does not let an old pending write recreate a discarded draft', async () => {
    const write = deferred<boolean>()
    const saveDraft = vi.fn()
      .mockImplementationOnce(() => write.promise)
      .mockResolvedValue(true)
    const persistence = createUnsavedDraftPersistence({
      store: { ...store, saveDraft },
    })

    const owner = persistence.schedule(snapshot('a', 'old'))!
    await vi.advanceTimersByTimeAsync(800)
    const discarded = persistence.discard(owner)
    write.resolve(true)
    await discarded

    expect(await store.getDraft('vault-1', 'a')).toBeNull()
    expect(saveDraft).toHaveBeenCalledTimes(1)
  })

  it('does not let a clean deletion remove a newer scheduled generation', async () => {
    const oldWrite = deferred<boolean>()
    const saveDraft = vi.fn()
      .mockImplementationOnce(() => oldWrite.promise)
      .mockImplementation((draft) => store.saveDraft(draft))
    const persistence = createUnsavedDraftPersistence({
      store: { ...store, saveDraft },
    })

    const owner = persistence.schedule(snapshot('a', 'old', 1))!
    await vi.advanceTimersByTimeAsync(800)
    const clean = persistence.markClean(owner, 1)
    persistence.schedule(snapshot('a', 'new', 2))
    await vi.advanceTimersByTimeAsync(800)

    oldWrite.resolve(true)
    await clean
    await persistence.flush('vault-1', 'a')

    expect((await store.getDraft('vault-1', 'a'))?.content).toBe('new')
  })

  it('serializes a reopened document write after discard deletion', async () => {
    const deletion = deferred<{ status: 'deleted' }>()
    const deleteDraft = vi.fn().mockReturnValue(deletion.promise)
    const persistence = createUnsavedDraftPersistence({
      store: { ...store, deleteDraft },
    })

    const owner = persistence.schedule(snapshot('a', 'old', 1))!
    await persistence.flush('vault-1', 'a')
    const discarded = persistence.discard(owner)
    persistence.schedule(snapshot('a', 'reopened', 1))
    await vi.advanceTimersByTimeAsync(800)

    expect((await store.getDraft('vault-1', 'a'))?.content).toBe('old')
    deletion.resolve({ status: 'deleted' })
    await discarded
    await persistence.flush('vault-1', 'a')

    expect((await store.getDraft('vault-1', 'a'))?.content).toBe('reopened')
  })

  it('isolates a reopened document from work owned by the closed tab', async () => {
    const persistence = createUnsavedDraftPersistence({ store })
    persistence.schedule(snapshot('a', 'old'))
    persistence.invalidate('vault-1', 'a')
    persistence.schedule(snapshot('a', 'new', 1))

    await vi.advanceTimersByTimeAsync(800)
    expect((await store.getDraft('vault-1', 'a'))?.content).toBe('new')
  })

  it('does not let a stale asynchronous baseline hash write for a new owner', async () => {
    const firstHash = deferred<ArrayBuffer>()
    const digest = vi.fn()
      .mockReturnValueOnce(firstHash.promise)
      .mockResolvedValueOnce(new Uint8Array([2]).buffer)
    vi.stubGlobal('crypto', { subtle: { digest } })
    const persistence = createUnsavedDraftPersistence({ store })

    persistence.schedule({ ...snapshot('a', 'old'), baseContentHash: null })
    await vi.advanceTimersByTimeAsync(800)
    persistence.schedule({
      ...snapshot('a', 'new', 2),
      baseContentHash: null,
      authoritativeContent: 'new baseline',
    })
    firstHash.resolve(new Uint8Array([1]).buffer)
    await persistence.flush('vault-1', 'a')

    const draft = await store.getDraft('vault-1', 'a')
    expect(draft?.content).toBe('new')
    expect(draft?.baseContentHash).toBe('02')
  })

  it('deletes only a clean acknowledged revision owned by the current generation', async () => {
    const persistence = createUnsavedDraftPersistence({ store })
    const first = persistence.schedule(snapshot('a', 'v1', 1))!
    await persistence.flush('vault-1', 'a')

    const second = persistence.schedule(snapshot('a', 'v2', 2))!
    await persistence.markClean(first, 1)
    expect((await store.getDraft('vault-1', 'a'))?.content).toBe('v1')

    await persistence.flush('vault-1', 'a')
    await persistence.markClean(second, 1)
    expect(await store.getDraft('vault-1', 'a')).not.toBeNull()

    await persistence.markClean(second, 2)
    expect(await store.getDraft('vault-1', 'a')).toBeNull()
  })

  it('cancels and deletes when content returns to the authoritative baseline', async () => {
    const persistence = createUnsavedDraftPersistence({ store })
    persistence.schedule(snapshot('a', 'dirty'))
    await persistence.flush('vault-1', 'a')

    await persistence.returnedToBaseline('vault-1', 'a')
    await vi.advanceTimersByTimeAsync(800)
    expect(await store.getDraft('vault-1', 'a')).toBeNull()
  })

  it('treats deleted and missing discard outcomes as success without throwing', async () => {
    const persistence = createUnsavedDraftPersistence({ store })
    const owner = persistence.schedule(snapshot('a', 'dirty'))!
    await persistence.flush('vault-1', 'a')
    await expect(persistence.discard(owner)).resolves.toBe(true)

    const nextOwner = persistence.schedule(snapshot('a', 'again', 2))!
    await expect(persistence.discard(nextOwner)).resolves.toBe(true)
  })

  it('flushes only the latest dirty snapshot once during idempotent dispose', async () => {
    const saveDraft = vi.spyOn(store, 'saveDraft')
    const persistence = createUnsavedDraftPersistence({ store })
    persistence.schedule(snapshot('a', 'a1'))
    persistence.schedule(snapshot('a', 'a2', 2))
    persistence.schedule(snapshot('b', 'b1'))
    await persistence.returnedToBaseline('vault-1', 'b')

    await persistence.dispose()
    await persistence.dispose()

    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect((await store.getDraft('vault-1', 'a'))?.content).toBe('a2')
    expect(await store.getDraft('vault-1', 'b')).toBeNull()
  })

  it('contains save, delete, and rejected store failures and retries later input', async () => {
    const saveDraft = vi.fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(true)
    const deleteDraft = vi.fn().mockRejectedValue(new Error('delete failed'))
    const persistence = createUnsavedDraftPersistence({
      store: { ...store, saveDraft, deleteDraft },
    })

    persistence.schedule(snapshot('a', 'v1'))
    await vi.advanceTimersByTimeAsync(800)
    const owner = persistence.schedule(snapshot('a', 'v2', 2))!
    await vi.advanceTimersByTimeAsync(800)
    await expect(persistence.discard(owner)).resolves.toBe(false)

    expect(saveDraft).toHaveBeenCalledTimes(2)
  })

  it('does not schedule snapshots with unavailable identity or unloaded documents', async () => {
    const saveDraft = vi.spyOn(store, 'saveDraft')
    const persistence = createUnsavedDraftPersistence({ store })

    expect(persistence.schedule({ ...snapshot('a', 'x'), vaultId: '' })).toBeNull()
    expect(persistence.schedule({ ...snapshot('a', 'x'), documentId: '' })).toBeNull()
    expect(persistence.schedule({ ...snapshot('a', 'x'), loaded: false })).toBeNull()

    await vi.advanceTimersByTimeAsync(800)
    expect(saveDraft).not.toHaveBeenCalled()
  })

  it('fails closed when a document timestamp reaches MAX_SAFE_INTEGER', async () => {
    const persistence = createUnsavedDraftPersistence({
      store,
      now: () => Number.MAX_SAFE_INTEGER,
    })
    persistence.schedule(snapshot('a', 'v1'))
    await vi.advanceTimersByTimeAsync(800)
    persistence.schedule(snapshot('a', 'v2', 2))
    await vi.advanceTimersByTimeAsync(800)

    const draft = await store.getDraft('vault-1', 'a')
    expect(draft?.createdAt).toBe(Number.MAX_SAFE_INTEGER)
    expect(draft?.updatedAt).toBe(Number.MAX_SAFE_INTEGER)
    expect(draft?.content).toBe('v1')
  })

  it('registers one pagehide listener and removes it on dispose', async () => {
    const targetWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const persistence = createUnsavedDraftPersistence({ store, targetWindow })

    expect(targetWindow.addEventListener).toHaveBeenCalledOnce()
    expect(targetWindow.addEventListener).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
    )
    await persistence.dispose()
    expect(targetWindow.removeEventListener).toHaveBeenCalledOnce()
    expect(targetWindow.removeEventListener).toHaveBeenCalledWith(
      'pagehide',
      expect.any(Function),
    )
  })
})
