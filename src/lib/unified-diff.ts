import type { DiffOp, DiffOpKind, FileDiff } from './history-api'

export interface UnifiedDiffLineRow {
  kind: 'line'
  key: string
  operation: DiffOpKind
  oldLine: number | null
  newLine: number | null
  text: string
  words?: DiffOp[]
}

export interface UnifiedDiffHunkRow {
  kind: 'hunk'
  key: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  hiddenCount: number
  expandable: true
  lines: UnifiedDiffLineRow[]
}

export type UnifiedDiffRow = UnifiedDiffLineRow | UnifiedDiffHunkRow

export interface UnifiedDiffOptions {
  contextLines?: number
  minimumHiddenLines?: number
}

function toLineRow(op: DiffOp, index: number): UnifiedDiffLineRow {
  return {
    kind: 'line',
    key: `line-${index}-${op.oldLine ?? 'x'}-${op.newLine ?? 'x'}`,
    operation: op.op,
    oldLine: op.oldLine,
    newLine: op.newLine,
    text: op.text,
    words: op.words,
  }
}

/** Project structured FileDiff operations into unified rows with collapsed context. */
export function buildUnifiedDiffRows(
  diff: FileDiff,
  options: UnifiedDiffOptions = {},
): UnifiedDiffRow[] {
  const contextLines = Math.max(0, options.contextLines ?? 3)
  const minimumHiddenLines = Math.max(1, options.minimumHiddenLines ?? 4)
  const lines = diff.ops.map(toLineRow)
  const changed = lines.flatMap((line, index) => line.operation === 'equal' ? [] : [index])
  if (changed.length === 0) return lines

  const visible = new Set<number>()
  for (const index of changed) {
    const start = Math.max(0, index - contextLines)
    const end = Math.min(lines.length - 1, index + contextLines)
    for (let cursor = start; cursor <= end; cursor++) visible.add(cursor)
  }

  const rows: UnifiedDiffRow[] = []
  let index = 0
  while (index < lines.length) {
    if (visible.has(index)) {
      rows.push(lines[index]!)
      index++
      continue
    }

    const start = index
    while (index < lines.length && !visible.has(index)) index++
    const hidden = lines.slice(start, index)
    if (hidden.length < minimumHiddenLines || hidden.some((line) => line.operation !== 'equal')) {
      rows.push(...hidden)
      continue
    }

    const first = hidden[0]!
    const oldCount = hidden.filter((line) => line.oldLine !== null).length
    const newCount = hidden.filter((line) => line.newLine !== null).length
    const oldStart = first.oldLine ?? 0
    const newStart = first.newLine ?? 0
    rows.push({
      kind: 'hunk',
      key: `hunk-${oldStart}-${oldCount}-${newStart}-${newCount}`,
      oldStart,
      oldCount,
      newStart,
      newCount,
      hiddenCount: hidden.length,
      expandable: true,
      lines: hidden,
    })
  }
  return rows
}

export function unifiedHunkLabel(hunk: UnifiedDiffHunkRow): string {
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
}
