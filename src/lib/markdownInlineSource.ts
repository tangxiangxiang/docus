/**
 * Source ranges for MarkdownIt's actual `code_inline` tokens.
 *
 * MarkdownIt exposes each token's content and backtick markup, but not its raw
 * source offsets. This helper mirrors only the installed backticks rule's
 * delimiter search and content normalization. The complete child sequence is
 * also part of the mapping: exact-source non-code children, especially
 * `html_inline`, advance the raw cursor before a later `code_inline` can be
 * matched. Raw source alone can never manufacture a code span.
 */
export interface MarkdownCodeInlineSourceRange {
  start: number
  end: number
  markerLength: number
}

export interface MarkdownInlineSourceChild {
  type: string
  content?: string
  markup?: string
  attrs?: ReadonlyArray<readonly [string, string]> | null
  nesting?: number
}

/**
 * The link helpers from the MarkdownIt instance that produced the children.
 * Passing these in keeps link-tail ownership aligned with the installed parser
 * without creating another MarkdownIt instance or duplicating its destination
 * and title grammar.
 */
export interface MarkdownInlineSourceParser {
  parseLinkDestination: (
    source: string,
    start: number,
    max: number,
  ) => { ok: boolean; pos: number; str: string }
  parseLinkTitle: (
    source: string,
    start: number,
    max: number,
  ) => { ok: boolean; pos: number; str: string }
  normalizeLink?: (url: string) => string
}

function runEnd(source: string, start: number): number {
  let end = start + 1
  while (end < source.length && source[end] === '`') end += 1
  return end
}

function findMatchingCloser(source: string, openerEnd: number, markerLength: number): number | null {
  let cursor = openerEnd
  while (true) {
    const candidate = source.indexOf('`', cursor)
    if (candidate === -1) return null
    const end = runEnd(source, candidate)
    if (end - candidate === markerLength) return end
    cursor = end
  }
}

interface MarkdownInlineSourceRange {
  start: number
  end: number
}

interface MarkdownLinkSourceRange extends MarkdownInlineSourceRange {
  labelStart: number
  labelEnd: number
  tailStart: number
  kind: 'inline' | 'reference' | 'shortcut'
}

interface MarkdownLinkTail {
  tailStart: number
  end: number
  kind: MarkdownLinkSourceRange['kind']
  destination?: string
  title?: string
}

interface MarkdownLinkOwnership {
  kind: 'markdown' | 'opaque' | 'transparent' | 'unresolved'
  surface?: MarkdownLinkSourceRange
}

function isLinkSpace(code: number): boolean {
  return code === 0x09 || code === 0x20 || code === 0x0A
}

function isBackslashEscaped(source: string, position: number): boolean {
  let slashCount = 0
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function findReferenceLabelEnd(source: string, start: number): number | null {
  if (source[start] !== '[') return null

  let depth = 1
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
      continue
    }
    if (source[cursor] === '[') {
      depth += 1
      continue
    }
    if (source[cursor] === ']') {
      depth -= 1
      if (depth === 0) return cursor
    }
  }
  return null
}

function parseLinkTail(
  source: string,
  labelEnd: number,
  parser: MarkdownInlineSourceParser,
): MarkdownLinkTail | null {
  const max = source.length
  let cursor = labelEnd + 1

  if (source[cursor] === '(') {
    const tailStart = cursor
    cursor += 1
    while (cursor < max && isLinkSpace(source.charCodeAt(cursor))) cursor += 1
    if (cursor >= max) return null

    const destination = parser.parseLinkDestination(source, cursor, max)
    if (!destination.ok) return null
    cursor = destination.pos

    const separatorStart = cursor
    while (cursor < max && isLinkSpace(source.charCodeAt(cursor))) cursor += 1
    let titleValue = ''
    const title = parser.parseLinkTitle(source, cursor, max)
    if (cursor < max && separatorStart !== cursor && title.ok) {
      titleValue = title.str
      cursor = title.pos
      while (cursor < max && isLinkSpace(source.charCodeAt(cursor))) cursor += 1
    }

    if (source[cursor] !== ')') return null
    return {
      tailStart,
      end: cursor + 1,
      kind: 'inline',
      destination: destination.str,
      title: titleValue,
    }
  }

  if (source[cursor] === '[') {
    const referenceEnd = findReferenceLabelEnd(source, cursor)
    if (referenceEnd === null) return null
    return { tailStart: cursor, end: referenceEnd + 1, kind: 'reference' }
  }

  // A shortcut reference link consumes only its label. The actual link_open
  // child proves that this is a reference link; raw source alone never does.
  return { tailStart: labelEnd + 1, end: labelEnd + 1, kind: 'shortcut' }
}

