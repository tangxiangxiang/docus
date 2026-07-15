import type { PostSummary } from './api'

export type SearchResultType = 'file' | 'heading' | 'tag' | 'alias' | 'command' | 'ai' | 'recent-file'
export interface SearchResult<T = unknown> { id: string; type: SearchResultType; title: string; subtitle?: string; icon?: string; score: number; payload: T }
export interface SearchResultSection { id: string; label: string; results: SearchResult[] }
export type SearchProvider = (query: string) => SearchResultSection | Promise<SearchResultSection>

export function fileSearchProvider(posts: PostSummary[]): SearchProvider {
  return (query) => {
    const q = query.trim().toLocaleLowerCase()
    const results = posts.flatMap<SearchResult<{ path: string }>>((post) => {
      const title = post.title.toLocaleLowerCase()
      const path = post.path.toLocaleLowerCase()
      if (q && !title.includes(q) && !path.includes(q)) return []
      const score = !q ? 0 : title === q ? 100 : title.startsWith(q) ? 80 : path.startsWith(q) ? 60 : 40
      return [{ id: `file:${post.path}`, type: 'file', title: post.title, subtitle: post.path, score, payload: { path: post.path } }]
    })
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    return { id: 'files', label: 'Files', results: results.slice(0, 12) }
  }
}

export async function searchEverywhere(query: string, providers: SearchProvider[]): Promise<SearchResultSection[]> {
  return (await Promise.all(providers.map((provider) => provider(query))))
    .filter((section) => section.results.length > 0)
}
