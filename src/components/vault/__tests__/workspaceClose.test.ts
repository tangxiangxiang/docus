import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceTab } from '../tabs'
import {
  closeManyWorkspaceTabState,
  closeWorkspaceTabState,
} from '../workspaceClose'

const tabs: WorkspaceTab[] = [
  { id: 'a.md', label: 'A', title: 'A', dirty: true, kind: 'document' },
  { id: 'history:a.md:r1', label: 'A History', title: 'A History', dirty: false, kind: 'history' },
  { id: 'diff:a.md', label: 'A Diff', title: 'A Diff', dirty: false, kind: 'diff' },
  { id: 'b.md', label: 'B', title: 'B', dirty: false, kind: 'document' },
]

describe('Workspace close coordination', () => {
  it('refreshes a retained active Diff only after its dirty Current tab closes', async () => {
    const calls: string[] = []
    const result = await closeWorkspaceTabState('a.md', {
      workspaceTabs: tabs,
      activeId: 'diff:a.md',
      comparisons: [{ tabId: 'diff:a.md', documentPath: 'a.md' }],
      snapshotTabIds: ['history:a.md:r1'],
      closeEditorTab: async () => { calls.push('close-current'); return true },
      closeComparison: vi.fn(),
      closeSnapshot: vi.fn(),
      refreshDocumentComparison: async () => { calls.push('refresh-diff'); return true },
    })

    expect(calls).toEqual(['close-current', 'refresh-diff'])
    expect(result).toEqual({ closed: true, activeWillClose: false, fallbackId: null })
  })

  it('does not mutate any Workspace state when batch confirmation is cancelled', async () => {
    const closeEditorTabsConfirmed = vi.fn()
    const closeSnapshots = vi.fn()
    const closeComparisons = vi.fn()
    const refreshDocumentComparison = vi.fn()

    const result = await closeManyWorkspaceTabState(['a.md', 'diff:a.md'], {
      workspaceTabs: tabs,
      activeId: 'diff:a.md',
      comparisons: () => [{ tabId: 'diff:a.md', documentPath: 'a.md' }],
      confirmEditorTabs: async () => false,
      closeEditorTabsConfirmed,
      closeSnapshots,
      closeComparisons,
      refreshDocumentComparison,
    })

    expect(result.closed).toBe(false)
    expect(closeEditorTabsConfirmed).not.toHaveBeenCalled()
    expect(closeSnapshots).not.toHaveBeenCalled()
    expect(closeComparisons).not.toHaveBeenCalled()
    expect(refreshDocumentComparison).not.toHaveBeenCalled()
  })

  it('refreshes only Diffs retained after Close Others removes Current tabs', async () => {
    let remaining = [
      { tabId: 'diff:a.md', documentPath: 'a.md' },
      { tabId: 'diff:b.md', documentPath: 'b.md' },
    ]
    const refreshDocumentComparison = vi.fn().mockResolvedValue(true)

    await closeManyWorkspaceTabState(['a.md', 'b.md', 'diff:b.md'], {
      workspaceTabs: [
        ...tabs,
        { id: 'diff:b.md', label: 'B Diff', title: 'B Diff', dirty: false, kind: 'diff' },
      ],
      activeId: 'diff:a.md',
      comparisons: () => remaining,
      confirmEditorTabs: async () => true,
      closeEditorTabsConfirmed: vi.fn(),
      closeSnapshots: vi.fn(),
      closeComparisons: (ids) => {
        remaining = remaining.filter((comparison) => !ids.includes(comparison.tabId))
      },
      refreshDocumentComparison,
    })

    expect(refreshDocumentComparison).toHaveBeenCalledOnce()
    expect(refreshDocumentComparison).toHaveBeenCalledWith('a.md')
  })
})
