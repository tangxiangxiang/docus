// HTTP layer for the history feature. Bind the L0 (git.ts) and
// L1 (diff.ts) modules to REST-ish endpoints the L3 UI can call.
//
// Design choices, in the same spirit as the other route files:
//   - handlers are thin: parse the request, call the L0/L1 service,
//     translate the result to status + JSON
//   - validation at the boundary, not the service layer
//   - errors come back as `{ error: <reason> }` with a 4xx/5xx
//     status. The UI knows the shape.
//   - capability is cached at module load: probing `git --version`
//     on every request would be wasteful, and the binary being on
//     PATH is effectively static for the lifetime of the process.
//
// repoRoot is module-scoped (not a constant) so tests can swap it
// with `setRepoRootForTesting`. Same pattern as setContentDir in
// ../paths.ts.

import { Hono } from 'hono'
import * as git from './git.js'
import { ensureRepo } from './repo.js'
import { computeFileDiff } from './diff.js'
import { CONTENT_DIR } from '../paths.js'
import {
  isManagedHistoryPath,
  isValidCommitSha,
  isValidHistoryPath,
  isValidHistoryRef,
  validateHistoryPaths,
} from './validation.js'

/**
 * Where git runs — the vault root. By default this is the same
 * directory the posts API reads from (CONTENT_DIR), so the git
 * repo lives at the vault root in both dev and production. That
 * keeps path conventions consistent: `git status --porcelain`
 * returns paths relative to the vault, which match the `inbox/x.md`
 * shape the rest of docus uses everywhere (URLs, tab.path, etc.).
 *
 * In dev that means the vault gets its own `.git/` inside
 * `<project>/src/content`, separate from the project's own git
 * repo at `<project>/.git/`. That's deliberate — vault history
 * should not include code commits, and code history should not
 * include unrelated vault snapshots.
 *
 * In production, set VAULT_DIR (see ../paths.ts) to point at
 * wherever the user's vault lives; repoRoot follows automatically.
 *
 * Tests inject a tempdir via `setRepoRootForTesting`.
 */
let _repoRoot: string = CONTENT_DIR

export function setRepoRootForTesting(dir: string): void {
  _repoRoot = dir
}

export function __resetRepoRootForTesting(): void {
  // Mirror the module-load default: read CONTENT_DIR rather than
  // process.cwd() so resetting after a test still gives us the
  // production-shaped default.
  _repoRoot = CONTENT_DIR
}

function repoRoot(): string {
  return _repoRoot
}

function bad(c: any, msg: string, code = 400) {
  return c.json({ error: msg }, code)
}

function validPathParam(c: any, value: string | undefined): string | Response {
  if (!value) return bad(c, 'path required')
  if (!isValidHistoryPath(value)) return bad(c, 'invalid path')
  return value
}

function validRefParam(
  c: any,
  value: string | undefined,
  name = 'ref',
  opts: { allowWorktree?: boolean } = {},
): string | Response {
  if (!value) return bad(c, name === 'ref' ? 'ref required' : `${name} ref required`)
  if (!isValidHistoryRef(value, opts)) return bad(c, 'invalid ref')
  return value
}

// --- capability -----------------------------------------------------------

// Probed once at module load. The result is "git on PATH" — that
// changes only at process restart, so per-request probing is wrong.
// Repos themselves can come and go (`ensureRepo` is idempotent),
// but `isRepo` is a cheap call so we do it on /capability rather
// than caching it here.
let _gitAvailable: boolean | null = null

async function probeGit(): Promise<boolean> {
  if (_gitAvailable !== null) return _gitAvailable
  try {
    const r = await git.run(repoRoot(), ['--version'])
    _gitAvailable = r.status === 0
  } catch {
    _gitAvailable = false
  }
  return _gitAvailable
}

/** Test hook: re-probe on the next capability check. */
export function __resetGitCapabilityForTesting(): void {
  _gitAvailable = null
}

const history = new Hono()

// ---- /capability ----
history.get('/capability', async (c) => {
  const available = await probeGit()
  if (!available) {
    return c.json({ gitAvailable: false, repoInitialized: false })
  }
  // ensureRepo is idempotent; calling it here costs at most one
  // fs.access and (on the first visit) one git init. We don't
  // init eagerly at module load because tests that never touch
  // the history feature shouldn't pay the cost.
  try {
    await ensureRepo(repoRoot())
  } catch (e: any) {
    // Init failure is a real problem but we don't want capability
    // to 500 — report it as "available but not initialized" with
    // the underlying error in `initError` so the UI can show a
    // specific message (e.g. "vault sits inside another git repo").
    return c.json({
      gitAvailable: true,
      repoInitialized: false,
      initError: e?.message ?? 'init failed',
    })
  }
  return c.json({ gitAvailable: true, repoInitialized: true })
})

