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
  /** Present only when repoInitialized is false but git is available
     — explains why the auto-init failed (e.g. vault sits inside
     another git repo, .git/ write failed, etc.). */
  initError?: string
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
 * Sentinel ref meaning "the file as it currently sits on disk,
 * unsaved/uncommitted". The diff endpoint resolves this to a direct
 * read of the working tree; the value is never sent to `git` itself
 * (so no risk of injection). Mirrors `server/history/git.ts`'s
 * `WORKTREE_REF`.
 */
export const WORKTREE_REF = 'WORKTREE'

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

/* Single fetch wrapper for endpoints that use the standard `{ error:
   string }` failure shape. Surfaces that string in the thrown Error so
   callers see what the server actually said — e.g. "file does not
   exist at ref HEAD~1" rather than a generic "getDiff: 404". If the
   body has no `error` field (older routes, partial responses), we fall
   back to "<endpoint> failed: <status>".

   Most routes use this contract. /status is the exception: a missing
   git binary returns 503 + `{ dirty: [], available: false }` as a
   graceful "unavailable" signal that the caller is expected to read
   from the body, NOT an error. Pass `allowNonOkJson: true` for that
   case so the body comes through and refreshStatus can flip
   `_available` itself. */
export class HistoryApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HistoryApiError'
    this.status = status
  }
}

async function readJson<T>(r: Response, fallback: string, opts: { allowNonOkJson?: boolean } = {}): Promise<T> {
  if (r.ok || opts.allowNonOkJson) {
    return r.json() as Promise<T>
  }
  const body = (await r.json().catch(() => ({}))) as { error?: unknown }
  const message = typeof body.error === 'string' ? body.error : `${fallback}: ${r.status}`
  throw new HistoryApiError(message, r.status)
}

export async function getCapability(): Promise<Capability> {
  const r = await fetch('/api/history/capability')
  return readJson<Capability>(r, 'getCapability failed')
}

// --- Status ----------------------------------------------------------------

export async function getStatus(): Promise<{ dirty: StatusEntry[]; available: boolean }> {
  /* /status uses 503 + `{ available: false }` to mean "git is
     missing on this machine", not "the request failed". The panel
     reads `available` off the body and renders a "Git is not
     available" EmptyState — throwing here would surface a useless
     "getStatus failed: 503" in the History panel's error slot and
     hide the actual reason from the user. */
  const r = await fetch('/api/history/status')
  return readJson(r, 'getStatus failed', { allowNonOkJson: true })
}

// --- Log -------------------------------------------------------------------

export async function getLog(opts: { path?: string; limit?: number } = {}): Promise<{ commits: CommitRecord[] }> {
  const q = new URLSearchParams()
  if (opts.path) q.set('path', opts.path)
  if (opts.limit !== undefined) q.set('limit', String(opts.limit))
  const r = await fetch(`/api/history/log?${q.toString()}`)
  return readJson(r, 'getLog failed')
}

// --- File ------------------------------------------------------------------

export async function getFileAt(path: string, ref: string): Promise<{ path: string; ref: string; content: string }> {
  const q = new URLSearchParams({ path, ref })
  const r = await fetch(`/api/history/file?${q.toString()}`)
  return readJson(r, `getFileAt ${path}@${ref} failed`)
}

// --- Diff ------------------------------------------------------------------

export async function getDiff(path: string, oldRef: string, newRef: string): Promise<{ path: string; oldRef: string; newRef: string; diff: FileDiff }> {
  const q = new URLSearchParams({ path, old: oldRef, new: newRef })
  const r = await fetch(`/api/history/diff?${q.toString()}`)
  return readJson(r, `getDiff ${path} failed`)
}

// --- Commits ---------------------------------------------------------------

export interface CommitResult {
  sha: string
  filesCommitted: string[]
}

export type ContentHashes = Record<string, string | null>

export async function getContentHashes(paths: string[]): Promise<ContentHashes> {
  const r = await fetch('/api/history/content-hashes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  })
  const result = await readJson<{ hashes: ContentHashes }>(r, 'getContentHashes failed')
  return result.hashes
}

export async function createCommit(
  paths: string[],
  message: string,
  expected: ContentHashes,
): Promise<CommitResult> {
  const r = await fetch('/api/history/commits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths, message, expected }),
  })
  return readJson(r, 'createCommit failed')
}

export async function dropCommit(sha: string): Promise<CommitResult> {
  const r = await fetch('/api/history/drop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sha }),
  })
  return readJson(r, 'dropCommit failed')
}

// --- Restore ---------------------------------------------------------------

/**
 * Overwrite the on-disk `path` with its content at `ref`. Does NOT
 * create a commit — the change sits in the working tree after this
 * call returns, and the user can commit it via the normal flow.
 *
 * Throws on 404 (file does not exist at ref) or 503 (git missing);
 * the message comes from the server's `{ error }` body so the UI
 * can show it verbatim.
 */
export interface RestoreFileResult {
  path: string
  ref: string
  raw: string
  mtime: number
}

export async function restoreFile(path: string, ref: string): Promise<RestoreFileResult> {
  const r = await fetch('/api/history/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, ref }),
  })
  return readJson(r, 'restoreFile failed')
}
