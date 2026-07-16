// Thin wrapper over the `git` CLI for the history feature.
//
// Design choices:
//   - exec via child_process.spawn (no shell) with the repo root as cwd.
//     Promisified in `run()` below so call sites look synchronous.
//   - All inputs are vetted at the API layer (paths, messages); this
//     module is the boundary that calls into git. It does NOT validate
//     paths — that is `assertSafePath` from ../paths.js, applied by
//     callers. Treat `repoRoot` as trusted.
//   - The wrapper never throws on a non-zero exit. It returns
//     `{stdout, stderr, status, code}` so callers can interpret the
//     failure (e.g. "not a git repository") without an exception
//     bubbling through a try/catch. The two exceptions: `spawn` itself
//     failing (ENOENT for git not on PATH) — that is a real configuration
//     problem, not a git error, and surfaces as a typed error.
//
// Why the CLI and not a library like simple-git: docus's history tool
// only needs log/status/show/diff/init — five commands. A lib would
// add a dependency for behavior we can describe in ~20 lines each, and
// would not improve testability (we still have to fake a real repo
// for end-to-end coverage anyway).

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

const DEFAULT_GIT_TIMEOUT_MS = 15_000
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024

export type RunResult = {
  status: number
  stdout: string
  stderr: string
}

/**
 * Sentinel ref meaning "the file as it currently sits on disk,
 * unsaved/uncommitted". Used by the diff route so users can see
 * their pending edits vs the last committed version without having
 * to stage and commit first. NOT a valid ref for `git checkout` —
 * the restore route catches that and returns a 4xx.
 */
export const WORKTREE_REF = 'WORKTREE'

/**
 * Error thrown when `git` itself cannot be spawned (binary missing).
 * Distinct from a non-zero exit (a legitimate git error) — the API
 * layer surfaces this as 503 / "git unavailable", not as 500.
 */
export class GitUnavailableError extends Error {
  constructor(cause: unknown) {
    super('git binary not available on PATH')
    this.name = 'GitUnavailableError'
    this.cause = cause
  }
}

function appendCapped(current: string, chunk: string): string {
  if (current.length >= MAX_CAPTURE_BYTES) return current
  const remaining = MAX_CAPTURE_BYTES - current.length
  return current + chunk.slice(0, remaining)
}

/**
 * Run a git subcommand. Resolves with the captured output; rejects
 * only on spawn failure (no shell escaping concerns, args are passed
 * verbatim).
 */
export function run(
  repoRoot: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: Buffer | string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      windowsHide: true,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let capped = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, DEFAULT_GIT_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c) => {
      const next = appendCapped(stdout, c)
      capped ||= next.length < stdout.length + c.length
      stdout = next
      if (capped) child.kill('SIGKILL')
    })
    child.stderr.on('data', (c) => {
      const next = appendCapped(stderr, c)
      capped ||= next.length < stderr.length + c.length
      stderr = next
      if (capped) child.kill('SIGKILL')
    })
    child.stdin.end(options.input)
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new GitUnavailableError(err))
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const suffix = timedOut
        ? `git command timed out after ${DEFAULT_GIT_TIMEOUT_MS}ms`
        : capped
          ? `git output exceeded ${MAX_CAPTURE_BYTES} bytes`
          : ''
      resolve({
        status: timedOut || capped ? -1 : (code ?? -1),
        stdout,
        stderr: suffix ? [stderr.trim(), suffix].filter(Boolean).join('\n') : stderr,
      })
    })
  })
}

function safeWorktreeFile(repoRoot: string, filePath: string): string {
  const root = path.resolve(repoRoot)
  const resolved = path.resolve(root, filePath)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`path escapes repo root: ${filePath}`)
  }
  return resolved
}

/**
 * Is `repoRoot` inside a git working tree? Returns false if the
 * directory has no `.git` (e.g. a brand-new vault, or someone deleted
 * `.git` by accident). Cheap call: `git rev-parse --is-inside-work-tree`.
 */