// ---- /status ----
// Returns the dirty (or staged) file set. The L3 UI uses this to
// render the "Changes (N)" list and the dirty-count badge on the
// ActivityBar button.
history.get('/status', async (c) => {
  if (!(await probeGit())) return c.json({ dirty: [], available: false }, 503)
  try {
    await ensureRepo(repoRoot())
    const dirty = (await git.status(repoRoot()))
      .filter((entry) => !isManagedHistoryPath(entry.path))
    return c.json({ dirty, available: true })
  } catch (e: any) {
    return bad(c, e.message ?? 'status failed', 500)
  }
})

// ---- /log ----
// Commit history, newest-first. `?path=` filters to a single file.
history.get('/log', async (c) => {
  if (!(await probeGit())) return bad(c, 'git not available', 503)
  const pathParam = c.req.query('path')
  const limitStr = c.req.query('limit')
  const limit = limitStr ? Math.max(1, Math.min(2000, Number(limitStr) || 200)) : 200
  if (pathParam && !isValidHistoryPath(pathParam)) return bad(c, 'invalid path')
  const path = pathParam || undefined
  try {
    await ensureRepo(repoRoot())
    const commits = await git.log(repoRoot(), { path, limit })
    return c.json({ commits })
  } catch (e: any) {
    return bad(c, e.message ?? 'log failed', 500)
  }
})

// ---- /file ----
// Raw content of `path` at `ref` (a sha, branch, or HEAD). Used by
// the diff view to fetch the "old" version of a file. `ref` defaults
// to HEAD.
history.get('/file', async (c) => {
  if (!(await probeGit())) return bad(c, 'git not available', 503)
  const path = c.req.query('path')
  const ref = c.req.query('ref') ?? 'HEAD'
  const validPath = validPathParam(c, path)
  if (validPath instanceof Response) return validPath
  const validRef = validRefParam(c, ref, 'ref', { allowWorktree: true })
  if (validRef instanceof Response) return validRef
  try {
    await ensureRepo(repoRoot())
    const content = await git.rawAt(repoRoot(), validRef, validPath)
    if (content === null) return bad(c, 'not found at ref', 404)
    return c.json({ path: validPath, ref: validRef, content })
  } catch (e: any) {
    return bad(c, e.message ?? 'file failed', 500)
  }
})

// ---- /diff ----
// Line + word diff between two refs for a single file. The two refs
// are mandatory because the L1 layer has no concept of a "default"
// side — it just takes two strings.
//
// Why this is its own endpoint instead of letting the client call
// /file twice and run L1 in the browser: the L1 logic is server
// code, and the client shouldn't be pulling a Myers impl into the
// bundle. The savings are also small — diff for a vault note is
// usually < 5KB of JSON.
history.get('/diff', async (c) => {
  if (!(await probeGit())) return bad(c, 'git not available', 503)
  const path = c.req.query('path')
  const oldRef = c.req.query('old')
  const newRef = c.req.query('new')
  const validPath = validPathParam(c, path)
  if (validPath instanceof Response) return validPath
  if (!oldRef || !newRef) return bad(c, 'old and new refs required')
  const validOldRef = validRefParam(c, oldRef, 'old', { allowWorktree: true })
  if (validOldRef instanceof Response) return validOldRef
  const validNewRef = validRefParam(c, newRef, 'new', { allowWorktree: true })
  if (validNewRef instanceof Response) return validNewRef
  try {
    await ensureRepo(repoRoot())
    // Resolve both sides in parallel. rawAt returns null when the
    // file did not exist at the ref — pass that through as an
    // empty string so the diff endpoint always returns the same
    // shape regardless of the file's history.
    const [oldContent, newContent] = await Promise.all([
      git.rawAt(repoRoot(), validOldRef, validPath),
      git.rawAt(repoRoot(), validNewRef, validPath),
    ])
    const diff = computeFileDiff(oldContent, newContent)
    return c.json({ path: validPath, oldRef: validOldRef, newRef: validNewRef, diff })
  } catch (e: any) {
    return bad(c, e.message ?? 'diff failed', 500)
  }
})

