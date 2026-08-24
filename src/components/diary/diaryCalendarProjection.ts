import type { TreeNode } from '../../lib/api'
import { DIARY_ROOT, diaryDateFromPath, type DiaryDate } from '../../../shared/diaryProtocol'
import type { DiaryCalendarDay } from './diaryCalendarAdapter'

type TreeFolder = Extract<TreeNode, { kind: 'folder' }>

/**
 * Find the canonical Diary root in the full Vault tree.
 *
 * The server tree includes a synthetic `content` root, but keeping this
 * lookup structural makes the projection tolerant of the root wrapper being
 * changed without making arbitrary nested folders part of Diary identity.
 */
function diaryRoots(tree: readonly TreeNode[]): TreeFolder[] {
  const roots: TreeFolder[] = []
  const visit = (nodes: readonly TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        if (node.path === DIARY_ROOT) roots.push(node)
        visit(node.children)
      }
    }
  }
  visit(tree)
  return roots
}

/**
 * Project the authoritative full Vault tree into the minimal Diary calendar
 * model. Only direct file children of the exact `diary/` root can become
 * markers; names, metadata dates, nested paths, and other scopes are never
 * used as Diary identity.
 */
export function projectDiaryDaysFromTree(
  tree: readonly TreeNode[] | null | undefined,
): DiaryCalendarDay[] {
  const byDate = new Map<DiaryDate, DiaryCalendarDay>()

  for (const root of diaryRoots(tree ?? [])) {
    for (const child of root.children) {
      if (child.kind !== 'file') continue
      const date = diaryDateFromPath(child.path)
      if (!date) continue
      byDate.set(date, { date, hasDiary: true })
    }
  }

  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date))
}
