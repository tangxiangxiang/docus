/**
 * Source ranges for MarkdownIt's actual `code_inline` tokens.
 *
 * MarkdownIt exposes each token's content and backtick markup, but not its raw
 * source offsets. This helper mirrors only the installed backticks rule's
 * delimiter search and content normalization. Callers provide one inline
 * block's source and the children MarkdownIt actually produced; unrelated
 * backticks in that block therefore cannot invalidate a real code span.
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

function isEscaped(source: string, position: number): boolean {
  let backslashes = 0
  for (let index = position - 1; index >= 0 && source[index] === '\\'; index -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
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

/** This is the normalization used by MarkdownIt's installed backticks rule. */
export function normalizeMarkdownCodeInlineSource(source: string): string {
  return source.replace(/\n/gu, ' ').replace(/^ (.+) $/u, '$1')
}

function findNextCodeInlineSourceRange(
  source: string,
  cursor: number,
  markerLength: number,
  content: string,
): MarkdownCodeInlineSourceRange | null {
  if (markerLength < 1) return null

  let opener = source.indexOf('`', cursor)
  while (opener !== -1) {
    if (!isEscaped(source, opener)) {
      const openerEnd = runEnd(source, opener)
      if (openerEnd - opener === markerLength) {
        const end = findMatchingCloser(source, openerEnd, markerLength)
        if (end !== null) {
          const rawContent = source.slice(openerEnd, end - markerLength)
          if (normalizeMarkdownCodeInlineSource(rawContent) === content) {
            return { start: opener, end, markerLength }
          }
          // This is a complete, but unrelated, raw span. Skip it so that
          // backticks in HTML attributes or other inline syntax do not make
          // the actual code_inline child disappear from the mapping.
          opener = source.indexOf('`', end)
          continue
        }
      }
      opener = openerEnd
      continue
    }
    opener += 1
  }
  return null
}

/**
 * Locate the raw source ranges represented by MarkdownIt's code_inline
 * children in one inline block. The result is aligned to the filtered
 * `code_inline` children; a null entry means that exact mapping could not be
 * proven. A failed mapping never causes later children to be guessed.
 */
export function findMarkdownCodeInlineSourceRanges(
  source: string,
  children: readonly MarkdownInlineSourceChild[],
): Array<MarkdownCodeInlineSourceRange | null> {
  const codeInlineChildren = children.filter((child) => child.type === 'code_inline')
  const ranges: Array<MarkdownCodeInlineSourceRange | null> = []
  let cursor = 0

  for (const child of codeInlineChildren) {
    const markerLength = child.markup?.length ?? 0
    const range = findNextCodeInlineSourceRange(
      source,
      cursor,
      markerLength,
      child.content ?? '',
    )
    ranges.push(range)
    if (range === null) {
      // Once one actual child cannot be mapped exactly, advancing later
      // children would invent ownership. Preserve only proven ranges.
      cursor = source.length
      continue
    }
    cursor = range.end
  }

  return ranges
}
