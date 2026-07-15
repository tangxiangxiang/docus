import type { PostSummary } from './api'
import { buildIndex, primeBody, rebuildIndex, search } from './search'

export type SearchResultType = 'file' | 'heading' | 'tag' | 'alias' | 'command' | 'ai' | 'recent-file'
export interface SearchResult<T = unknown> { id: string; type: SearchResultType; title: string; subtitle?: string; icon?: string; score: number; payload: T }
export interface SearchResultSection { id: string; label: string; results: SearchResult[] }
export type SearchProvider = (query: string) => SearchResultSection | Promise<SearchResultSection>
export interface DocumentSearchPayload { path: string; match: 'title' | 'path' | 'tag' | 'summary' | 'body'; snippet?: string }

function postsSignature(posts: PostSummary[]): string {
  return posts.map((post) => `${post.path}\0${post.title}\0${post.mtime}\0${post.summary ?? ''}\0${post.tags.join(',')}`).join('\u0001')
}

export function createDocumentSearchProvider(getPosts: () => PostSummary[]): SearchProvider {
  let indexed = false
  let signature = ''
  let priming: Promise<void> | null = null

  return async (query) => {
    const posts = getPosts()
    const nextSignature = postsSignature(posts)
    if (!indexed) {
      buildIndex(posts)
      indexed = true
      signature = nextSignature
    } else if (signature !== nextSignature) {
      rebuildIndex(posts)
      signature = nextSignature
      priming = null
    }

    if (!query.trim()) {
      const results = [...posts].sort((a, b) => a.title.localeCompare(b.title)).slice(0, 12).map<SearchResult<DocumentSearchPayload>>((post) => ({
        id: `file:${post.path}`, type: 'file', title: post.title, subtitle: post.path, score: 0,
        payload: { path: post.path, match: 'title' },
      }))
      return { id: 'files', label: 'Files', results }
    }

    if (!priming) priming = primeBody(posts)
    await priming
    const results = search(query, 12).map<SearchResult<DocumentSearchPayload>>((hit) => ({
      id: `file:${hit.path}`, type: 'file', title: hit.title, subtitle: hit.path, score: hit.score,
      payload: { path: hit.path, match: hit.match, snippet: hit.snippet },
    }))
    return { id: 'files', label: 'Files', results }
  }
}

export async function searchEverywhere(query: string, providers: SearchProvider[]): Promise<SearchResultSection[]> {
  return (await Promise.all(providers.map((provider) => provider(query))))
    .filter((section) => section.results.length > 0)
}

export function createLatestSearchRunner(
  getProviders: () => SearchProvider[],
  apply: (sections: SearchResultSection[]) => void,
) {
  let version = 0
  return async (query: string): Promise<void> => {
    const requestVersion = ++version
    const sections = await searchEverywhere(query, getProviders())
    if (requestVersion === version) apply(sections)
  }
}