export async function isRepo(repoRoot: string): Promise<boolean> {
  const r = await run(repoRoot, ['rev-parse', '--is-inside-work-tree'])
  return r.status === 0 && r.stdout.trim() === 'true'
}

/**
 * Initialize a brand-new repo at `repoRoot` and configure
 * `core.autocrlf=false` locally so the diff output is stable across
 * platforms. Does NOT touch .gitignore / .gitattributes — that's the
 * caller's job (initRepo) so this function stays a pure git op.
 */
export async function initRepo(repoRoot: string): Promise<void> {
  // `--initial-branch=main` to avoid the "hint: Using 'master' as the
  // name for the initial branch" warning on Windows. Fall back to
  // the older flag if the installed git doesn't recognize it.
  let r = await run(repoRoot, ['init', '--initial-branch=main'])
  if (r.status !== 0) r = await run(repoRoot, ['init', '--initial-branch=master'])
  if (r.status !== 0) r = await run(repoRoot, ['init']) // ancient git
  if (r.status !== 0) {
    throw new Error(`git init failed: ${r.stderr.trim()}`)
  }
  // Disable autocrlf so the bytes we read back from `git show` match
  // the bytes we wrote. Without this, Windows machines with
  // core.autocrlf=true mangle line endings in the index.
  const cfg = await run(repoRoot, ['config', 'core.autocrlf', 'false'])
  if (cfg.status !== 0) {
    throw new Error(`git config core.autocrlf failed: ${cfg.stderr.trim()}`)
  }
}

// --- Status ----------------------------------------------------------------

/**
 * One dirty (or staged) file as `git status --porcelain` reports it.
 * `index` is the staged-letter (or ' ' for unstaged), `worktree` is
 * the worktree-letter. For untracked files the convention is "??" in
 * `index` and "?" in `worktree`. The combined two-char XY string is
 * what porcelain emits.
 */
export type StatusEntry = {
  path: string // forward-slash, relative to repo root
  index: string // ' ' | 'M' | 'A' | 'D' | 'R' | 'C' | '?'
  worktree: string // ' ' | 'M' | 'A' | 'D' | '?' | '!'
}

const XY_RE = /^([ MADRCU?!])([ MADRCU?!]) (.+)$/

/**
 * Parse `git status --porcelain` output. Lines that don't match the
 * canonical XY-path format are dropped silently — future git versions
 * could add new codes; we'd rather return fewer entries than throw.
 */
