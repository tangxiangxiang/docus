import MarkdownIt from 'markdown-it'

const HEADING_STATE_KEY = '__docusMarkdownHeadingState'
const CUSTOM_ANCHOR_ID_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/

type TokenNesting = 1 | 0 | -1

interface MdToken {
  type: string
  tag: string
  children: MdToken[] | null
  content: string
  meta: unknown
  block: boolean
  map: [number, number] | null
  attrGet: (name: string) => string | null
}

export interface TocEntry {
  level: 2 | 3 | 4
  id: string
  text: string
}

interface HeadingRenderState {
  explicitIds: Array<string | null>
  nextSlugIndex: number
}

interface CoreStateLike {
  tokens: MdToken[]
  env: Record<string, unknown>
}

interface BlockStateLike {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  line: number
  push: (type: string, tag: string, nesting: TokenNesting) => MdToken
}

interface AnchorStateLike {
  env?: unknown
}

function getHeadingState(env: unknown): HeadingRenderState | null {
  if (typeof env !== 'object' || env === null) return null
  const record = env as Record<string, unknown>
  const existing = record[HEADING_STATE_KEY]
  if (existing && typeof existing === 'object') {
    return existing as HeadingRenderState
  }
  const state: HeadingRenderState = { explicitIds: [], nextSlugIndex: 0 }
  record[HEADING_STATE_KEY] = state
  return state
}

/** The automatic slug algorithm used by Docus before custom IDs were added. */
export function slugifyDocusHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

interface CustomAnchorSourceMatch {
  id: string
  escapedBackslashes: number
}

function trailingBackslashCount(value: string): number {
  let count = 0
  for (let index = value.length - 1; index >= 0 && value[index] === '\\'; index -= 1) {
    count += 1
  }
  return count
}

/**
 * Author-source authorization for the narrow final `{#id}` grammar. The
 * inline token content is the normalized/rendered form, so it is not enough
 * to inspect that content: `\{#id}` and `&#123;#id}` can both become visible
 * text that resembles metadata. The raw inline source is authoritative.
 */
function parseCustomAnchorSource(source: string): CustomAnchorSourceMatch | null {
  if (!source.endsWith('}')) return null
  const markerStart = source.lastIndexOf('{#')
  if (markerStart === -1) return null

  const id = source.slice(markerStart + 2, -1)
  if (!CUSTOM_ANCHOR_ID_RE.test(id)) return null

  const beforeMarker = source.slice(0, markerStart)
  const escapedBackslashes = trailingBackslashCount(beforeMarker)
  // A backslash pair produces a literal backslash and leaves the `{` opener
  // active; an odd run escapes the opener and therefore remains literal.
  if (escapedBackslashes % 2 === 1) return null

  const delimiterEnd = beforeMarker.length - escapedBackslashes
  if (delimiterEnd === 0 || !/\s/.test(beforeMarker[delimiterEnd - 1] ?? '')) return null

  return { id, escapedBackslashes }
}

/**
 * Removes only the authorized final `{#id}` suffix from inline children.
 * Keeping this at token level preserves strong/emphasis/code/emoji/link
 * children that precede the suffix. A literal backslash produced by an even
 * source escape run remains visible; only the metadata marker is removed.
 */
function consumeCustomAnchor(
  children: MdToken[] | null,
  id: string,
): string | null {
  if (!children || children.length === 0) return null
  const last = children.at(-1)
  if (!last || last.type !== 'text') return null

  const marker = `{#${id}}`
  if (!last.content.endsWith(marker)) return null

  const markerStart = last.content.length - marker.length
  const beforeMarker = last.content.slice(0, markerStart)
  const hasLiteralBackslash = trailingBackslashCount(beforeMarker) > 0
  const visibleEnd = hasLiteralBackslash ? markerStart : beforeMarker.trimEnd().length
  last.content = last.content.slice(0, visibleEnd)
  if (!last.content) children.pop()
  return id
}

function collectHeadingMetadata(state: CoreStateLike): void {
  const headingState = getHeadingState(state.env)
  if (!headingState) return

  for (let index = 0; index < state.tokens.length; index += 1) {
    const opening = state.tokens[index]
    if (opening.type !== 'heading_open') continue
    const inline = state.tokens[index + 1]
    const sourceMatch = inline?.type === 'inline'
      ? parseCustomAnchorSource(inline.content)
      : null
    const explicitId = sourceMatch
      ? consumeCustomAnchor(inline.children, sourceMatch.id)
      : null
    headingState.explicitIds.push(explicitId)
  }
}

