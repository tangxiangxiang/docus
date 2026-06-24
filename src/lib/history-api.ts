// Wire types + typed fetch wrappers for /api/history/*.
//
// Mirrors the server's `server/history/routes.ts` response shapes.
// The StatusEntry / CommitRecord / FileDiff types are also exported
// from this file so the diff renderer and the timeline list can
// share a single source of truth (the server imports these from
// here too — see git.ts and diff.ts, which re-export what they
// need).

export interface Capability {
  gitAvailable: boolean
  repoInitialized: boolean
}

/**
 * One dirty (or staged) file as `git status --porcelain` reports it.
 * `index` is the staged-letter (or ' ' for unstaged), `worktree` is
 * the worktree-letter. Untracked files report "??" / "?" / "?". The
 * `path` is forward-slash and relative to the vault root.
 */
export interface StatusEntry {
  path: string
  index: string
  worktree: string
}

export interface CommitRecord {
  sha: string
  author: string
  /** ISO-8601 strict format (committer date). */
  date: string
  subject: string
  body: string
  /** Paths touched by this commit, in `git show --name-only` order. */
  files: string[]
}

/**
 * A single line of a diff. `oldLine` is 1-based and null for an
 * add-only row; `newLine` is 1-based and null for a remove-only row.
 * `words` is the optional word-level breakdown for highlight
 * rendering — same shape as `ops` but constrained to a single line.
 */
export type DiffOpKind = 'equal' | 'add' | 'remove'

export interface DiffOp {
  op: DiffOpKind
  oldLine: number | null
  newLine: number | null
  text: string
  words?: DiffOp[]
}

export interface FileDiff {
  ops: DiffOp[]
  stats: { added: number; removed: number; equal: number }
}

// --- Capability ------------------------------------------------------------

export async function getCapability(): Promise<Capability> {
  const r = await fetch('/api/history/capability')
  return r.json()
}

// --- Status ----------------------------------------------------------------

export async function getStatus(): Promise<{ dirty: StatusEntry[]; available: boolean }> {
  const r = await fetch('/api/history/status')
  return r.json()
}

// --- Log -------------------------------------------------------------------

export async function getLog(opts: { path?: string; limit?: number } = {}): Promise<{ commits: CommitRecord[] }> {
  const q = new URLSearchParams()
  if (opts.path) q.set('path', opts.path)
  if (opts.limit !== undefined) q.set('limit', String(opts.limit))
  const r = await fetch(`/api/history/log?${q.toString()}`)
  return r.json()
}

// --- File ------------------------------------------------------------------

export async function getFileAt(path: string, ref: string): Promise<{ path: string; ref: string; content: string }> {
  const q = new URLSearchParams({ path, ref })
  const r = await fetch(`/api/history/file?${q.toString()}`)
  if (!r.ok) throw new Error(`getFileAt ${path}@${ref}: ${r.status}`)
  return r.json()
}

// --- Diff ------------------------------------------------------------------

export async function getDiff(path: string, oldRef: string, newRef: string): Promise<{ path: string; oldRef: string; newRef: string; diff: FileDiff }> {
  const q = new URLSearchParams({ path, old: oldRef, new: newRef })
  const r = await fetch(`/api/history/diff?${q.toString()}`)
  if (!r.ok) throw new Error(`getDiff ${path}: ${r.status}`)
  return r.json()
}

// --- Commits ---------------------------------------------------------------

export interface CommitResult {
  sha: string
  filesCommitted: string[]
}

export async function createCommit(paths: string[], message: string): Promise<CommitResult> {
  const r = await fetch('/api/history/commits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths, message }),
  })
  if (!r.ok) {
    // Try to surface the server's error string. Some failures (e.g.
    // 503 "git not available") set `available: false` rather than
    // `error`, but the route also writes `{ error: ... }` in that
    // case — see routes.ts. Read both fields defensively.
    const body = await r.json().catch(() => ({} as any))
    throw new Error(body?.error ?? `createCommit failed: ${r.status}`)
  }
  return r.json()
}
