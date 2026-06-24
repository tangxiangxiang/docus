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

/**
 * Where git runs. The vault root — the directory the user pointed
 * docus at. In dev that's `process.cwd()`. Tests inject a tempdir.
 */
let _repoRoot: string = process.cwd()

export function setRepoRootForTesting(dir: string): void {
  _repoRoot = dir
}

export function __resetRepoRootForTesting(): void {
  _repoRoot = process.cwd()
}

function repoRoot(): string {
  return _repoRoot
}

function bad(c: any, msg: string, code = 400) {
  return c.json({ error: msg }, code)
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
  } catch {
    // init failure is a real problem but we don't want capability
    // to 500 — report it as "available but not initialized" and
    // let the user re-trigger via a UI prompt.
    return c.json({ gitAvailable: true, repoInitialized: false })
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
    const dirty = await git.status(repoRoot())
    return c.json({ dirty, available: true })
  } catch (e: any) {
    return bad(c, e.message ?? 'status failed', 500)
  }
})

// ---- /log ----
// Commit history, newest-first. `?path=` filters to a single file.
history.get('/log', async (c) => {
  if (!(await probeGit())) return bad(c, 'git not available', 503)
  const path = c.req.query('path')
  const limitStr = c.req.query('limit')
  const limit = limitStr ? Math.max(1, Math.min(2000, Number(limitStr) || 200)) : 200
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
  if (!path) return bad(c, 'path required')
  try {
    await ensureRepo(repoRoot())
    const content = await git.rawAt(repoRoot(), ref, path)
    if (content === null) return bad(c, 'not found at ref', 404)
    return c.json({ path, ref, content })
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
  if (!path) return bad(c, 'path required')
  if (!oldRef || !newRef) return bad(c, 'old and new refs required')
  try {
    await ensureRepo(repoRoot())
    // Resolve both sides in parallel. rawAt returns null when the
    // file did not exist at the ref — pass that through as an
    // empty string so the diff endpoint always returns the same
    // shape regardless of the file's history.
    const [oldContent, newContent] = await Promise.all([
      git.rawAt(repoRoot(), oldRef, path),
      git.rawAt(repoRoot(), newRef, path),
    ])
    const diff = computeFileDiff(oldContent, newContent)
    return c.json({ path, oldRef, newRef, diff })
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
  if (typeof body.message !== 'string' || body.message.trim().length === 0) {
    return bad(c, 'message must be a non-empty string')
  }
  try {
    await ensureRepo(repoRoot())
    const r = await git.addAndCommit(repoRoot(), body.paths as string[], body.message)
    return c.json(r, 201)
  } catch (e: any) {
    const msg = e.message ?? 'commit failed'
    if (/nothing to commit/i.test(msg)) return bad(c, 'nothing to commit', 409)
    return bad(c, msg, 500)
  }
})

export default history
