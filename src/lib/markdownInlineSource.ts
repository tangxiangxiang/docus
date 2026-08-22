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
): Array<MarkdownCodeInlineSourceRange | null> {
  const ranges: Array<MarkdownCodeInlineSourceRange | null> = []
  let cursor = 0
  const nonCodeRanges: MarkdownInlineSourceRange[] = []

  for (const child of children) {
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