export function parsePorcelain(text: string): StatusEntry[] {
  const out: StatusEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const m = XY_RE.exec(line)
    if (!m) continue
    // Porcelain v1 uses quoted paths with C-style escapes for non-ASCII.
    // We only consume ASCII file names from the vault, so the unquote
    // is a no-op for our inputs but is here as a guard.
    const raw = m[3]
    const path = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\([\\"])/g, '$1') : raw
    out.push({ index: m[1], worktree: m[2], path })
  }
  return out
}

export async function status(repoRoot: string): Promise<StatusEntry[]> {
  // `-uall` enumerates each file inside untracked directories. The
  // default (`normal`) collapses a wholly-untracked dir like
  // `inbox/` into a single `?? inbox/` line, which would surface in
  // the History panel as one row representing the directory — useless
  // for selection, diff, or "Commit N files" counting. `-uall` still
  // honours `.gitignore` (files matching an ignore pattern remain
  // hidden); the trade-off is just longer output on a fresh vault.
  const r = await run(repoRoot, ['status', '--porcelain', '--untracked-files=all'])
  if (r.status !== 0) {
    throw new Error(`git status failed: ${r.stderr.trim()}`)
  }
  return parsePorcelain(r.stdout)
}

// --- Log -------------------------------------------------------------------

export type CommitRecord = {
  sha: string
  author: string
  /** ISO-8601, local repo time (committer date). */
  date: string
  subject: string
  body: string
  /** Paths touched by this commit, in `git show --name-only` order. */
  files: string[]
}

// Exported (not just `const`) so the parseLog regression tests can
// build synthetic blocks in the same format the L0 wrapper emits.
export const LOG_SEPARATOR = '\x1e__DOCUS_LOG__\x1e'
// The 0x1e (record separator) is illegal in a commit message body,
// so it doubles as a robust line/group delimiter that survives any
// pathological input.

const LOG_FORMAT = [
  `${LOG_SEPARATOR}%H`, // sha
  '%an', // author name
  '%aI', // author date, strict ISO
  '%s', // subject (first line)
  '%b', // body (everything after subject)
].join('%x00') + '%x00' // trailing NUL terminates the last field

/**
 * Read commit history, newest-first. If `path` is given, only commits
 * touching that path are returned (`--follow` makes git track renames).
 * Caps at `limit` entries (default 200 — vault histories stay small,
 * UI can paginate later if it ever matters).
 */
export async function log(
  repoRoot: string,
  opts: { path?: string; limit?: number } = {},
): Promise<CommitRecord[]> {
  const limit = opts.limit ?? 200
  const args = [
    'log',
    `--pretty=format:${LOG_FORMAT}`,
    '--name-only',
    `-n${limit}`,
  ]
  if (opts.path) {
    // No `--follow` for now: on a vanilla "create new file" commit,
    // `--follow` falsely attributes earlier commits of unrelated files
    // to this path. docus notes are rarely renamed; if/when a user
    // actually renames a note and wants the history merged, we can
    // add a follow=true opt. Keep the args list flat — `--` separates
    // rev args from path args so a path that starts with `-` is safe.
    args.push('--', opts.path)
  }
  const r = await run(repoRoot, args)
  if (r.status !== 0) {
    // "your current branch 'main' does not have any commits yet" is
    // a normal, expected state for a freshly-initialized vault — the
    // repo exists, the user just hasn't committed anything. Treat it
    // as an empty log rather than a server fault; the route returns
    // `{ commits: [] }` with 200, and the History panel shows
    // "No commits yet." The wording varies across git versions
    // (older git said "ambiguous argument 'HEAD'", git 2.3+ says
    // "does not have any commits yet") so we match on a substring
    // that both share.
    if (/does not have any commits yet/i.test(r.stderr)
        || /ambiguous argument ['"]?HEAD['"]?/i.test(r.stderr)) {
      return []
    }
    throw new Error(`git log failed: ${r.stderr.trim()}`)
  }
  return parseLog(r.stdout)
}

export function parseLog(text: string): CommitRecord[] {
  if (!text) return []
  const records: CommitRecord[] = []
  // Split on the record separator, drop empties.
  const blocks = text.split(LOG_SEPARATOR).filter((b) => b.length > 0)
  for (const block of blocks) {
    // Each block is: <fields...>\x00\n<name-only list, one per line>
    // The header is NUL-separated fields (sha, author, date, subject,
    // body, trailing ''), terminated by a newline. The body field can
    // itself contain newlines (multi-line commit messages), so we can't
    // just find the first \n — that's the line that says "The NUL-
    // terminated header is everything up to the FIRST \n that begins a
    // line that does NOT contain a NUL" in spirit, but the original
    // implementation used `block.indexOf('\n')`, which is the first \n
    // in the body for multi-line commits. That caused the file list to
    // absorb the rest of the body, and `files[0]` returned the first
    // body line as if it were a path. Walk line-by-line and return the
    // offset of the first \n whose NEXT line has no NUL.
    const headerEnd = findHeaderEnd(block)
    const header = headerEnd === -1 ? block : block.slice(0, headerEnd)
    const tail = headerEnd === -1 ? '' : block.slice(headerEnd + 1)
    const parts = header.split('\x00')
    // parts: [sha, author, date, subject, body, '']
    // body may itself contain NULs only if the commit message did,
    // which doesn't happen in normal use — collapse trailing empties.
    while (parts.length > 5 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
      parts.pop()
    }
    const [sha, author, date, subject, body = ''] = parts
    if (!sha) continue
    const files = tail.split('\n').map((s) => s.trim()).filter(Boolean)
    records.push({ sha, author, date, subject, body, files })
  }
  return records
}

/**
 * Find the offset of the newline that ends the NUL-separated header
 * (and thus begins the file-name list). The header is the prefix up
 * to and including the last NUL-terminated field plus its trailing
 * \n. Since the body field can contain \n, the right boundary is
 * the LAST \n whose preceding line contains a NUL — file-name lines
 * never contain NUL, so the NUL-containing lines are entirely
 * within the header. Returns -1 if no such boundary exists (no file
 * list at all).
 */
function findHeaderEnd(block: string): number {
  let lastNulLineEnd = -1
  let i = 0
  while (i < block.length) {
    const nl = block.indexOf('\n', i)
    if (nl === -1) break
    const line = block.slice(i, nl)
    if (line.includes('\x00')) {
      lastNulLineEnd = nl
    }
    i = nl + 1
  }
  return lastNulLineEnd
}

// --- Show / raw content at a ref ------------------------------------------

/**
 * Read the raw content of `path` as it exists at `ref` (a commit sha,
 * branch name, etc.). Returns null if the file does not exist at that
 * ref (e.g. it was added later or deleted earlier). Throws on a
 * genuine git error.
 *
 * The flag combo `--text` + `-z` + `<sha>:<path>` is a code-path with
 * very few failure modes. The exit status is the only reliable signal
 * for "file does not exist at this ref" (git prints the error and
 * exits 128).
 */
export async function rawAt(
  repoRoot: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  // "WORKTREE" is a sentinel meaning "the file as it sits on disk
  // right now, before staging or committing". It's not a real git
  // ref — we read the file from the working tree directly. Used by
  // the diff route so the user can see their uncommitted edits
  // without having to stage + commit first.
  if (ref === WORKTREE_REF) {
    try {
      return await fs.readFile(safeWorktreeFile(repoRoot, filePath), 'utf8')
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null
      throw e
    }
  }
  const r = await run(repoRoot, ['show', `${ref}:${filePath}`])
  if (r.status === 0) return r.stdout
  // Six error patterns all mean "no such (ref, path) tuple" — or in the
  // empty-repo case, "no such ref at all". We treat all of them as null
  // rather than throwing because the caller — the diff route — wants
  // to render "this file did not exist in the old version" gracefully,
  // AND the HistoryPanel wants the first commit on a fresh vault to
  // land cleanly (a 500 on HEAD~1/HEAD would crash the panel before
  // the user even has anything to commit).
  if (
    /does not exist/i.test(r.stderr) ||
    /bad revision/i.test(r.stderr) ||
    /exists on disk, but not in/i.test(r.stderr) ||
    /not in /i.test(r.stderr) ||
    // Empty repo / bad symbolic ref. We cover the three shapes git
    // actually emits so the empty-vault flow doesn't 500:
    //   - "fatal: invalid object name 'HEAD~1'"  (no commits → HEAD~1)
    //   - "fatal: ambiguous argument 'HEAD'..." (depends on git version)
    //   - "fatal: unknown revision or path not in the working tree"
    // None of these are bugs the caller can do anything about, so
    // collapsing them all to null keeps the diff route happy on the
    // very first commit attempt.
    /invalid object name/i.test(r.stderr) ||
    /ambiguous argument/i.test(r.stderr) ||
    /unknown revision/i.test(r.stderr)
  ) {
    return null
  }
  throw new Error(`git show failed: ${r.stderr.trim()}`)
}

// --- Commit ----------------------------------------------------------------

/**
 * Make sure the vault repo has a `user.name` + `user.email` configured
 * before the first commit. A bare `git init` (which is what
 * `initRepo` does) does NOT set a committer identity — git only
 * complains when you actually try to commit, so the failure surfaces
 * late and far from the cause.
 *
 * We use local config (the default scope of `git config`, no
 * `--global`) so:
 *   - the identity is per-vault, not per-user — a single `node`
 *     container user can host multiple vaults with different
 *     identities.
 *   - we don't touch `~/.gitconfig` inside the container, which
 *     would be lost on every redeploy anyway.
 *   - the local config wins over any global config (git precedence:
 *     local > global > system), so the env-var override actually
 *     applies even on dev machines that have a global identity set.
 *
 * Identity source, in priority order:
 *   1. Whatever is already in the repo's LOCAL config (preserved —
 *      a vault cloned from another machine keeps its real author).
 *   2. GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL env vars (so operators can
 *      pick a per-host identity without rebuilding the image).
 *   3. "docus" / "docus@localhost" as a last-resort default.
 *
 * `git config --local --get` exits non-zero on a missing key — that's
 * the "is local config set?" check. We intentionally do NOT use
 * `--get` (effective) for the check, because a global identity set
 * on the host would mask the env-var override path on dev machines.
 */
async function ensureAuthorIdentity(repoRoot: string): Promise<void> {
  const name = process.env.GIT_AUTHOR_NAME?.trim() || 'docus'
  const email = process.env.GIT_AUTHOR_EMAIL?.trim() || 'docus@localhost'

  const haveName = (await run(repoRoot, ['config', '--local', '--get', 'user.name'])).status === 0
  if (!haveName) {
    const r = await run(repoRoot, ['config', '--local', 'user.name', name])
    if (r.status !== 0) {
      throw new Error(`git config user.name failed: ${r.stderr.trim()}`)
    }
  }
  const haveEmail = (await run(repoRoot, ['config', '--local', '--get', 'user.email'])).status === 0
  if (!haveEmail) {
    const r = await run(repoRoot, ['config', '--local', 'user.email', email])
    if (r.status !== 0) {
      throw new Error(`git config user.email failed: ${r.stderr.trim()}`)
    }
  }
}

export type CommitResult = {
  sha: string
  filesCommitted: string[]
  indexRefreshFailed?: boolean
}

export type ExpectedContentHashes = Record<string, string | null>

const repoMutationTails = new Map<string, Promise<void>>()

async function withRepoMutation<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(repoRoot)
  const previous = repoMutationTails.get(key) ?? Promise.resolve()
  const result = previous.catch(() => {}).then(operation)
  const tail = result.then(() => {}, () => {})
  repoMutationTails.set(key, tail)
  try {
    return await result
  } finally {
    if (repoMutationTails.get(key) === tail) repoMutationTails.delete(key)
  }
}

const REPOSITORY_OPERATION_MARKERS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'REBASE_HEAD',
  'rebase-merge',
  'rebase-apply',
  'sequencer',
]

