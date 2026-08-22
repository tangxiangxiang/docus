export type FenceSpecial = 'mermaid' | 'markmap'

export type FenceLineNumbers = 'off' | 'on' | 'start'

/**
 * Block-level metadata parsed from a Markdown fenced-code info string.
 *
 * This type intentionally contains no source-code notation state. Directives
 * such as `[!code focus]` are consumed by the Shiki transformer pipeline from
 * the code body, not by this parser.
 */
export interface FenceMeta {
  rawInfo: string
  language: string
  normalizedLanguage: string
  specialFence: FenceSpecial | null
  highlightRanges: number[]
  lineNumbers: FenceLineNumbers
  lineNumberStart?: number
  label?: string
  malformed: string[]
}

/** The approved MD-EXT-3 bound for future line-number metadata. */
export const MAX_LINE_NUMBER_START = 100_000

/** A conservative bound for fence metadata line ranges. */
export const MAX_HIGHLIGHT_RANGE_LINE = 100_000

const LANGUAGE_STOP_CHARS = /[\s:[\]{}]/u
const RANGE_LIST_PATTERN = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/u
const LINE_NUMBER_MODIFIER_PATTERN = /^:(line-numbers|no-line-numbers)(?:=(.+))?$/u

function parseBoundedPositiveInteger(value: string, maximum: number): number | null {
  if (!/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) return null
  return parsed
}

function parseRangeList(value: string, current: Set<number>): boolean {
  if (!RANGE_LIST_PATTERN.test(value)) return false

  const parsed: number[] = []
  for (const item of value.split(',')) {
    const [startText, endText] = item.split('-')
    const start = parseBoundedPositiveInteger(startText ?? '', MAX_HIGHLIGHT_RANGE_LINE)
    const end = endText === undefined
      ? start
      : parseBoundedPositiveInteger(endText, MAX_HIGHLIGHT_RANGE_LINE)
    if (start === null || end === null || end < start) return false

    // Keep malformed/hostile input from forcing an unbounded allocation. The
    // range is expanded only after every element has passed the bound check.
    if ((end - start + 1) > MAX_HIGHLIGHT_RANGE_LINE || parsed.length + (end - start + 1) > MAX_HIGHLIGHT_RANGE_LINE) {
      return false
    }
    for (let line = start; line <= end; line += 1) parsed.push(line)
  }

  for (const line of parsed) current.add(line)
  return true
}

function readUntilMetadataBoundary(info: string, start: number): { value: string; end: number } {
  let end = start
  while (end < info.length && !/[\s\[{]/u.test(info[end] ?? '')) end += 1
  return { value: info.slice(start, end), end }
}

/**
 * Parse only the Markdown fenced-code info string.
 *
 * The parser is deliberately narrow: unknown tokens are retained in
 * `malformed` and never become HTML attributes, classes, or styles.
 */
export function parseFenceMeta(info: string): FenceMeta {
  const rawInfo = info
  const trimmed = info.trim()
  let cursor = 0
  while (cursor < info.length && /\s/u.test(info[cursor] ?? '')) cursor += 1

  const languageStart = cursor
  while (cursor < info.length && !LANGUAGE_STOP_CHARS.test(info[cursor] ?? '')) cursor += 1
  const language = info.slice(languageStart, cursor)
  const malformed: string[] = []
  const highlightSet = new Set<number>()
  let lineNumbers: FenceLineNumbers = 'off'
  let lineNumberStart: number | undefined
  let label: string | undefined

  while (cursor < info.length) {
    while (cursor < info.length && /\s/u.test(info[cursor] ?? '')) cursor += 1
    if (cursor >= info.length) break

    const marker = info[cursor]
    if (marker === '{') {
      const close = info.indexOf('}', cursor + 1)
      if (close === -1) {
        malformed.push(info.slice(cursor).trim())
        break
      }
      const token = info.slice(cursor, close + 1)
      const rangeText = info.slice(cursor + 1, close)
      if (!parseRangeList(rangeText, highlightSet)) malformed.push(token)
      cursor = close + 1
      continue
    }

    if (marker === '[') {
      const close = info.indexOf(']', cursor + 1)
      if (close === -1) {
        malformed.push(info.slice(cursor).trim())
        break
      }
      const token = info.slice(cursor, close + 1)
      const nextLabel = info.slice(cursor + 1, close).trim()
      if (!nextLabel || label !== undefined) malformed.push(token)
      else label = nextLabel
      cursor = close + 1
      continue
    }

    const tokenStart = cursor
    const token = readUntilMetadataBoundary(info, cursor)
    cursor = token.end
    if (!token.value) {
      malformed.push(info[tokenStart] ?? '')
      cursor = Math.max(cursor, tokenStart + 1)
      continue
    }

    if (token.value.startsWith(':')) {
      const modifier = LINE_NUMBER_MODIFIER_PATTERN.exec(token.value)
      if (!modifier) {
        malformed.push(token.value)
        continue
      }

      const [, name, value] = modifier
      if (name === 'no-line-numbers') {
        if (value !== undefined) malformed.push(token.value)
        else {
          lineNumbers = 'off'
          lineNumberStart = undefined
        }
        continue
      }
      if (value === undefined) {
        lineNumbers = 'on'
        lineNumberStart = undefined
        continue
      }

      const parsedStart = parseBoundedPositiveInteger(value, MAX_LINE_NUMBER_START)
      if (parsedStart === null) {
        malformed.push(token.value)
        continue
      }
      lineNumbers = 'start'
      lineNumberStart = parsedStart
      continue
    }

    malformed.push(token.value)
  }

  const sortedRanges = [...highlightSet].sort((a, b) => a - b)
  const normalizedLanguage = language.toLowerCase()
  const specialFence: FenceSpecial | null = trimmed === 'mermaid'
    ? 'mermaid'
    : trimmed === 'markmap'
      ? 'markmap'
      : null

  return {
    rawInfo,
    language,
    normalizedLanguage,
    specialFence,
    highlightRanges: sortedRanges,
    lineNumbers,
    ...(lineNumberStart === undefined ? {} : { lineNumberStart }),
    ...(label === undefined ? {} : { label }),
    malformed,
  }
}

function compressRanges(ranges: readonly number[]): string {
  if (ranges.length === 0) return ''
  const parts: string[] = []
  let start = ranges[0] as number
  let previous = start

  for (const line of ranges.slice(1)) {
    if (line === previous + 1) {
      previous = line
      continue
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`)
    start = line
    previous = line
  }
  parts.push(start === previous ? String(start) : `${start}-${previous}`)
  return parts.join(',')
}

/**
 * Return a safe raw metadata value for Shiki's official meta transformer.
 * Invalid author ranges are intentionally omitted rather than passed through
 * to Shiki's range expansion logic.
 */
export function getFenceMetaHighlightRaw(meta: FenceMeta): string {
  const ranges = compressRanges(meta.highlightRanges)
  return ranges ? `{${ranges}}` : ''
}
