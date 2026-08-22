/**
 * Source ranges for MarkdownIt's `code_inline` tokens.
 *
 * MarkdownIt exposes the token content and backtick markup, but not the raw
 * source offsets. This deliberately mirrors only the installed backticks
 * rule's delimiter search so resource expansion and source-context metadata
 * can agree on the same code-span ownership without creating a second parser.
 */
export interface MarkdownCodeInlineSourceRange {
  start: number
  end: number
  markerLength: number
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

/** Mirror MarkdownIt's delimiter search over raw source. */
export function scanMarkdownCodeSpanSourceRanges(source: string): MarkdownCodeInlineSourceRange[] {
  const ranges: MarkdownCodeInlineSourceRange[] = []
  let cursor = 0
  while (cursor < source.length) {
    if (source[cursor] !== '`' || isEscaped(source, cursor)) {
      cursor += 1
      continue
    }

    const start = cursor
    const openerEnd = runEnd(source, start)
    const markerLength = openerEnd - start
    const end = findMatchingCloser(source, openerEnd, markerLength)
    if (end === null) {
      cursor = openerEnd
      continue
    }

    ranges.push({ start, end, markerLength })
    cursor = end
  }

  return ranges
}

/**
 * Locate the raw source ranges represented by MarkdownIt's code_inline
 * children. `markerLengths` must be the code_inline children in token order;
 * a mismatch returns no ranges rather than guessing ownership.
 */
export function findMarkdownCodeInlineSourceRanges(
  source: string,
  markerLengths: number[],
): MarkdownCodeInlineSourceRange[] {
  if (markerLengths.length === 0) return []
  const ranges = scanMarkdownCodeSpanSourceRanges(source)

  if (ranges.length !== markerLengths.length) return []
  for (let index = 0; index < ranges.length; index += 1) {
    if (ranges[index]?.markerLength !== markerLengths[index]) return []
  }
  return ranges
}
