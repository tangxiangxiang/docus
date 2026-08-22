import type MarkdownIt from 'markdown-it'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'

const CONTAINER_DEFINITIONS = {
  info: { title: 'Info', tag: 'div' },
  tip: { title: 'Tip', tag: 'div' },
  warning: { title: 'Warning', tag: 'div' },
  danger: { title: 'Danger', tag: 'div' },
  details: { title: 'Details', tag: 'details' },
} as const

export type MarkdownContainerType = keyof typeof CONTAINER_DEFINITIONS

interface ContainerOpening {
  markerLength: number
  type: MarkdownContainerType
  title: string
  open: boolean
}

interface ContainerClosing {
  markerLength: number
}

interface FencedCodeOpening {
  marker: number
  markerLength: number
}

function isSupportedType(value: string): value is MarkdownContainerType {
  return Object.prototype.hasOwnProperty.call(CONTAINER_DEFINITIONS, value)
}

function getLineStart(state: StateBlock, line: number): number {
  return state.bMarks[line] + state.tShift[line]
}

function getLineEnd(state: StateBlock, line: number): number {
  return state.eMarks[line]
}

function parseOpening(state: StateBlock, line: number): ContainerOpening | null {
  if (state.sCount[line] - state.blkIndent >= 4) return null

  const lineStart = getLineStart(state, line)
  const lineEnd = getLineEnd(state, line)
  if (lineStart >= lineEnd || state.src.charCodeAt(lineStart) !== 0x3a /* : */) return null

  let cursor = lineStart
  while (cursor < lineEnd && state.src.charCodeAt(cursor) === 0x3a) cursor += 1
  const markerLength = cursor - lineStart
  if (markerLength < 3) return null

  const rawRest = state.src.slice(cursor, lineEnd)
  // The type must be separated from the delimiter. Without this check a
  // future type-like token such as `:::info` would silently become a
  // container instead of remaining ordinary Markdown.
  if (!/^[ \t]/.test(rawRest)) return null
  const rest = rawRest.trimStart()
  const match = /^([a-z]+)(?:[ \t]+(.*?))?[ \t]*$/.exec(rest)
  if (!match || !isSupportedType(match[1])) return null

  const type = match[1]
  let title = match[2]?.trim() ?? ''
  let open = false

  // `{open}` is a feature-specific literal, not an attributes grammar. It is
  // accepted only for details and only as the final metadata token.
  if (type === 'details' && /(?:^|[ \t])\{open\}$/.test(title)) {
    title = title.slice(0, -'{open}'.length).trimEnd()
    open = true
  }

  return {
    markerLength,
    type,
    title: title || CONTAINER_DEFINITIONS[type].title,
    open,
  }
}

function parseClosing(state: StateBlock, line: number): ContainerClosing | null {
  if (state.sCount[line] - state.blkIndent >= 4) return null

  const lineStart = getLineStart(state, line)
  const lineEnd = getLineEnd(state, line)
  if (lineStart >= lineEnd || state.src.charCodeAt(lineStart) !== 0x3a /* : */) return null

  let cursor = lineStart
  while (cursor < lineEnd && state.src.charCodeAt(cursor) === 0x3a) cursor += 1
  const markerLength = cursor - lineStart
  if (markerLength < 3) return null

  // A closer is only a colon run followed by horizontal whitespace. This
  // keeps ordinary prose such as `::: text` out of the closing grammar.
  if (state.src.slice(cursor, lineEnd).trim() !== '') return null
  return { markerLength }
}

function parseFencedCodeOpening(state: StateBlock, line: number): FencedCodeOpening | null {
  if (state.sCount[line] - state.blkIndent >= 4) return null

  const lineStart = getLineStart(state, line)
  const lineEnd = getLineEnd(state, line)
  const marker = state.src.charCodeAt(lineStart)
  if (marker !== 0x60 /* ` */ && marker !== 0x7e /* ~ */) return null

  let cursor = lineStart
  while (cursor < lineEnd && state.src.charCodeAt(cursor) === marker) cursor += 1
  const markerLength = cursor - lineStart
  if (markerLength < 3) return null
  if (marker === 0x60 && state.src.slice(cursor, lineEnd).includes('`')) return null
  return { marker, markerLength }
}

