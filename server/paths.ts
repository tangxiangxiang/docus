import path from 'node:path'

// `let` (not `const`) so tests can swap the content dir via
// `setContentDir`. All call sites (assertSafePath, filePathFor,
// folderPathFor) read `CONTENT_DIR` inside their function body, so
// they pick up the current value on each call.
export let CONTENT_DIR = path.resolve(process.cwd(), 'src/content')

/**
 * Override the workspace root. Intended for tests that exercise
 * filesystem helpers against a temp dir. Pass the original
 * `path.resolve(process.cwd(), 'src/content')` value to restore.
 */
export function setContentDir(dir: string): void {
  CONTENT_DIR = dir
}

// Every path segment is a non-empty run of `[\w一-鿿-]` that does
// NOT start or end with `-`, does NOT equal `.` or `..`, and does NOT end
// in `.md`. The full path is one or more such segments joined by `/` — there
// is no implicit `posts/` prefix anymore, since `src/content/` itself is the
// implicit root (with `posts/`, `archive/`, etc. as ordinary sub-folders).
//
// Why this looser shape instead of the original `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`:
// the imported reference docs (see `参考/Documents/docs/...`) carry Chinese
// category names (`007-思维/`, `001-第一性原理`) and mixed-case technical
// names (`006-MacOS/`, `001-macOS-快捷键`). The filesystem layer accepts
// them — the previous ASCII-kebab regex was a tighter gate than the OS
// actually enforces, and the mismatch surfaced as a 400 from /api/posts/*
// the moment those files were migrated into literature/.
//
// Security posture is unchanged by the loosening: traversal is still
// blocked by (a) the explicit `..` rejection in `isValidSegment`, and
// (b) the `resolved.startsWith(CONTENT_DIR + path.sep)` second line
// in `assertSafePath`. The character class itself only governs *what
// characters are allowed inside a segment*, not whether the segment
// can escape the content root.
const SEGMENT_RE = /^[\w一-鿿-]+$/
const PATH_RE = /^(?:\/|(?:[\w一-鿿-]+(?:\/[\w一-鿿-]+)*))?$/

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

// Strict kebab slug for AI-generated ids. zettel/draft slugs come
// from the LLM and the prompt forbids CJK / uppercase /
// underscores, so the wider `SEGMENT_RE` above would let bad
// output slip through (and then fail further down the pipeline
// with a less specific error). This regex matches the docus
// `slug:` field contract: `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`.
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
