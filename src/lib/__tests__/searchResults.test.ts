import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDocumentSearchProvider, createLatestSearchRunner, searchEverywhere, type SearchProvider, type SearchResultSection } from '../searchResults'
import { dispose } from '../search'
import type { PostSummary } from '../api'

const makePost = (path: string, title: string, summary = ''): PostSummary => ({ path, title, created: '', updated: '', tags: [], summary, size: 0, mtime: 1 })

describe('Search Everywhere document provider', () => {
  beforeEach(() => dispose())
  afterEach(() => { vi.unstubAllGlobals(); dispose() })

  it('finds title, path, summary, and body-only matches with snippets', async () => {
    const posts = [makePost('inbox/redis-notes', 'Redis Notes', 'cache reference')]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: 'distributed transaction isolation guarantees' }) })))
    const provider = createDocumentSearchProvider(() => posts)

    expect((await provider('Redis')).results[0].payload).toMatchObject({ match: 'title' })
    expect((await provider('redis-notes')).results[0].payload).toMatchObject({ match: 'path' })
    expect((await provider('cache reference')).results[0].payload).toMatchObject({ match: 'summary' })
    const body = (await provider('transaction isolation')).results[0]
    expect(body.title).toBe('Redis Notes')
    expect(body.payload).toMatchObject({ match: 'body' })
    expect((body.payload as { snippet?: string }).snippet).toContain('transaction isolation')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('rebuilds metadata when posts change', async () => {
    let posts = [makePost('inbox/old', 'Old')]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: '' }) })))
    const provider = createDocumentSearchProvider(() => posts)
    expect((await provider('Old')).results).toHaveLength(1)
    posts = [makePost('inbox/new', 'New')]
    expect((await provider('New')).results[0].title).toBe('New')
    expect((await provider('Old')).results).toHaveLength(0)
  })

  it('composes future providers as independent sections', async () => {
    const posts = [makePost('inbox/redis', 'Redis')]
    const future: SearchProvider = () => ({ id: 'commands', label: 'Commands', results: [{ id: 'command:open', type: 'command', title: 'Open', score: 1, payload: {} }] })
    const sections = await searchEverywhere('', [createDocumentSearchProvider(() => posts), future])
    expect(sections.map((section) => section.id)).toEqual(['files', 'commands'])
  })

  it('prevents an older async query from replacing newer results', async () => {
    let resolveOld!: (section: SearchResultSection) => void
    const oldResult = new Promise<SearchResultSection>((resolve) => { resolveOld = resolve })
    const provider: SearchProvider = (query) => query === 'old'
      ? oldResult
      : { id: 'files', label: 'Files', results: [{ id: 'file:new', type: 'file', title: 'New', score: 1, payload: { path: 'new' } }] }
    let applied: SearchResultSection[] = []
    const run = createLatestSearchRunner(() => [provider], (sections) => { applied = sections })
    const old = run('old')
    await run('new')
    resolveOld({ id: 'files', label: 'Files', results: [{ id: 'file:old', type: 'file', title: 'Old', score: 1, payload: { path: 'old' } }] })
    await old
    expect(applied[0].results[0].title).toBe('New')
  })
})
