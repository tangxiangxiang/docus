export interface PostSummary {
  path: string            // replaces slug; e.g. "posts/hello-world" or "posts/notes/draft"
  title: string
  date: string
  tags: string[]
  summary?: string
  size: number
  mtime: number
}

export type TreeNode =
  | { kind: 'file';   name: string; path: string; title: string; mtime: number }
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }

export interface PostDetail {
  path: string
  raw: string
  frontmatter: Record<string, unknown>
  size: number
  mtime: number
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }))
    throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status, body })
  }
  return r.json() as Promise<T>
}

export async function getTree(): Promise<TreeNode[]> {
  return jsonOrThrow<TreeNode[]>(await fetch('/api/tree'))
}

export async function listPosts(): Promise<PostSummary[]> {
  return jsonOrThrow<PostSummary[]>(await fetch('/api/posts'))
}

export async function getPost(path: string): Promise<PostDetail> {
  return jsonOrThrow<PostDetail>(await fetch('/api/posts/' + encodeURI(path).replace(/^posts%2F/, 'posts/')))
}

export async function createPost(input: { path: string; title?: string }): Promise<PostSummary> {
  return jsonOrThrow<PostSummary>(await fetch('/api/posts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function patchPost(srcPath: string, body: { name?: string; targetPath?: string }): Promise<PostSummary> {
  return jsonOrThrow<PostSummary>(await fetch('/api/posts/' + encodeURI(srcPath).replace(/^posts%2F/, 'posts/'), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function deletePost(path: string): Promise<{ ok: true }> {
  return jsonOrThrow<{ ok: true }>(await fetch('/api/posts/' + encodeURI(path).replace(/^posts%2F/, 'posts/'), { method: 'DELETE' }))
}

export async function createFolder(path: string): Promise<{ path: string }> {
  return jsonOrThrow<{ path: string }>(await fetch('/api/folders', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  }))
}

export async function renameFolder(srcPath: string, newPath: string): Promise<{ path: string; moved: string[] }> {
  return jsonOrThrow<{ path: string; moved: string[] }>(await fetch('/api/folders/' + encodeURI(srcPath).replace(/^posts%2F/, 'posts/'), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newPath }),
  }))
}

export async function deleteFolder(path: string, recursive: boolean): Promise<{ deleted: string[] }> {
  const url = '/api/folders/' + encodeURI(path).replace(/^posts%2F/, 'posts/') + (recursive ? '?recursive=true' : '')
  return jsonOrThrow<{ deleted: string[] }>(await fetch(url, { method: 'DELETE' }))
}
