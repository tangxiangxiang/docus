export interface PostSummary {
  path: string            // e.g. "hello-world" or "notes/draft" or "archive/2024/old" — relative to src/content/, no implicit prefix
  title: string
  /** Database creation date (YYYY-MM-DD, UTC), with legacy Frontmatter fallback. */
  created: string
  /** Database update date formatted as YYYY-MM-DD, with file mtime fallback. */
  updated: string
  tags: string[]
  summary?: string
  size: number
  mtime: number
  updatedReferences?: Array<{ path: string; raw: string; mtime: number }>
}

export type TreeNode =
  | { kind: 'file';   name: string; path: string; title: string; mtime: number }
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }

export interface PostDetail {
  path: string
  raw: string
  /** Markdown body with the frontmatter block stripped. Used by the
   *  client-side full-text search (primeBody) and by the preview pane —
   *  the raw field is what gets written back on save. */
  content: string
  frontmatter: Record<string, unknown>
  metadata?: DocumentMetadata
  size: number
  mtime: number
}

export interface DocumentMetadata {
  id: string
  path: string
  title: string
  summary: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export type UpdateDocumentMetadata = Pick<DocumentMetadata, 'title' | 'summary' | 'tags'>

export interface MetadataMigrationSummary {
  total: number
  legacy: number
  imported: number
  verified: number
  cleaned: number
  failed: number
  orphaned: number
}

export interface FrontmatterCleanupPreview {
  candidates: Array<{
    path: string
    beforeBytes: number
    afterBytes: number
    removedBytes: number
    customFields: string[]
  }>
  blocked: Array<{ path: string; reason: string }>
}

export interface FrontmatterMutationResult {
  changed: Array<{ path: string; newRaw: string; newMtime: number }>
  failed: Array<{ path: string; reason: string }>
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  if (!r.ok) {
    // See ai-api.ts: no error-body schema, cast to the shape we read.
    const body = (await r.json().catch(() => ({ error: r.statusText }))) as { error?: string }
    throw Object.assign(new Error(body.error ?? `HTTP ${r.status}`), { status: r.status, body })
  }
  return r.json() as Promise<T>
}

/** Path is already relative to `src/content/`, so it goes straight into the splat route. */
function splat(path: string): string {
  return path
}

export async function getTree(): Promise<TreeNode[]> {
  return jsonOrThrow<TreeNode[]>(await fetch('/api/tree'))
}

export async function listPosts(): Promise<PostSummary[]> {
  return jsonOrThrow<PostSummary[]>(await fetch('/api/posts'))
}

export async function getFileStates(paths: string[]): Promise<Array<{
  path: string; exists: boolean; mtime: number; size: number
}>> {
  return jsonOrThrow(await fetch('/api/files/state', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths }),
  }))
}

export async function getPost(path: string): Promise<PostDetail> {
  return jsonOrThrow<PostDetail>(await fetch('/api/posts/' + splat(path)))
}

export async function recoverPost(path: string, raw: string): Promise<{ ok: true; raw: string; mtime: number }> {
  return jsonOrThrow(await fetch('/api/recover/' + splat(path), {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
  }))
}

export async function updateDocumentMetadata(
  path: string,
  input: UpdateDocumentMetadata,
): Promise<DocumentMetadata> {
  return jsonOrThrow<DocumentMetadata>(await fetch('/api/metadata/documents/' + splat(path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function getMetadataMigrationStatus(): Promise<{
  running: boolean
  summary: MetadataMigrationSummary
  failures: Array<{ path: string; error: string }>
  cleanedPaths: string[]
}> {
  return jsonOrThrow(await fetch('/api/metadata/migration'))
}

export async function cleanDocumentFrontmatter(paths: string[]): Promise<FrontmatterMutationResult> {
  return jsonOrThrow(await fetch('/api/metadata/cleanup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths, confirm: 'REMOVE_FRONTMATTER' }),
  }))
}

export async function restoreDocumentFrontmatter(
  paths: string[],
  mode: 'canonical' | 'original' = 'original',
): Promise<FrontmatterMutationResult> {
  return jsonOrThrow(await fetch('/api/metadata/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths, mode, confirm: 'RESTORE_FRONTMATTER' }),
  }))
}

export async function getFrontmatterCleanupPreview(): Promise<FrontmatterCleanupPreview> {
  return jsonOrThrow(await fetch('/api/metadata/cleanup/preview'))
}

export async function exportDocumentFrontmatter(
  path: string,
  mode: 'canonical' | 'original' = 'canonical',
): Promise<string> {
  const query = new URLSearchParams({ path, mode })
  const result = await jsonOrThrow<{ frontmatter: string }>(
    await fetch('/api/metadata/export?' + query.toString()),
  )
  return result.frontmatter
}

export async function createPost(input: { path: string; title?: string }): Promise<PostSummary> {
  return jsonOrThrow<PostSummary>(await fetch('/api/posts', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }))
}

export async function patchPost(srcPath: string, body: { name?: string; targetPath?: string; updateReferences?: boolean }): Promise<PostSummary> {
  return jsonOrThrow<PostSummary>(await fetch('/api/posts/' + splat(srcPath), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function getRenameImpact(path: string, recursive = false): Promise<{ path: string; count: number; sources: string[] }> {
  return jsonOrThrow(await fetch('/api/links/rename-impact?path=' + encodeURIComponent(path) + (recursive ? '&recursive=true' : '')))
}

export async function deletePost(path: string): Promise<{ ok: true }> {
  return jsonOrThrow<{ ok: true }>(await fetch('/api/posts/' + splat(path), { method: 'DELETE' }))
}

export async function createFolder(path: string): Promise<{ path: string }> {
  return jsonOrThrow<{ path: string }>(await fetch('/api/folders', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  }))
}

export async function renameFolder(srcPath: string, newPath: string, updateReferences = false): Promise<{ path: string; moved: string[]; updatedReferences?: Array<{ path: string; raw: string; mtime: number }> }> {
  return jsonOrThrow<{ path: string; moved: string[]; updatedReferences?: Array<{ path: string; raw: string; mtime: number }> }>(await fetch('/api/folders/' + splat(srcPath), {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newPath, updateReferences }),
  }))
}

export async function deleteFolder(path: string, recursive: boolean): Promise<{ deleted: string[] }> {
  const url = '/api/folders/' + splat(path) + (recursive ? '?recursive=true' : '')
  return jsonOrThrow<{ deleted: string[] }>(await fetch(url, { method: 'DELETE' }))
}

// --- Link index (bi-directional links) ---

export interface Link {
  target: string
  alias?: string
  anchor?: string
  kind: 'wiki' | 'md'
}

export interface LinkIndexSnapshot {
  paths: string[]
  outgoing: Record<string, Link[]>
  /** path -> display title (database metadata -> Frontmatter -> first H1 -> filename). */
  titles?: Record<string, string>
}

export interface BacklinkRecord {
  source: string
  alias?: string
  anchor?: string
  kind: 'wiki' | 'md'
}

export async function getLinkIndexSnapshot(): Promise<LinkIndexSnapshot> {
  return jsonOrThrow<LinkIndexSnapshot>(await fetch('/api/links/index'))
}

export async function getBacklinks(path: string): Promise<BacklinkRecord[]> {
  return jsonOrThrow<BacklinkRecord[]>(
    await fetch('/api/backlinks?path=' + encodeURIComponent(path)),
  )
}
