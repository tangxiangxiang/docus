import { describe, expect, it } from 'vitest'
import { fileSearchProvider, searchEverywhere, type SearchProvider } from '../searchResults'
import type { PostSummary } from '../api'

const posts: PostSummary[] = [
  { path: 'inbox/redis-cache', title: 'Redis Cache', created: '', updated: '', tags: ['redis'], summary: 'not searchable', size: 0, mtime: 0 },
  { path: 'docs/queues', title: 'Queues', created: '', updated: '', tags: [], summary: 'redis only in content', size: 0, mtime: 0 },
]

describe('Search Everywhere result architecture', () => {
  it('finds files by title or path, not content metadata', async () => {
    expect((await searchEverywhere('redis', [fileSearchProvider(posts)]))[0].results.map((r) => r.title)).toEqual(['Redis Cache'])
    expect(await searchEverywhere('content', [fileSearchProvider(posts)])).toEqual([])
  })

  it('composes future providers as independent result sections', async () => {
    const future: SearchProvider = () => ({ id: 'commands', label: 'Commands', results: [] })
    const sections = await searchEverywhere('', [fileSearchProvider(posts), future])
    expect(sections.map((section) => section.id)).toEqual(['files'])
  })
})