function findFencedCodeEnd(
  state: StateBlock,
  openingLine: number,
  endLine: number,
  opening: FencedCodeOpening,
): number {
  for (let line = openingLine + 1; line < endLine; line += 1) {
    if (state.sCount[line] - state.blkIndent >= 4) continue
    const lineStart = getLineStart(state, line)
    const lineEnd = getLineEnd(state, line)
    if (state.src.charCodeAt(lineStart) !== opening.marker) continue

    let cursor = lineStart
    while (cursor < lineEnd && state.src.charCodeAt(cursor) === opening.marker) cursor += 1
    if (cursor - lineStart < opening.markerLength) continue
    if (state.src.slice(cursor, lineEnd).trim() !== '') continue
    return line
  }
  return endLine
}

/**
 * Find a close owned by the current opener. A shorter supported opener starts
 * a nested container and is skipped together with its own matching close. A
 * close is eligible only when its marker is at least as long as the opener's
 * marker, matching MarkdownIt fence ownership semantics.
 */
function findClosingLine(
  state: StateBlock,
  bodyStart: number,
  endLine: number,
  openerLength: number,
): number {
  for (let line = bodyStart; line < endLine; line += 1) {
    // The scan is only looking for container delimiters. Fenced code is
    // parsed by MarkdownIt's earlier fence rule and may contain arbitrary
    // `:::` text, so skip its complete source range before considering any
    // opener or closer inside it.
    const fencedOpening = parseFencedCodeOpening(state, line)
    if (fencedOpening) {
      line = findFencedCodeEnd(state, line, endLine, fencedOpening)
      continue
    }

    const nested = parseOpening(state, line)
    if (nested && nested.markerLength < openerLength) {
      const nestedClose = findClosingLine(state, line + 1, endLine, nested.markerLength)
      if (nestedClose !== -1) {
        line = nestedClose
        continue
      }
      // An unclosed nested opener is treated as ordinary body text. This lets
      // a later outer close terminate the valid outer container without
      // swallowing the remainder of the document.
    }

    const closing = parseClosing(state, line)
    if (closing && closing.markerLength >= openerLength) return line
  }
  return -1
}

function pushInlineTitle(state: StateBlock, title: string, startLine: number): void {
  const inline = state.push('inline', '', 0)
  inline.content = title
  inline.map = [startLine, startLine + 1]
  inline.children = []
}

function docusContainerRule(
  state: StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const opening = parseOpening(state, startLine)
  if (!opening) return false

  const closeLine = findClosingLine(state, startLine + 1, endLine, opening.markerLength)
  if (closeLine === -1) return false
  if (silent) return true

  const definition = CONTAINER_DEFINITIONS[opening.type]
  const openToken = state.push('docus_container_open', definition.tag, 1)
  openToken.attrSet('class', `markdown-container markdown-container-${opening.type}`)
  if (opening.type === 'details' && opening.open) openToken.attrSet('open', 'open')
  openToken.map = [startLine, closeLine + 1]
  openToken.meta = {
    type: opening.type,
    markerLength: opening.markerLength,
    open: opening.open,
  }

  const titleTag = opening.type === 'details' ? 'summary' : 'div'
  const titleOpen = state.push('docus_container_title_open', titleTag, 1)
  titleOpen.attrSet('class', 'markdown-container-title')
  titleOpen.map = [startLine, startLine + 1]
  pushInlineTitle(state, opening.title, startLine)
  const titleClose = state.push('docus_container_title_close', titleTag, -1)
  titleClose.map = [startLine, startLine + 1]

  // Reuse MarkdownIt's current block state and rules for the body. This is
  // what keeps headings, callouts, math, WikiLinks, Shiki fences, Mermaid,
  // and MarkMap in the same document token stream.
  state.md.block.tokenize(state, startLine + 1, closeLine)

  const closeToken = state.push('docus_container_close', definition.tag, -1)
  closeToken.map = [closeLine, closeLine + 1]
  closeToken.meta = {
    type: opening.type,
    markerLength: opening.markerLength,
  }
  state.line = closeLine + 1
  return true
}

export function markdownContainersPlugin(md: MarkdownIt): void {
  // `paragraph` is a named, stable insertion point in MarkdownIt's block
  // ruler. The rule's alt list lets a valid container interrupt a paragraph
  // without depending on incidental numeric ruler indexes.
  md.block.ruler.before(
    'paragraph',
    'docus-container',
    docusContainerRule,
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  )

  md.renderer.rules.docus_container_open = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options)
  md.renderer.rules.docus_container_close = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options)
  md.renderer.rules.docus_container_title_open = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options)
  md.renderer.rules.docus_container_title_close = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options)
}

export const __testing__ = {
  CONTAINER_DEFINITIONS,
  parseOpening,
  parseClosing,
  findClosingLine,
}
