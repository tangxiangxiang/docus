import path from 'node:path'

export const CONTENT_DIR = path.resolve(process.cwd(), 'src/content')
export const POSTS_DIR = path.join(CONTENT_DIR, 'posts')

const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const PATH_RE = /^posts\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

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
