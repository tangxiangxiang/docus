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

// Every path segment is a lowercase kebab. The full path is one or more such
// segments joined by `/` — there is no implicit `posts/` prefix anymore, since
// `src/content/` itself is the implicit root (with `posts/`, `archive/`, etc.
// as ordinary sub-folders).
const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PATH_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

export function isValidPathSyntax(p: string): boolean {
  return PATH_RE.test(p)
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
