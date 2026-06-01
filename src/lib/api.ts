export interface PostSummary {
  slug: string
  title: string
  date: string
  tags: string[]
  summary?: string
  size: number
  mtime: number
}

export interface PostFull {
  slug: string
  raw: string
  frontmatter: Record<string, unknown>
  content: string
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function listPosts(): Promise<PostSummary[]> {
  return json<{ posts: PostSummary[] }>(await fetch('/api/posts')).then((r) => r.posts)
}

export async function getPost(slug: string): Promise<PostFull> {
  return json<PostFull>(await fetch(`/api/posts/${encodeURIComponent(slug)}`))
}

export async function createPost(slug: string, raw: string): Promise<void> {
  await json(await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, raw }),
  }))
}

export async function savePost(slug: string, raw: string): Promise<void> {
  await json(await fetch(`/api/posts/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  }))
}

export async function deletePost(slug: string): Promise<void> {
  await json(await fetch(`/api/posts/${encodeURIComponent(slug)}`, { method: 'DELETE' }))
}

export async function renamePost(oldSlug: string, newSlug: string): Promise<{ slug: string }> {
  return json<{ ok: true; slug: string }>(await fetch(`/api/posts/${encodeURIComponent(oldSlug)}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newSlug }),
  }))
}
