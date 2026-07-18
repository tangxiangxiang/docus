import { describe, expect, it } from 'vitest'
import type { WorkspaceTab } from '../tabs'
import { deriveDocumentSavePresentation } from '../../../composables/vault/editor-tabs/savePresentation'
import {
  fallbackAfterClosingWorkspaceTab,
  fallbackAfterClosingWorkspaceTabs,
} from '../workspaceNavigation'

function tab(id: string, kind: WorkspaceTab['kind'], documentPath?: string): WorkspaceTab {
  return { id, kind, label: id, title: id, save: deriveDocumentSavePresentation(null), documentPath }
}

describe('workspace History navigation', () => {
  const tabs = [
    tab('inbox/a', 'document'),
    tab('inbox/b', 'document'),
    tab('history:inbox/a', 'history', 'inbox/a'),
    tab('diff:inbox/a', 'diff', 'inbox/a'),
    tab('history:inbox/b', 'history', 'inbox/b'),
    tab('diff:inbox/b', 'diff', 'inbox/b'),
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

  it('activates History when the last Current document closes', () => {
    const oneDocument = [
      tab('inbox/a', 'document'),
      tab('history:inbox/a', 'history', 'inbox/a'),
      tab('diff:inbox/a', 'diff', 'inbox/a'),
    ]
    expect(fallbackAfterClosingWorkspaceTabs(oneDocument, ['inbox/a'], 'inbox/a'))
      .toBe('history:inbox/a')
  })

  it('activates the only retained special tab after Close Others', () => {
    expect(fallbackAfterClosingWorkspaceTabs(
      tabs,
      tabs.filter((item) => item.id !== 'history:inbox/b').map((item) => item.id),
      'diff:inbox/a',
    )).toBe('history:inbox/b')
  })

  it('returns null only when a batch leaves no workspace tabs', () => {
    expect(fallbackAfterClosingWorkspaceTabs(tabs, tabs.map((item) => item.id), 'inbox/a'))
      .toBeNull()
  })
})
