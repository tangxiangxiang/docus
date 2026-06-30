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

/**
 * Run a git subcommand. Resolves with the captured output; rejects
 * only on spawn failure (no shell escaping concerns, args are passed
 * verbatim).
 */
export function run(repoRoot: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: repoRoot, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    child.on('error', (err) => reject(new GitUnavailableError(err)))
    child.on('close', (code) => {
      resolve({ status: code ?? -1, stdout, stderr })
    })
  })
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
  // `--untracked-files=all` makes git report files inside otherwise-
  // ignored subtrees; we don't need that, but the default of `normal`
  // skips untracked dirs that contain no tracked files yet. Since we
  // may `git add` an entire dir, this matters less for us, but explicit
  // doesn't hurt.
  const r = await run(repoRoot, ['status', '--porcelain', '--untracked-files=normal'])
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
      return await fs.readFile(path.join(repoRoot, filePath), 'utf8')
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null
      throw e
    }
  }
  const r = await run(repoRoot, ['show', `${ref}:${filePath}`])
  if (r.status === 0) return r.stdout
  // Three error patterns mean "no such (ref, path) tuple". We treat
  // all of them as null rather than throwing because the caller —
  // the diff route — wants to render "this file did not exist in
  // the old version" gracefully.
  if (
    /does not exist/i.test(r.stderr) ||
    /bad revision/i.test(r.stderr) ||
    /exists on disk, but not in/i.test(r.stderr) ||
    /not in /i.test(r.stderr)
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
}

/**
 * `git add` each of `paths` and create one commit with `message`. All
 * paths are relative to `repoRoot` and use forward slashes (the same
 * shape `git status` reports). Throws if the resulting commit touches
 * zero files (nothing to commit) or if git itself rejects the message
 * (e.g. hooks). The caller is responsible for validating that at
 * least one path is dirty — passing a clean path still works (git
 * re-stages whatever is there) but produces an empty commit.
 */
export async function addAndCommit(
  repoRoot: string,
  paths: string[],
  message: string,
): Promise<CommitResult> {
  if (paths.length === 0) {
    throw new Error('addAndCommit: at least one path is required')
  }
  if (message.trim().length === 0) {
    throw new Error('addAndCommit: message must not be empty')
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
  // Stage. Use -- to disambiguate paths from refs, even though our
  // paths are obviously paths.
  const add = await run(repoRoot, ['add', '--', ...paths])
  if (add.status !== 0) {
    throw new Error(`git add failed: ${add.stderr.trim()}`)
  }
  // Commit. -m once with the full message — easier than juggling -m FOO -m BAR
  // and gives git a single body to inspect.
  const commit = await run(repoRoot, ['commit', '-m', message])
  if (commit.status !== 0) {
    // "nothing to commit" is a normal caller's error, not a git failure.
    // The wording varies across git versions ("nothing to commit, working
    // tree clean" / "no changes added to commit" / "Your branch is up to
    // date" with a hint to add). Match a substring that all of them
    // share: "nothing" or "no changes" within a "to commit" context.
    const all = `${commit.stdout}\n${commit.stderr}`
    if (/nothing.*to commit/i.test(all) || /no changes added to commit/i.test(all)) {
      throw new Error('nothing to commit')
    }
    throw new Error(`git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`)
  }
  // Read the just-created sha via `git rev-parse HEAD` rather than
  // scraping commit's stdout (different git versions format the
  // "1 file changed" summary differently).
  const head = await run(repoRoot, ['rev-parse', 'HEAD'])
  if (head.status !== 0) {
    throw new Error(`git rev-parse HEAD failed: ${head.stderr.trim()}`)
  }
  // And the files that the commit actually touched.
  const show = await run(repoRoot, ['show', '--name-only', '--pretty=', 'HEAD'])
  const filesCommitted = show.status === 0
    ? show.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    : paths
  return { sha: head.stdout.trim(), filesCommitted }
}

// --- Restore --------------------------------------------------------------

/**
 * Restore a single file to its content at `ref`. Implemented via
 * `git checkout <ref> -- <path>` — this overwrites the working-tree
 * copy with the blob at `<ref>` and leaves the index / HEAD alone.
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
  const r = await run(repoRoot, ['checkout', ref, '--', path])
  if (r.status !== 0) {
    // "error: pathspec ... did not match any file(s) known to git"
    // and "fatal: invalid reference" both end up here. Surface the
    // raw stderr — the route maps it to a 4xx.
    throw new Error(r.stderr.trim() || `git checkout failed (exit ${r.status})`)
  }
}