// ---- /commits ----
// Create one commit from a list of paths and a message. Body:
//   { paths: string[], message: string }
//
// `message` must be non-empty after trim — empty messages defeat
// the purpose of a manual commit. The L0 layer's addAndCommit
// guards the same condition; we duplicate the check here so the
// 400 has a clear error message and the 500 ("git commit failed:
// ...") stays for genuine git failures.
//
// Status is re-read immediately before staging. The History panel can remain
// open while another editor restores, deletes, or moves files; rejecting a
// stale batch is safer than silently committing only the paths still dirty.
history.post('/commits', async (c) => {
  if (!(await probeGit())) return bad(c, 'git not available', 503)
  const body = await c.req.json().catch(() => null) as
    | { paths?: unknown; message?: unknown }
    | null
  if (!body) return bad(c, 'body required')
  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return bad(c, 'paths (non-empty array) required')
  }
  if (body.paths.some((p) => typeof p !== 'string' || p.length === 0)) {
    return bad(c, 'every path must be a non-empty string')
  }
  const paths = validateHistoryPaths(body.paths)
  if (!paths) return bad(c, 'invalid path')
  if (typeof body.message !== 'string' || body.message.trim().length === 0) {
    return bad(c, 'message must be a non-empty string')
  }
  try {
    await ensureRepo(repoRoot())
    const dirtyPaths = new Set((await git.status(repoRoot())).map((entry) => entry.path))
    const stalePaths = paths.filter((path) => !dirtyPaths.has(path))
    if (stalePaths.length > 0) {
      return bad(c, `selection is stale; no longer changed: ${stalePaths.join(', ')}`, 409)
    }
    const r = await git.addAndCommit(repoRoot(), paths, body.message)
    return c.json(r, 201)
  } catch (e: any) {
    const msg = e.message ?? 'commit failed'
    if (/nothing to commit/i.test(msg)) return bad(c, 'nothing to commit', 409)
    return bad(c, msg, 500)
  }
})

// ---- /drop ----
// Remove the latest commit from history while keeping its file changes
// in the working tree. This intentionally only accepts HEAD; dropping
// older commits would require history rewriting across descendants.
history.post('/drop', async (c) => {
  if (!(await probeGit())) return bad(c, 'git not available', 503)
  const body = await c.req.json().catch(() => null) as
    | { sha?: unknown }
    | null
  if (!body) return bad(c, 'body required')
  if (typeof body.sha !== 'string' || body.sha.length === 0) return bad(c, 'sha required')
  if (!isValidCommitSha(body.sha)) return bad(c, 'invalid sha')
  try {
    await ensureRepo(repoRoot())
    const r = await git.dropHeadCommit(repoRoot(), body.sha)
    return c.json(r, 201)
  } catch (e: any) {
    const msg = e.message ?? 'drop failed'
    if (/only the latest commit/i.test(msg)) return bad(c, msg, 409)
    if (/bad revision|unknown revision|not a valid object name/i.test(msg)) return bad(c, msg, 404)
    return bad(c, msg, 500)
  }
})

// ---- /restore ----
// Overwrite a single file's working-tree content with the blob at
// `ref`. The file's git history is NOT touched — only the on-disk
// version changes, so the user gets the diff they were looking at
// as the new working state and can commit it themselves.
//
// Body: { path: string, ref: string }
// The caller is responsible for confirming the destructive overwrite
// in the UI; we don't gate on a `confirm` flag here because the UI
// already has the diff on screen, so the user has seen what they're
// about to replace.
//
// Returns: { path, ref } on success. 404 if the file does not exist
// at that ref, 400 if the path/ref is malformed / missing.
history.post('/restore', async (c) => {
  if (!(await probeGit())) return bad(c, 'git not available', 503)
  const body = await c.req.json().catch(() => null) as
    | { path?: unknown; ref?: unknown }
    | null
  if (!body) return bad(c, 'body required')
  if (typeof body.path !== 'string' || body.path.length === 0) {
    return bad(c, 'path required')
  }
  if (typeof body.ref !== 'string' || body.ref.length === 0) {
    return bad(c, 'ref required')
  }
  const validPath = validPathParam(c, body.path)
  if (validPath instanceof Response) return validPath
  if (body.ref !== git.WORKTREE_REF && !isValidHistoryRef(body.ref)) return bad(c, 'invalid ref')
  try {
    await ensureRepo(repoRoot())
    // WORKTREE is a sentinel meaning "the file as it sits on disk".
    // Restoring TO the working tree is a no-op (you can't restore to
    // the thing you're overwriting). Reject explicitly so the caller
    // gets a clean 400 instead of a confusing git stderr.
    if (body.ref === git.WORKTREE_REF) {
      return bad(c, 'cannot restore to the working tree', 400)
    }
    // Pre-check: confirm the file exists at that ref so we can return
    // a clean 404 instead of a generic git error. Cheaper than parsing
    // git checkout's stderr in every error path.
    const exists = await git.rawAt(repoRoot(), body.ref, validPath)
    if (exists === null) {
      return bad(c, `file does not exist at ref ${body.ref}`, 404)
    }
    await git.restoreFile(repoRoot(), body.ref, validPath)
    return c.json({ path: validPath, ref: body.ref })
  } catch (e: any) {
    const msg = e.message ?? 'restore failed'
    // git checkout's "pathspec ... did not match" / "invalid reference"
    // both surface here as git stderr. The pre-check above catches
    // most not-found cases, but a race between rawAt and checkout
    // can still slip through (e.g. someone ran `git rm` in another
    // shell). Treat "did not match" / "invalid" as 4xx rather than
    // 500 — they're user-recoverable, not server faults.
    if (/did not match/i.test(msg) || /invalid reference/i.test(msg) || /bad revision/i.test(msg)) {
      return bad(c, msg, 404)
    }
    return bad(c, msg, 500)
  }
})

export default history
