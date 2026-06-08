// markdown-it plugin that recognizes inter-note links in two forms:
//
//   1. Wiki-style: [[target]], [[target|alias]], [[target#anchor]],
//      [[target#anchor|alias]]
//   2. Standard markdown: [text](path.md) where `path` resolves to a
//      vault note (we don't try to resolve here — that's the
//      resolver's job, called via `opts.resolve`)
//
// Both are emitted as `<a class="wiki-link" data-target="…" data-missing="…">`.
// Broken links (target doesn't resolve) get the `wiki-link-missing` class.
//
// The plugin is added to the `inline` ruler for `[[…]]` and to the
// `core` ruler (after `inline`) for the `link_open` upgrade. Putting
// the upgrade in `core` (rather than `inline`) avoids re-parsing the
// link: markdown-it's `link` rule has already produced the `link_open`
// token with the right `href`, we just append our attrs.
//
// Code-block handling: markdown-it's inline rules run only on the
// *non-code* portions of a document. Fenced / indented code blocks
// are leaf blocks that never reach the inline parser; inline `…​`
// spans are consumed by the `backticks` rule before our `wiki_link`
// rule fires. So we don't need an explicit "am I inside code?" check.

import MarkdownIt from 'markdown-it'

export type Resolver = (ref: string, anchor?: string) => {
  /** Resolved vault path (no .md, no #anchor) or null if the target
   *  doesn't exist. */
  target: string | null
  /** Optional display text (used as the link body for wiki links). */
  alias?: string
}

export interface WikiLinkOptions {
  /** Called for every `[[…]]` ref and every internal `[t](path.md)`
   *  link. Receives the ref as-written and the optional anchor.
   *  Returns the resolved target (or null for broken links) and an
   *  optional display alias. */
  resolve: Resolver
}

// Minimal structural types for the bits of markdown-it's state /
// token API we touch. Using `any` for the rest keeps the plugin
// decoupled from markdown-it's complex (and hard-to-import-cleanly)
// type namespace. The runtime contract is what matters; the
// structural fields below are enough for vue-tsc to verify usage
// at the call sites we care about.
type MdToken = {
  type: string
  attrs: [string, string][] | null
  content: string
  attrGet: (name: string) => string | null | undefined
  attrSet: (name: string, value: string) => void
}
type MdRenderer = { renderToken(tokens: MdToken[], idx: number, options: unknown): string }

interface WikiLinkInlineState {
  // The actual state is MarkdownIt's StateInline; we only need to
  // attach our own opts to it for the rule to read. We use a
  // structural type so callers can pass either the real StateInline
  // or a previous WikiLinkInlineState carrying the same opts.
  pos: number
  posMax: number
  src: string
  push: (type: string, tag: string, nesting: number) => MdToken
  env: Record<string, unknown>
  wikiLinkOpts: WikiLinkOptions
}

function wikiLinkRule(
  state: WikiLinkInlineState,
  silent: boolean,
): boolean {
  const start = state.pos
  const src = state.src
  // Quick prefix check.
  if (src.charCodeAt(start) !== 0x5B /* [ */) return false
  if (src.charCodeAt(start + 1) !== 0x5B) return false
  const end = src.indexOf(']]', start + 2)
  if (end === -1) return false
  // No newlines inside the wiki link. indexOf returns -1 if no
  // newline; -1 < end is true, which would falsely reject valid
  // matches. Guard with the `!== -1` check.
  const nlIdx = src.indexOf('\n', start + 2)
  if (nlIdx !== -1 && nlIdx < end) return false

  const inner = src.slice(start + 2, end)
  if (!inner) return false
  // Parse out ref / #anchor / |alias.
  let ref = inner
  let anchor: string | undefined
  let alias: string | undefined
  const hashIdx = inner.indexOf('#')
  if (hashIdx !== -1) {
    ref = inner.slice(0, hashIdx)
    const afterHash = inner.slice(hashIdx + 1)
    const pipeIdx = afterHash.indexOf('|')
    anchor = (pipeIdx === -1 ? afterHash : afterHash.slice(0, pipeIdx)).trim() || undefined
    if (pipeIdx !== -1) alias = afterHash.slice(pipeIdx + 1).trim() || undefined
  } else {
    const pipeIdx = inner.indexOf('|')
    if (pipeIdx !== -1) {
      ref = inner.slice(0, pipeIdx)
      alias = inner.slice(pipeIdx + 1).trim() || undefined
    }
  }
  ref = ref.trim()
  if (!ref) return false

  if (silent) return true  // validation only

  const opts = state.wikiLinkOpts
  const resolved = opts.resolve(ref, anchor)
  const display = alias ?? ref
  // data-target is the as-written ref for missing links; for
  // resolved links, it's the resolved path (so the click handler
  // can navigate to the right note).
  const target = resolved?.target ?? ref
  const missing = resolved?.target ? 'false' : 'true'
  const href = resolved?.target
    ? '/vault/' + encodeURI(resolved.target) + (anchor ? '#' + encodeURIComponent(anchor) : '')
    : '#'

  const open = state.push('link_open', 'a', 1)
  open.attrs = [
    ['class', 'wiki-link' + (missing === 'true' ? ' wiki-link-missing' : '')],
    ['href', href],
    ['data-target', target],
    ['data-missing', missing],
  ]
  if (anchor) open.attrs.push(['data-anchor', anchor])

  const text = state.push('text', '', 0)
  text.content = display

  state.push('link_close', 'a', -1)

  state.pos = end + 2
  return true
}

