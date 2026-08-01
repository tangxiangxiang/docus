import { describe, expect, it } from 'vitest'
import type { DiffOp, FileDiff } from '../history-api'
import { buildUnifiedDiffRows, unifiedHunkLabel } from '../unified-diff'

function equal(line: number, text = `line ${line}`): DiffOp {
  return { op: 'equal', oldLine: line, newLine: line, text }
}

function file(ops: DiffOp[]): FileDiff {
  return {
    ops,
    stats: {
      added: ops.filter((op) => op.op === 'add').length,
      removed: ops.filter((op) => op.op === 'remove').length,
      equal: ops.filter((op) => op.op === 'equal').length,
    },
  }
}

describe('buildUnifiedDiffRows', () => {
  it('preserves structured operations and real line numbers', () => {
    const rows = buildUnifiedDiffRows(file([
      equal(1, '# Title'),
      { op: 'remove', oldLine: 2, newLine: null, text: 'is_a: Type' },
      { op: 'add', oldLine: null, newLine: 2, text: 'type: Type' },
      equal(3, 'url: https://example.com'),
    ]))

    expect(rows).toMatchObject([
      { kind: 'line', operation: 'equal', oldLine: 1, newLine: 1 },
      { kind: 'line', operation: 'remove', oldLine: 2, newLine: null },
      { kind: 'line', operation: 'add', oldLine: null, newLine: 2 },
      { kind: 'line', operation: 'equal', oldLine: 3, newLine: 3 },
    ])
  })

  it('merges nearby change blocks when their context overlaps', () => {
    const ops = Array.from({ length: 16 }, (_, index) => equal(index + 1))
    ops[4] = { op: 'remove', oldLine: 5, newLine: null, text: 'old A' }
    ops[9] = { op: 'add', oldLine: null, newLine: 10, text: 'new B' }
    const rows = buildUnifiedDiffRows(file(ops))

    expect(rows.filter((row) => row.kind === 'hunk')).toHaveLength(0)
  })

  it('collapses distant unchanged sections with accurate hunk counts', () => {
    const ops = Array.from({ length: 25 }, (_, index) => equal(index + 1))
    ops[1] = { op: 'remove', oldLine: 2, newLine: null, text: 'old A' }
    ops[19] = { op: 'add', oldLine: null, newLine: 20, text: 'new B' }
    const rows = buildUnifiedDiffRows(file(ops))
    const hunk = rows.find((row) => row.kind === 'hunk')

    expect(hunk).toMatchObject({
      kind: 'hunk',
      oldStart: 6,
      oldCount: 11,
      newStart: 6,
      newCount: 11,
      hiddenCount: 11,
      expandable: true,
    })
    if (hunk?.kind === 'hunk') expect(unifiedHunkLabel(hunk)).toBe('@@ -6,11 +6,11 @@')
  })

  it('does not collapse a small unchanged section', () => {
    const ops = [
      { op: 'remove', oldLine: 1, newLine: null, text: 'old' } as DiffOp,
      equal(2), equal(3), equal(4),
      { op: 'add', oldLine: null, newLine: 5, text: 'new' } as DiffOp,
    ]
    expect(buildUnifiedDiffRows(file(ops), { contextLines: 0, minimumHiddenLines: 4 }))
      .toHaveLength(5)
  })
})
