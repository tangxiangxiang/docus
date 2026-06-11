// Server mirror of src/lib/linkResolve.ts. Kept in sync by hand —
// the file is small, Node-free, and isomorphic. A cross-directory
// import (`../src/lib/linkResolve.js`) won't work under the production
// runner: Node 22's ESM resolver rejects the file path even though
// tsx's loader hook is registered, because the runtime check for
// non-`.js` extensions happens before the hook can swap in a `.ts`
// file. Vite's dev pipeline (server/vite-plugin.ts) hides the issue
// because it resolves through its own bundler. The server can't.
//
// Keep this copy identical to src/lib/linkResolve.ts. The public
// surface used here is `resolveWikiTarget`.

/** Returns the directory containing `p`, or '' for a top-level path. */
export function dirname(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx === -1 ? '' : p.slice(0, idx)
}

/** Returns the basename (last path segment) of `p`. */
export function basename(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx === -1 ? p : p.slice(idx + 1)
}

/** Resolve a wiki link target (as written) to an actual vault path.
 *  Returns null if no match. `allPaths` is a list of all known vault
 *  paths (no `.md` extension). */
export function resolveWikiTarget(
  ref: string,
  sourcePath: string,
  allPaths: string[],
): string | null {
  if (!ref) return null
  // Reject anything that smells like an escape attempt or non-vault syntax.
  if (ref.includes('..') || ref.includes('\\') || ref.startsWith('/')) return null

  // Strip a trailing .md (case-insensitive) before matching.
  const stripped = ref.replace(/\.md$/i, '')
  if (!stripped) return null

  const sourceDir = dirname(sourcePath)
  const refBasename = basename(stripped)
  // Each segment of the candidate paths must look like a kebab slug; the
  // ref's basename goes through this same gate so we don't try to resolve
  // a ref like `[[#anchor]]` (empty basename) or `[[foo/bar]]` whose
  // embedded `/` would make the basename a path rather than a name.
  if (!isKebabSegment(refBasename)) return null

  // 1. Same-dir: try `<sourceDir>/<ref>` first.
  const sameDir = sourceDir ? `${sourceDir}/${stripped}` : stripped
  if (allPaths.includes(sameDir)) return sameDir

  // 2. Root: only relevant when the source is in a sub-folder.
  if (sourceDir !== '' && allPaths.includes(stripped)) return stripped

  // 3. Recursive basename match (case-insensitive on basename only).
  //    Exact-dir candidates are preferred by checking `sameDir` first
  //    above; here we just take the first basename match.
  const refBaseLower = refBasename.toLowerCase()
  for (const p of allPaths) {
    if (basename(p).toLowerCase() === refBaseLower) return p
  }

  return null
}

// Lowercase kebab slug, same shape as the server's SEGMENT_RE. Inlined
// here to keep the resolver self-contained and isomorphic.
function isKebabSegment(s: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)
}
