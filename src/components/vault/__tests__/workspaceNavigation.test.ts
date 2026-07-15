import { describe, expect, it } from 'vitest'
import type { WorkspaceTab } from '../tabs'
import { fallbackAfterClosingWorkspaceTab } from '../workspaceNavigation'

function tab(id: string, kind: WorkspaceTab['kind']): WorkspaceTab {
  return { id, kind, label: id, title: id, dirty: false }
}

describe('workspace History navigation', () => {
  const tabs = [
    tab('inbox/a', 'document'),
    tab('inbox/b', 'document'),
    tab('history:inbox/a', 'history'),
    tab('diff:inbox/a', 'diff'),
    tab('history:inbox/b', 'history'),
    tab('diff:inbox/b', 'diff'),
  ]

  it('closes Diff to its matching History tab', () => {
    expect(fallbackAfterClosingWorkspaceTab(tabs, 'diff:inbox/a')).toBe('history:inbox/a')
  })

  it('closes Diff to Current when matching History is absent', () => {
    const withoutHistory = tabs.filter((item) => item.id !== 'history:inbox/a')
    expect(fallbackAfterClosingWorkspaceTab(withoutHistory, 'diff:inbox/a')).toBe('inbox/a')
  })

  it('closes History to its matching Current document', () => {
    expect(fallbackAfterClosingWorkspaceTab(tabs, 'history:inbox/b')).toBe('inbox/b')
  })

  it('uses a nearest remaining tab without leaving a blank workspace', () => {
    const onlySpecial = [tab('history:gone', 'history'), tab('inbox/next', 'document')]
    expect(fallbackAfterClosingWorkspaceTab(onlySpecial, 'history:gone')).toBe('inbox/next')
  })

  it('never crosses documents while a matching fallback exists', () => {
    expect(fallbackAfterClosingWorkspaceTab(tabs, 'diff:inbox/b')).toBe('history:inbox/b')
  })
})
