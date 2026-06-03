import MiniSearch from 'minisearch'
import type { PostSummary } from './api'

/**
 * 客户端搜索:基于 minisearch,索引 PostSummary(path/title/tags/summary),
 * 搜索时会再拉一次正文做正文匹配,小规模(<500 篇)直接一次性全量索引。
 *
 * 设计: index 是普通对象,load 一次性 addAll;rebuild 用于重命名/删除后重建。
 */
export interface SearchDoc {
  id: string
  path: string
  title: string
  tags: string
  summary: string
}

export interface SearchHit {
  path: string
  title: string
  score: number
  match: 'title' | 'tag' | 'summary' | 'body'
  snippet?: string
}

let mini: MiniSearch<SearchDoc> | null = null
let bodyCache: Map<string, string> = new Map()

function makeIndex(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ['title', 'tags', 'summary'],
    storeFields: ['path', 'title'],
    idField: 'id',
    searchOptions: {
      boost: { title: 3, tags: 2, summary: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  })
}

export function buildIndex(posts: PostSummary[]): void {
  const docs: SearchDoc[] = posts.map((p) => ({
    id: p.path,
    path: p.path,
    title: p.title,
    tags: (p.tags ?? []).join(' '),
    summary: p.summary ?? '',
  }))
  mini = makeIndex()
  mini.addAll(docs)
}

/** 重建索引(在 posts 列表变化后调用) */
export function rebuildIndex(posts: PostSummary[]): void {
  buildIndex(posts)
  // body 缓存里失效不存在的 path
  const valid = new Set(posts.map((p) => p.path))
  for (const k of Array.from(bodyCache.keys())) {
    if (!valid.has(k)) bodyCache.delete(k)
  }
}

/** 拉正文并缓存(供 body 搜索用) */
export async function primeBody(posts: PostSummary[]): Promise<void> {
  const missing = posts.filter((p) => !bodyCache.has(p.path))
  await Promise.all(
    missing.map(async (p) => {
      try {
        const res = await fetch(`/api/posts/${encodeURIComponent(p.path)}`)
        if (!res.ok) return
        const data = (await res.json()) as { content: string }
        bodyCache.set(p.path, data.content ?? '')
      } catch {
        /* ignore */
      }
    }),
  )
}

/** 简单 snippet:命中关键字前后各取 40 字符 */
function snippet(body: string, q: string): string {
  const i = body.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return body.slice(0, 80)
  const start = Math.max(0, i - 40)
  const end = Math.min(body.length, i + q.length + 40)
  return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '')
}

export function search(query: string, limit = 12): SearchHit[] {
  if (!mini || !query.trim()) return []
  const q = query.trim()
  const titleHits = mini.search(q).slice(0, limit)
  const seen = new Set(titleHits.map((h) => h.path))
  const hits: SearchHit[] = titleHits.map((h) => ({
    path: h.path as string,
    title: h.title as string,
    score: h.score,
    match: 'title',
  }))

  // 正文补充:在 title 没吃饱时去 body 找
  if (hits.length < limit) {
    for (const [path, body] of bodyCache) {
      if (seen.has(path)) continue
      if (body.toLowerCase().includes(q.toLowerCase())) {
        hits.push({ path, title: path, score: 0.1, match: 'body', snippet: snippet(body, q) })
        seen.add(path)
        if (hits.length >= limit) break
      }
    }
  }
  return hits
}

/** 释放全部(用于测试 / 热重载场景) */
export function dispose(): void {
  mini = null
  bodyCache.clear()
}