// Vault-internal markdown link: href starts with a kebab segment, no
// scheme, not absolute. Matches foo, foo.md, foo/bar, foo/bar.md,
// foo.md#a, foo#a.
const INTERNAL_HREF_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?:\.md)?(?:#[^\s)]*)?$/i

/** Classify a single `link_open` token in-place. Used by the renderer
 *  rule below — we can't iterate the token stream in a `core` rule
 *  because `link_open` tokens are nested inside `inline` tokens, not
 *  at the top level of `state.tokens`. The renderer fires for every
 *  `link_open` as it's emitted, which is exactly what we want. */
function classifyLinkOpenToken(
  tokens: MdToken[],
  idx: number,
  opts: WikiLinkOptions,
): void {
  const t = tokens[idx]
  if (t.type !== 'link_open') return
  if (t.attrGet('class')?.includes('wiki-link')) return  // already classified by inline rule
  const hrefAttr = t.attrGet('href')
  if (!hrefAttr) return
  if (!INTERNAL_HREF_RE.test(hrefAttr)) return
  // Split path and anchor.
  const hashIdx = hrefAttr.indexOf('#')
  const pathPart = hashIdx === -1 ? hrefAttr : hrefAttr.slice(0, hashIdx)
  const hash = hashIdx === -1 ? '' : hrefAttr.slice(hashIdx + 1)
  const cleanPath = pathPart.replace(/\.md$/i, '')
  if (!cleanPath) return
  const resolved = opts.resolve(cleanPath, hash || undefined)
  const missing = resolved?.target ? 'false' : 'true'
  const target = resolved?.target ?? cleanPath
  const newHref = resolved?.target
    ? '/vault/' + encodeURI(resolved.target) + (hash ? '#' + hash : '')
    : hrefAttr  // leave the original href so a click still goes somewhere
  const existing = t.attrGet('class') ?? ''
  t.attrSet('class', (existing + ' wiki-link' + (missing === 'true' ? ' wiki-link-missing' : '')).trim())
  t.attrSet('href', newHref)
  t.attrSet('data-target', target)
  t.attrSet('data-missing', missing)
  if (hash) t.attrSet('data-anchor', hash)
}

/** Plugin signature: `(md, opts) => void`. markdown-it's `md.use`
 *  calls plugins with `(md, options?)` — so this is `PluginWithOptions`
 *  in markdown-it's terms. Currying `(opts) => (md) => void` would NOT
 *  work because `md.use` would call our outer function with `(md, opts)`
 *  and never invoke the returned closure. */
export function wikiLinkPlugin(
  md: MarkdownIt,
  opts: WikiLinkOptions,
): void {
  md.inline.ruler.before('text', 'wiki_link', (state, silent) => {
    ;(state as unknown as WikiLinkInlineState).wikiLinkOpts = opts
    return wikiLinkRule(state as unknown as WikiLinkInlineState, silent)
  })
  // Renderer rule for `link_open`: classifies standard `[t](path.md)`
  // links into wiki-links. Runs once per `link_open` token as the
  // renderer walks the flattened stream.
  md.renderer.rules.link_open = function (
    tokens: MdToken[],
    idx: number,
    options: unknown,
    _env: unknown,
    self: MdRenderer,
  ): string {
    classifyLinkOpenToken(tokens, idx, opts)
    return self.renderToken(tokens, idx, options)
  }
}

// Exposed for tests: regexes used by the plugin.
export const __testing__ = {
  INTERNAL_HREF_RE,
}