function findMarkdownLinkSourceRange(
  source: string,
  start: number,
  openerLength: number,
  parser: MarkdownInlineSourceParser | undefined,
  owner: MarkdownInlineSourceChild,
  destinationAttr: 'href' | 'src',
): MarkdownLinkSourceRange | null {
  if (!parser || source[start] !== '[' || source[start + 1] === '[') return null

  const labelStart = start + openerLength
  let shortcut: MarkdownLinkSourceRange | null = null

  for (let close = source.indexOf(']', labelStart); close !== -1; close = source.indexOf(']', close + 1)) {
    if (isBackslashEscaped(source, close)) continue
    const tail = parseLinkTail(source, close, parser)
    if (!tail) continue
    if (tail.kind === 'inline') {
      const expectedDestination = owner.attrs?.find(([name]) => name === destinationAttr)?.[1]
      const expectedTitle = owner.attrs?.find(([name]) => name === 'title')?.[1]
      if (
        expectedDestination &&
        parser.normalizeLink &&
        parser.normalizeLink(tail.destination ?? '') !== expectedDestination
      ) continue
      if (expectedTitle !== undefined && expectedTitle !== tail.title) continue
    }
    const candidate: MarkdownLinkSourceRange = {
      start,
      end: tail.end,
      labelStart,
      labelEnd: close,
      tailStart: tail.tailStart,
      kind: tail.kind,
    }
    if (tail.kind === 'shortcut') {
      shortcut ??= candidate
    } else {
      // The first structurally valid link tail after this actual link_open is
      // the link rule's closing surface. Do not keep scanning into sibling
      // links after it; their `]` tokens are outside this ownership group.
      return candidate
    }
  }

  return shortcut
}

function findImageSourceRange(
  source: string,
  start: number,
  owner: MarkdownInlineSourceChild,
  parser: MarkdownInlineSourceParser | undefined,
): MarkdownLinkSourceRange | null {
  if (source[start] !== '!' || source[start + 1] !== '[') return null
  const surface = findMarkdownLinkSourceRange(source, start + 1, 1, parser, owner, 'src')
  if (!surface) return null
  return { ...surface, start }
}

function findOpaqueAngleLinkEnd(source: string, start: number): number | null {
  if (source[start] !== '<') return null
  const end = source.indexOf('>', start + 1)
  return end === -1 ? null : end + 1
}

