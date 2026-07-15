import type { WorkspaceTab } from './tabs'

function documentPath(tab: WorkspaceTab): string {
  if (tab.kind === 'history') return tab.id.slice('history:'.length)
  if (tab.kind === 'diff') return tab.id.slice('diff:'.length)
  return tab.id
}

export function fallbackAfterClosingWorkspaceTab(
  tabs: readonly WorkspaceTab[],
  closingId: string,
): string | null {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingId)
  const closing = tabs[closingIndex]
  if (!closing) return null

  const path = documentPath(closing)
  const remaining = tabs.filter((tab) => tab.id !== closingId)
  if (closing.kind === 'diff') {
    const history = remaining.find((tab) => tab.kind === 'history' && documentPath(tab) === path)
    if (history) return history.id
  }
  if (closing.kind === 'diff' || closing.kind === 'history') {
    const current = remaining.find((tab) => tab.kind === 'document' && tab.id === path)
    if (current) return current.id
  }

  return remaining[closingIndex]?.id ?? remaining[closingIndex - 1]?.id ?? null
}