/**
 * markdown-it-anchor invokes this for each heading without an id. The queue
 * was populated by the preceding core rule in the same render, so explicit
 * and automatic headings enter markdown-it-anchor's one allocator together.
 */
export function slugifyHeadingWithState(text: string, state: AnchorStateLike): string {
  const headingState = getHeadingState(state.env)
  if (!headingState) return slugifyDocusHeading(text)

  const explicitId = headingState.explicitIds[headingState.nextSlugIndex]
  headingState.nextSlugIndex += 1
  return explicitId ?? slugifyDocusHeading(text)
}

function tocBlockRule(
  state: BlockStateLike,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (startLine >= endLine) return false

  const start = state.bMarks[startLine] + state.tShift[startLine]
  const end = state.eMarks[startLine]
  if (state.src.slice(start, end).trim() !== '[[toc]]') return false
  if (silent) return true

  const token = state.push('docus_toc', 'nav', 0)
  token.block = true
  token.map = [startLine, startLine + 1]
  state.line = startLine + 1
  return true
}

function headingText(token: MdToken): string {
  if (!token.children) return ''
  return token.children
    .map((child) => {
      switch (child.type) {
        case 'text':
        case 'code_inline':
        case 'emoji':
        case 'softbreak':
        case 'hardbreak':
        case 'image':
          return child.content
        default:
          // Opening/closing tags and raw HTML are deliberately omitted. Any
          // readable text between HTML tags is represented by text tokens and
          // is therefore still available without executing source HTML.
          return ''
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectTocEntries(tokens: MdToken[]): TocEntry[] {
  const entries: TocEntry[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const opening = tokens[index]
    if (opening.type !== 'heading_open') continue
    const level = Number(opening.tag.slice(1))
    if (level < 2 || level > 4) continue
    const id = opening.attrGet('id')
    const inline = tokens[index + 1]
    if (!id || inline?.type !== 'inline') continue
    entries.push({ level: level as 2 | 3 | 4, id, text: headingText(inline) })
  }
  return entries
}

function finalizeToc(state: CoreStateLike): void {
  const entries = collectTocEntries(state.tokens)
  for (const token of state.tokens) {
    if (token.type === 'docus_toc') token.meta = { entries }
  }
}

interface TocNode {
  entry: TocEntry
  children: TocNode[]
}

function buildTocTree(entries: TocEntry[]): TocNode[] {
  const roots: TocNode[] = []
  const stack: TocNode[] = []

  for (const entry of entries) {
    while (stack.length > 0 && stack.at(-1)!.entry.level >= entry.level) stack.pop()
    const node: TocNode = { entry, children: [] }
    const parent = stack.at(-1)
    if (parent) parent.children.push(node)
    else roots.push(node)
    stack.push(node)
  }

  return roots
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTocNodes(nodes: TocNode[]): string {
  return `<ul>${nodes.map((node) => {
    const { entry } = node
    const children = node.children.length > 0 ? renderTocNodes(node.children) : ''
    return `<li class="docus-toc-level-${entry.level}"><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.text)}</a>${children}</li>`
  }).join('')}</ul>`
}

function renderTocToken(tokens: MdToken[], index: number): string {
  const entries = (tokens[index].meta as { entries?: TocEntry[] } | undefined)?.entries ?? []
  return `<nav class="docus-toc" role="navigation" aria-label="Table of contents">${renderTocNodes(buildTocTree(entries))}</nav>\n`
}

/** Register the narrow MD-EXT-1 heading and TOC rules around markdown-it-anchor. */
export function markdownHeadingsPlugin(md: MarkdownIt): void {
  md.block.ruler.before('paragraph', 'docus_toc', tocBlockRule)
  md.core.ruler.before('anchor', 'docus_heading_metadata', collectHeadingMetadata)
  md.core.ruler.after('anchor', 'docus_toc_finalize', finalizeToc)
  md.renderer.rules.docus_toc = renderTocToken
}

export const __testing__ = {
  consumeCustomAnchor,
  parseCustomAnchorSource,
  buildTocTree,
  collectTocEntries,
  headingText,
}