function beginLinkOwnership(
  source: string,
  cursor: number,
  child: MarkdownInlineSourceChild,
  parser: MarkdownInlineSourceParser | undefined,
  nonCodeRanges: MarkdownInlineSourceRange[],
): MarkdownLinkOwnership {
  if (source[cursor] === '[' && source[cursor + 1] === '[') {
    const end = source.indexOf(']]', cursor + 2)
    if (end === -1) return { kind: 'unresolved' }
    nonCodeRanges.push({ start: cursor, end: end + 2 })
    return { kind: 'opaque' }
  }

  if (child.type === 'link_open' && source[cursor] === '[') {
    const surface = findMarkdownLinkSourceRange(source, cursor, 1, parser, child, 'href')
    if (!surface) return { kind: 'unresolved' }
    if (surface.tailStart < surface.end) {
      nonCodeRanges.push({ start: surface.tailStart, end: surface.end })
    }
    return { kind: 'markdown', surface }
  }

  if (child.type === 'link_open') {
    const end = findOpaqueAngleLinkEnd(source, cursor)
    if (end !== null) {
      nonCodeRanges.push({ start: cursor, end })
      return { kind: 'opaque' }
    }
    // Linkify tokens have no Markdown link delimiter to skip. Only allow the
    // transparent path when the raw source visibly begins with the semantic
    // href; otherwise an unresolved preceding child could expose old source.
    const href = child.attrs?.find(([name]) => name === 'href')?.[1]
    if (href && (source.startsWith(href, cursor) || source.startsWith(href.replace(/^https?:\/\//iu, ''), cursor))) {
      return { kind: 'transparent' }
    }
  }

  if (child.type === 'image') {
    const surface = findImageSourceRange(source, cursor, child, parser)
    if (!surface) return { kind: 'unresolved' }
    nonCodeRanges.push({ start: surface.start, end: surface.end })
    return { kind: 'opaque', surface }
  }

  return { kind: 'unresolved' }
}

function rangesOverlap(
  left: MarkdownInlineSourceRange,
  right: MarkdownInlineSourceRange,
): boolean {
  return left.start < right.end && right.start < left.end
}

function findExactChildSourceRange(
  source: string,
  cursor: number,
  child: MarkdownInlineSourceChild,
): MarkdownInlineSourceRange | null {
  if (child.type === 'softbreak' && source.startsWith('\n', cursor)) {
    return { start: cursor, end: cursor + 1 }
  }

  if (child.type === 'hardbreak') {
    for (const rawBreak of ['\\\n', '  \n', '\n']) {
      if (source.startsWith(rawBreak, cursor)) {
        return { start: cursor, end: cursor + rawBreak.length }
      }
    }
  }

  const content = child.content ?? ''
  if (content.length === 0) return null

  if (child.type === 'html_inline') {
    const start = source.indexOf(content, cursor)
    return start === -1 ? null : { start, end: start + content.length }
  }

  // Plain text is only consumed when its token content is an exact raw prefix.
  // Entities, escapes, typographer output, and other normalized inline rules
  // are deliberately left unresolved rather than reverse-mapped heuristically.
  if (child.type === 'text' && source.startsWith(content, cursor)) {
    return { start: cursor, end: cursor + content.length }
  }

  return null
}

/** This is the normalization used by MarkdownIt's installed backticks rule. */
export function normalizeMarkdownCodeInlineSource(source: string): string {
  return source.replace(/\n/gu, ' ').replace(/^ (.+) $/u, '$1')
}

function findNextCodeInlineSourceRange(
  source: string,
  cursor: number,
  markerLength: number,
  content: string,
  nonCodeRanges: readonly MarkdownInlineSourceRange[],
): MarkdownCodeInlineSourceRange | null {
  if (markerLength < 1) return null

  let opener = source.indexOf('`', cursor)
  while (opener !== -1) {
    const openerEnd = runEnd(source, opener)
    if (openerEnd - opener === markerLength) {
      const end = findMatchingCloser(source, openerEnd, markerLength)
      if (end !== null) {
        const candidate = { start: opener, end }
        if (nonCodeRanges.some((range) => rangesOverlap(candidate, range))) {
          opener = source.indexOf('`', end)
          continue
        }
        const rawContent = source.slice(openerEnd, end - markerLength)
        if (normalizeMarkdownCodeInlineSource(rawContent) === content) {
          return { start: opener, end, markerLength }
        }
        // This is a complete, but unrelated, raw span. Skip it so that a
        // later actual code_inline child can only claim a later candidate.
        opener = source.indexOf('`', end)
        continue
      }
    }
    opener = openerEnd
  }
  return null
}

/**
 * Locate the raw source ranges represented by MarkdownIt's code_inline
 * children in one inline block. The result is aligned to the `code_inline`
 * children in actual child order; a null entry means that exact mapping could
 * not be proven. A failed mapping never causes later children to be guessed.
 *
 * Every child is visited. Proven exact-source non-code children advance the
 * monotonic cursor and are recorded as unavailable to later code-span matches.
 * This is what prevents backticks inside an `html_inline` attribute from being
 * mistaken for a later real `code_inline` with identical normalized content.
 */
export function findMarkdownCodeInlineSourceRanges(
  source: string,
  children: readonly MarkdownInlineSourceChild[],
  parser?: MarkdownInlineSourceParser,
): Array<MarkdownCodeInlineSourceRange | null> {
  const ranges: Array<MarkdownCodeInlineSourceRange | null> = []
  let cursor = 0
  const nonCodeRanges: MarkdownInlineSourceRange[] = []
  const linkOwnership: MarkdownLinkOwnership[] = []

  for (const child of children) {
    if (child.type === 'link_open') {
      const ownership = beginLinkOwnership(source, cursor, child, parser, nonCodeRanges)
      linkOwnership.push(ownership)
      if (ownership.surface) {
        if (ownership.kind === 'markdown') {
          cursor = ownership.surface.labelStart
        } else {
          cursor = ownership.surface.end
        }
      } else if (ownership.kind === 'unresolved') {
        cursor = source.length
      }
      continue
    }

    if (child.type === 'image') {
      const ownership = beginLinkOwnership(source, cursor, child, parser, nonCodeRanges)
      if (ownership.surface) cursor = ownership.surface.end
      else if (ownership.kind === 'unresolved') cursor = source.length
      continue
    }

    if (child.type === 'link_close') {
      const ownership = linkOwnership.pop()
      if (ownership?.surface && ownership.kind === 'markdown') {
        cursor = ownership.surface.end
      }
      continue
    }

    if (child.type !== 'code_inline') {
      const exactRange = findExactChildSourceRange(source, cursor, child)
      if (exactRange) {
        cursor = exactRange.end
        nonCodeRanges.push(exactRange)
      } else if (child.type === 'html_inline') {
        // An HTML token is an ownership anchor. If its exact source cannot be
        // located, later mappings must not guess around the unresolved range.
        cursor = source.length
      }
      continue
    }

    const range = findNextCodeInlineSourceRange(
      source,
      cursor,
      child.markup?.length ?? 0,
      child.content ?? '',
      nonCodeRanges,
    )
    ranges.push(range)
    if (range === null) {
      // Once one actual child cannot be mapped exactly, advancing later
      // children would invent ownership. Preserve only proven ranges.
      cursor = source.length
    } else {
      cursor = range.end
    }
  }

  return ranges
}
