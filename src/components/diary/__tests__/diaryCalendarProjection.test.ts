import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../lib/api'
import { projectDiaryDaysFromTree } from '../diaryCalendarProjection'

function file(path: string, title = path): TreeNode {
  const name = path.split('/').pop() ?? path
  return { kind: 'file', name, path, title, mtime: 0 }
}

function folder(path: string, children: TreeNode[]): TreeNode {
  return {
    kind: 'folder',
    name: path.split('/').pop() ?? 'content',
    path,
    children,
  }
}

describe('projectDiaryDaysFromTree', () => {
  it('projects only direct valid Diary files from the full tree', () => {
    const tree: TreeNode[] = [folder('', [
      folder('diary', [
        file('diary/2026-08-25'),
        file('diary/2026-08-24'),
        file('diary/foo', '2026-08-26'),
        file('diary/2026-02-31'),
        folder('diary/nested', [file('diary/nested/2026-08-26')]),
      ]),
      file('inbox/2026-08-27', '2026-08-27'),
      file('archive/2026-08-28', '2026-08-28'),
    ])]

    expect(projectDiaryDaysFromTree(tree)).toEqual([
      { date: '2026-08-24', hasDiary: true },
      { date: '2026-08-25', hasDiary: true },
    ])
  })

  it('keeps invalid and unmanaged content available to the tree without projecting it', () => {
    const tree: TreeNode[] = [folder('', [
      folder('diary', [
        file('diary/legacy', '2026-08-24'),
        file('diary/2026-08-24.md'),
        folder('diary/2026', [file('diary/2026/08-24')]),
      ]),
    ])]

    expect(projectDiaryDaysFromTree(tree)).toEqual([])
    expect(tree[0].kind === 'folder' && tree[0].children[0]?.kind === 'folder').toBe(true)
  })

  it('handles an empty or missing Diary root', () => {
    expect(projectDiaryDaysFromTree([])).toEqual([])
    expect(projectDiaryDaysFromTree([folder('', [])])).toEqual([])
    expect(projectDiaryDaysFromTree([folder('', [folder('inbox', [file('inbox/2026-08-24')])])])).toEqual([])
  })

  it('deduplicates duplicate tree anomalies and uses no metadata date', () => {
    const tree: TreeNode[] = [folder('', [
      folder('diary', [
        file('diary/2026-08-24', 'not-a-date-title'),
        file('diary/2026-08-24', 'duplicate'),
      ]),
      file('inbox/not-a-date-path', '2026-08-25'),
    ])]

    expect(projectDiaryDaysFromTree(tree)).toEqual([
      { date: '2026-08-24', hasDiary: true },
    ])
  })
})
