import { describe, expect, it } from 'vitest'
import { createDocumentSearchSource } from '../documentSearchSource'
import type { PostSummary } from '../api'

function post(path: string, title: string): PostSummary {
  return { path, title, created: '', updated: '', tags: [], size: 0, mtime: 1 }
}

describe('Document search source', () => {
  it('loads metadata once and deduplicates concurrent consumers', async () => {
    let resolve!: (posts: readonly PostSummary[]) => void
    const fetchPosts = (() => new Promise<readonly PostSummary[]>((next) => { resolve = next }))
    const source = createDocumentSearchSource(fetchPosts)

    const first = source.ensureLoaded()
    const second = source.ensureLoaded()
    resolve([post('inbox/atlas', 'Project Atlas')])
    await Promise.all([first, second])

    expect(source.getSnapshot()).toEqual([post('inbox/atlas', 'Project Atlas')])
  })

  it('does not let a stale session response repopulate the next session', async () => {
    let resolveFirst!: (posts: readonly PostSummary[]) => void
    let resolveSecond!: (posts: readonly PostSummary[]) => void
    const fetchPosts = (() => new Promise<readonly PostSummary[]>((resolve) => {
      if (!resolveFirst) resolveFirst = resolve
      else resolveSecond = resolve
    }))
    const source = createDocumentSearchSource(fetchPosts)

    const first = source.ensureLoaded()
    source.invalidate()
    const second = source.ensureLoaded()
    resolveSecond([post('inbox/current', 'Current')])
    await second
    resolveFirst([post('inbox/stale', 'Stale')])
    await first

    expect(source.getSnapshot()).toEqual([post('inbox/current', 'Current')])
  })

  it('lets the live Vault sync replace the initial App-level snapshot', async () => {
    const source = createDocumentSearchSource(async () => [post('inbox/old', 'Old')])
    await source.ensureLoaded()
    source.replace([post('inbox/new', 'New')])

    expect(source.getSnapshot().map((item) => item.title)).toEqual(['New'])
  })
})
