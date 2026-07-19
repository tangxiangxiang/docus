import { describe, expect, it, vi } from 'vitest'
import type { PostDetail } from '../../../../lib/api'
import {
  createDraftStore,
  createMemoryDraftBackend,
} from '../draftStore'
import {
  UNSAVED_DRAFT_VERSION,
  type UnsavedDraft,
} from '../draftTypes'
import { createUnsavedDraftRecovery } from '../useUnsavedDraftRecovery'

function draft(id: string, path = `notes/${id}`): UnsavedDraft {
  return {
    version: UNSAVED_DRAFT_VERSION,
    vaultId: 'vault',
    documentId: id,
    documentPath: path,
    content: `draft:${id}`,
    baseContentHash: null,
    baseModifiedAt: 10,
    createdAt: 1,
    updatedAt: 2,
  }
}

function post(id: string, path = `notes/${id}`): PostDetail {
  return {
    path,
    raw: `disk:${id}`,
    content: `disk:${id}`,
    frontmatter: {},
    metadata: {
      id,
      path,
      title: id,
      summary: '',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    },
    size: 1,
    mtime: 10,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

async function seededStore(...drafts: UnsavedDraft[]) {
  const store = createDraftStore({ backend: createMemoryDraftBackend() })
  await Promise.all(drafts.map((value) => store.saveDraft(value)))
  return store
}

describe('createUnsavedDraftRecovery', () => {
  it('discovers only the requested vault without deleting or opening documents', async () => {
    const store = await seededStore(draft('a'))
    await store.saveDraft({ ...draft('other'), vaultId: 'other-vault' })
    const loadPost = vi.fn(async (path: string) => post('a', path))
    const recovery = createUnsavedDraftRecovery({ store, loadPost })

    await recovery.discover('vault')

    expect(recovery.items.value).toHaveLength(1)
    expect(recovery.items.value[0]).toMatchObject({
      status: 'ready',
      decision: { kind: 'baseline-match' },
    })
    expect(loadPost).toHaveBeenCalledTimes(1)
    expect(await store.getDraft('vault', 'a')).not.toBeNull()
  })

  it('maps 404, read failures, and reused paths to safe decisions', async () => {
    const store = await seededStore(
      draft('missing'),
      draft('broken'),
      draft('old', 'notes/reused'),
    )
    const loadPost = vi.fn(async (path: string) => {
      if (path.endsWith('missing')) throw Object.assign(new Error('gone'), { status: 404 })
      if (path.endsWith('broken')) throw new Error('private')
      return post('replacement', path)
    })
    const recovery = createUnsavedDraftRecovery({ store, loadPost })

    await recovery.discover('vault')

    const kinds = Object.fromEntries(recovery.items.value.map((item) => [
      item.draft.documentId,
      item.decision?.kind,
    ]))
    expect(kinds).toEqual({
      broken: 'unknown',
      missing: 'missing-source',
      old: 'identity-mismatch',
    })
  })

  it('bounds classification concurrency', async () => {
    const drafts = Array.from({ length: 10 }, (_, index) => draft(`d${index}`))
    const store = await seededStore(...drafts)
    let active = 0
    let maximum = 0
    const gates = drafts.map(() => deferred<PostDetail>())
    const loadPost = vi.fn((path: string) => {
      const index = Number(path.slice(path.lastIndexOf('d') + 1))
      active += 1
      maximum = Math.max(maximum, active)
      return gates[index].promise.finally(() => { active -= 1 })
    })
    const recovery = createUnsavedDraftRecovery({ store, loadPost, concurrency: 4 })

    const discovering = recovery.discover('vault')
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledTimes(4))
    expect(maximum).toBe(4)
    for (let index = 0; index < gates.length; index += 1) {
      gates[index].resolve(post(`d${index}`))
      if (index + 4 < gates.length) {
        await vi.waitFor(() => expect(loadPost).toHaveBeenCalledTimes(index + 5))
      }
    }
    await discovering
    expect(maximum).toBe(4)
  })

  it('lets a new discovery replace stale classification results', async () => {
    const firstStore = await seededStore(draft('a'))
    const first = deferred<PostDetail>()
    const loadPost = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(post('a'))
    const recovery = createUnsavedDraftRecovery({ store: firstStore, loadPost })

    const stale = recovery.discover('vault')
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledTimes(1))
    const current = recovery.discover('vault')
    await vi.waitFor(() => expect(loadPost).toHaveBeenCalledTimes(2))
    await current
    first.resolve(post('replacement'))
    await stale

    expect(recovery.items.value[0]?.decision?.kind).toBe('baseline-match')
  })

  it('lets retry replace an older per-item request', async () => {
    const store = await seededStore(draft('a'))
    const first = deferred<PostDetail>()
    const loadPost = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(post('a'))
    const recovery = createUnsavedDraftRecovery({ store, loadPost })

    const discovering = recovery.discover('vault')
    await vi.waitFor(() => expect(recovery.items.value).toHaveLength(1))
    const id = recovery.items.value[0]!.recoveryId
    await recovery.retry(id)
    first.resolve(post('replacement'))
    await discovering

    expect(recovery.items.value[0]?.decision?.kind).toBe('baseline-match')
  })

  it('ignores late work after dispose and dismisses only for the session', async () => {
    const store = await seededStore(draft('a'))
    const pending = deferred<PostDetail>()
    const recovery = createUnsavedDraftRecovery({
      store,
      loadPost: () => pending.promise,
    })
    const discovering = recovery.discover('vault')
    await vi.waitFor(() => expect(recovery.items.value).toHaveLength(1))
    const id = recovery.items.value[0]!.recoveryId
    recovery.dismissForSession(id)
    expect(recovery.items.value[0]?.status).toBe('dismissed')
    expect(await store.getDraft('vault', 'a')).not.toBeNull()

    recovery.dispose()
    pending.resolve(post('a'))
    await discovering
    expect(recovery.items.value[0]?.status).toBe('dismissed')
  })
})