async function repositoryOperationInProgress(repoRoot: string): Promise<boolean> {
  const gitDirResult = await run(repoRoot, ['rev-parse', '--absolute-git-dir'])
  if (gitDirResult.status !== 0) {
    throw new Error(`git rev-parse git-dir failed: ${gitDirResult.stderr.trim()}`)
  }
  const gitDir = gitDirResult.stdout.trim()
  for (const marker of REPOSITORY_OPERATION_MARKERS) {
    try {
      await fs.stat(path.join(gitDir, marker))
      return true
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return false
}

async function assertRepositoryIdle(repoRoot: string): Promise<void> {
  if (await repositoryOperationInProgress(repoRoot)) {
    throw new Error('repository operation in progress')
  }
}

async function syncIndexPaths(
  repoRoot: string,
  paths: readonly string[],
  fixedHead?: string,
  options: {
    syncIndexForTesting?: (commitSha: string) => Promise<RunResult>
    beforeIndexResetForTesting?: (commitSha: string, attempt: number) => Promise<void>
  } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await repositoryOperationInProgress(repoRoot)) return false
    const before = await run(repoRoot, ['rev-parse', '--verify', 'HEAD'])
    if (before.status !== 0) return false
    const target = fixedHead ?? before.stdout.trim()
    if (before.stdout.trim() !== target) return false
    await options.beforeIndexResetForTesting?.(target, attempt)
    const reset = options.syncIndexForTesting
      ? await options.syncIndexForTesting(target)
      : await run(repoRoot, ['reset', '-q', target, '--', ...paths])
    if (reset.status === 0 && !(await repositoryOperationInProgress(repoRoot))) {
      const after = await run(repoRoot, ['rev-parse', '--verify', 'HEAD'])
      const verify = await run(repoRoot, ['diff', '--cached', '--quiet', target, '--', ...paths])
      if (after.status === 0 && after.stdout.trim() === target && verify.status === 0) return true
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
  }
  return false
}

export async function repairIndex(repoRoot: string, paths: string[]): Promise<boolean> {
  return withRepoMutation(repoRoot, async () => {
    await assertRepositoryIdle(repoRoot)
    return syncIndexPaths(repoRoot, paths)
  })
}

async function captureExpectedFiles(
  repoRoot: string,
  paths: readonly string[],
  expected: ExpectedContentHashes,
): Promise<Map<string, Buffer | null>> {
  const captured = new Map<string, Buffer | null>()
  const changed: string[] = []
  for (const filePath of paths) {
    let bytes: Buffer | null
    try {
      bytes = await fs.readFile(safeWorktreeFile(repoRoot, filePath))
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
      bytes = null
    }
    const actual = bytes === null ? null : createHash('sha256').update(bytes).digest('hex')
    if (actual !== expected[filePath]) changed.push(filePath)
    captured.set(filePath, bytes)
  }
  if (changed.length > 0) throw new Error(`content changed before commit: ${changed.join(', ')}`)
  return captured
}

/**
 * `git add` each of `paths` and create one commit with `message`. All
 * paths are relative to `repoRoot` and use forward slashes (the same
 * shape `git status` reports). Throws if the resulting commit touches
 * zero files (nothing to commit). Manual Docus versions intentionally use
 * plumbing commands for deterministic snapshot/CAS semantics, so ordinary
 * `git commit` hooks and signing do not run here. When `expected` is supplied,
 * this function owns the complete
 * transaction: dirty validation, byte capture, temporary-index staging,
 * staged-blob verification, and commit all run under the per-repo mutex.
 */
export async function addAndCommit(
  repoRoot: string,
  paths: string[],
  message: string,
  options: {
    expected?: ExpectedContentHashes
    beforeStageForTesting?: () => Promise<void>
    beforeUpdateRefForTesting?: () => Promise<void>
    syncIndexForTesting?: (commitSha: string) => Promise<RunResult>
    beforeIndexResetForTesting?: (commitSha: string, attempt: number) => Promise<void>
  } = {},
): Promise<CommitResult> {
  if (paths.length === 0) {
    throw new Error('addAndCommit: at least one path is required')
  }
  if (message.trim().length === 0) {
    throw new Error('addAndCommit: message must not be empty')
  }
  return withRepoMutation(repoRoot, async () => {
  await assertRepositoryIdle(repoRoot)
  let captured: Map<string, Buffer | null> | null = null
  if (options.expected) {
    const dirtyPaths = new Set((await status(repoRoot)).map((entry) => entry.path))
    const stalePaths = paths.filter((filePath) => !dirtyPaths.has(filePath))
    if (stalePaths.length > 0) {
      throw new Error(`selection is stale; no longer changed: ${stalePaths.join(', ')}`)
    }
    captured = await captureExpectedFiles(repoRoot, paths, options.expected)
  }

  // A fresh vault in production (or a vault that was `git init`-ed by
  // hand without setting a user.name / user.email) makes `git commit`
  // fail with "Author identity unknown", which the route maps to 500.
  // Write a local identity before committing so the first commit just
  // works. Only writes keys that aren't already set — an existing
  // identity (e.g. a vault cloned from another machine, or a repo
  // where the user manually set their own name) is preserved.
  // Identity comes from GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL env vars
  // when set, falling back to "docus" / "docus@localhost" — the env
  // vars match git's own convention for per-command overrides and let
  // operators pick the identity per-host without touching the image.
  await ensureAuthorIdentity(repoRoot)
  await options.beforeStageForTesting?.()

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-history-index-'))
  const indexPath = path.join(tempDir, 'index')
  const indexEnv = { GIT_INDEX_FILE: indexPath }
  try {
    const headBefore = await run(repoRoot, ['rev-parse', '--verify', 'HEAD'])
    const initialize = headBefore.status === 0
      ? await run(repoRoot, ['read-tree', headBefore.stdout.trim()], { env: indexEnv })
      : await run(repoRoot, ['read-tree', '--empty'], { env: indexEnv })
    if (initialize.status !== 0) throw new Error(`git read-tree failed: ${initialize.stderr.trim()}`)

    if (captured) {
      for (const filePath of paths) {
        const bytes = captured.get(filePath) ?? null
        if (bytes === null) {
          const remove = await run(repoRoot, ['update-index', '--force-remove', '--', filePath], { env: indexEnv })
          if (remove.status !== 0) throw new Error(`git update-index failed: ${remove.stderr.trim()}`)
          const verify = await run(repoRoot, ['ls-files', '--stage', '--', filePath], { env: indexEnv })
          if (verify.status !== 0 || verify.stdout.trim().length > 0) {
            throw new Error(`staged content verification failed: ${filePath}`)
          }
          continue
        }
        const blob = await run(
          repoRoot,
          ['hash-object', '-w', `--path=${filePath}`, '--stdin'],
          { input: bytes },
        )
        if (blob.status !== 0) throw new Error(`git hash-object failed: ${blob.stderr.trim()}`)
        const oid = blob.stdout.trim()
        const stage = await run(
          repoRoot,
          ['update-index', '--add', '--cacheinfo', '100644', oid, filePath],
          { env: indexEnv },
        )
        if (stage.status !== 0) throw new Error(`git update-index failed: ${stage.stderr.trim()}`)
        const verify = await run(repoRoot, ['ls-files', '--stage', '--', filePath], { env: indexEnv })
        if (verify.status !== 0 || !verify.stdout.includes(oid)) {
          throw new Error(`staged content verification failed: ${filePath}`)
        }
      }
    } else {
      const add = await run(repoRoot, ['add', '--', ...paths], { env: indexEnv })
      if (add.status !== 0) throw new Error(`git add failed: ${add.stderr.trim()}`)
    }
  const tree = await run(repoRoot, ['write-tree'], { env: indexEnv })
  if (tree.status !== 0) throw new Error(`git write-tree failed: ${tree.stderr.trim()}`)
  const treeSha = tree.stdout.trim()
  if (headBefore.status === 0) {
    const previousTree = await run(repoRoot, ['rev-parse', `${headBefore.stdout.trim()}^{tree}`])
    if (previousTree.status !== 0) {
      throw new Error(`git rev-parse tree failed: ${previousTree.stderr.trim()}`)
    }
    if (previousTree.stdout.trim() === treeSha) throw new Error('nothing to commit')
  }

  // This is deliberately a plumbing commit. Running hooks or signing would
  // require a separate product policy that preserves the fixed-tree and CAS
  // guarantees below.
  const commitArgs = ['commit-tree', treeSha]
  if (headBefore.status === 0) commitArgs.push('-p', headBefore.stdout.trim())
  commitArgs.push('-m', message)
  const commit = await run(repoRoot, commitArgs)
  if (commit.status !== 0) {
    throw new Error(`git commit-tree failed: ${commit.stderr.trim() || commit.stdout.trim()}`)
  }
  const commitSha = commit.stdout.trim()

  await options.beforeUpdateRefForTesting?.()
  await assertRepositoryIdle(repoRoot)
  const expectedHead = headBefore.status === 0 ? headBefore.stdout.trim() : '0'.repeat(40)
  const updateHead = await run(repoRoot, ['update-ref', 'HEAD', commitSha, expectedHead])
  if (updateHead.status !== 0) throw new Error('repository changed before commit')

  // Query the immutable commit we created, never the mutable HEAD ref.
  const show = await run(repoRoot, ['show', '--name-only', '--pretty=', commitSha])
  const filesCommitted = show.status === 0
    ? show.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    : paths

  // HEAD is already committed. Index repair is auxiliary and must never turn
  // a successful version into an API failure. Retry transient index.lock
  // contention, bind reset to our immutable SHA, and report degradation.
  const indexRefreshFailed = !(await syncIndexPaths(repoRoot, paths, commitSha, options))
  return { sha: commitSha, filesCommitted, indexRefreshFailed }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
  })
}

export async function dropHeadCommit(
  repoRoot: string,
  sha: string,
): Promise<CommitResult> {
  return withRepoMutation(repoRoot, async () => {
  const head = await run(repoRoot, ['rev-parse', 'HEAD'])
  if (head.status !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${head.stderr.trim()}`)
  }
  if (head.stdout.trim() !== sha) {
    throw new Error('only the latest commit can be dropped')
  }
  const show = await run(repoRoot, ['show', '--name-only', '--pretty=', sha])
  const filesCommitted = show.status === 0
    ? show.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    : []
  const parent = await run(repoRoot, ['rev-parse', `${sha}^`])
  if (parent.status !== 0) {
    const deleteHead = await run(repoRoot, ['update-ref', '-d', 'HEAD'])
    if (deleteHead.status !== 0) {
      const all = `${deleteHead.stdout}\n${deleteHead.stderr}`.trim()
      throw new Error(all || `git update-ref failed (exit ${deleteHead.status})`)
    }
    if (filesCommitted.length > 0) {
      const untrack = await run(repoRoot, ['rm', '--cached', '--', ...filesCommitted])
      if (untrack.status !== 0) {
        const all = `${untrack.stdout}\n${untrack.stderr}`.trim()
        throw new Error(all || `git rm --cached failed (exit ${untrack.status})`)
      }
    }
    return { sha: '', filesCommitted }
  }
  const reset = await run(repoRoot, ['reset', '--mixed', parent.stdout.trim()])
  if (reset.status !== 0) {
    const all = `${reset.stdout}\n${reset.stderr}`.trim()
    throw new Error(all || `git reset failed (exit ${reset.status})`)
  }
  return { sha: parent.stdout.trim(), filesCommitted }
  })
}

// --- Restore --------------------------------------------------------------

/**
 * Restore a single file to its content at `ref`. `--worktree` is
 * intentional: checkout-style restoration also updates the index,
 * which would silently stage a destructive restore.
 *
 * The caller is expected to validate `path` and `ref`. We pass them
 * through to git verbatim, separated by `--` so a path that starts
 * with `-` is safe.
 *
 * Throws if git refuses (e.g. the ref is bad or the file does not
 * exist at that ref). The caller maps that to 4xx.
 */
export async function restoreFile(
  repoRoot: string,
  ref: string,
  path: string,
): Promise<void> {
  return withRepoMutation(repoRoot, async () => {
    const r = await run(repoRoot, ['restore', `--source=${ref}`, '--worktree', '--', path])
    if (r.status !== 0) {
    // Missing paths and invalid revisions both end up here. Surface the
    // raw stderr — the route maps it to a 4xx.
      throw new Error(r.stderr.trim() || `git restore failed (exit ${r.status})`)
    }
  })
}
