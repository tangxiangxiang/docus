import path from 'node:path'

// Where the user's vault lives. In dev this defaults to
// `<project>/src/content`; in production it can be overridden via
// the VAULT_DIR env var so docus can point at any directory the
// user happens to keep their notes in. This is also the directory
// the history feature treats as a git repo root — see
// server/history/routes.ts.
//
// Resolution order at module load:
//   1. process.env.VAULT_DIR, if set (absolute or relative-to-cwd)
//   2. <cwd>/src/content (dev convention)
//
// `let` (not `const`) so tests can swap the content dir via
// `setContentDir`. All call sites (assertSafePath, filePathFor,
// folderPathFor) read `CONTENT_DIR` inside their function body, so
// they pick up the current value on each call.
function resolveInitialContentDir(): string {
  const fromEnv = process.env.VAULT_DIR?.trim()
  if (fromEnv && fromEnv.length > 0) {
    return path.isAbsolute(fromEnv)
      ? path.normalize(fromEnv)
      : path.resolve(process.cwd(), fromEnv)
  }
  return path.resolve(process.cwd(), 'src/content')
}

export let CONTENT_DIR = resolveInitialContentDir()

/**
 * Override the workspace root. Intended for tests that exercise
 * filesystem helpers against a temp dir, and for runtime config
 * reload if we ever add one. Pass the result of
 * `resolveInitialContentDir()` (i.e. the value picked from env /
 * cwd at module load) to restore.
 */
export function setContentDir(dir: string): void {
  CONTENT_DIR = dir
}

// Content paths are intentionally strict ASCII kebab slugs. Markdown
// titles/frontmatter may be Chinese, but folder/file path segments stay
// boring and portable for git history, URLs, shell tools, and sync clients.
const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PATH_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/

export function isValidSegment(s: string): boolean {
  if (!SEGMENT_RE.test(s)) return false
  if (s === '.' || s === '..') return false
  if (s.startsWith('-') || s.endsWith('-')) return false
  if (s.endsWith('.md')) return false
  return true
}

export function isValidPathSyntax(p: string): boolean {
  if (!p || p.startsWith('/') || p.endsWith('/')) return false
  if (!PATH_RE.test(p)) return false
  return p.split('/').every(isValidSegment)
}

export function assertSafePath(p: string): string {
  if (!isValidPathSyntax(p)) {
    throw new Error(`invalid path: ${p}`)
  }
  // Defensive: even with a passing regex, make sure resolve can't escape CONTENT_DIR.
  // (e.g. symlink games — out of scope for v1 but cheap to add.)
  const resolved = path.resolve(CONTENT_DIR, p)
  if (!resolved.startsWith(CONTENT_DIR + path.sep) && resolved !== CONTENT_DIR) {
    throw new Error(`path escapes content dir: ${p}`)
  }
  return resolved
}

export function filePathFor(p: string): string {
  return path.join(assertSafePath(p)) + '.md'
}

export function folderPathFor(p: string): string {
  return path.join(assertSafePath(p))
}

export { SEGMENT_RE }

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
