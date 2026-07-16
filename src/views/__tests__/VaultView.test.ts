import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('VaultView editor tab wiring', () => {
  it('re-keys EditorPane and binds events to the rendered tab path', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const editorPane = source.match(/<EditorPane[\s\S]*?\/>/)?.[0]

    expect(editorPane).toBeDefined()
    expect(editorPane).toContain(':key="activeTab.path"')
    expect(editorPane).toContain('onEditorChange(activeTab!.path, val)')
    expect(editorPane).not.toContain('activePath!')
  })

  it('keeps the editor and tabs mounted while the History sidebar is active', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain('v-else-if="activePanel === \'history\'"')
    expect(source).toContain('@open-revision="openHistoryRevision"')
    expect(source).not.toContain("import DiffView")
    expect(source).not.toContain('activePanel !== \'history\' && tabs.length > 0')
    expect(source).not.toContain('activePanel === \'history\'" class="content content-diff"')
  })

  it('keeps Monaco mounted and isolates shortcuts for read-only history tabs', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const shortcutHandler = source.match(/function onVaultKeydown[\s\S]*?\n}/)?.[0]

    expect(source).toContain('v-show="!activeHistorySnapshot && !activeHistoryComparison"')
    expect(source).toContain('<HistorySnapshotPane')
    expect(source).toContain('<HistoryComparisonPane')
    expect(source).toContain(':snapshot="activeHistorySnapshot"')
    expect(source).toContain('const historySnapshots = useHistorySnapshots()')
    expect(source).toContain('const historyComparisons = useHistoryComparisons({')
    expect(source).toContain('getCurrentDocument(path)')
    expect(source).toContain('return getLoadedEditorDocument(tabs.value, path)')
    expect(source).toContain('return (await getPost(path)).raw')
    expect(source).toContain("meta && event.key.toLowerCase() === 's'")
    expect(source).toContain('void closeWorkspaceTab(readOnlyTab.tabId)')
    expect(source).toContain('fallbackAfterClosingWorkspaceTab(workspaceTabs.value, id)')
    expect(shortcutHandler).toBeDefined()
    expect(shortcutHandler?.match(/onEditorKeydown\(event\)/g)).toHaveLength(1)
    expect(shortcutHandler).toContain('if (!readOnlyTab)')
    expect(source).not.toContain('snapshots.value.push(activeTab')
  })

  it('opens one dedicated diff workspace tab from a ready snapshot', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain("id: comparison.tabId")
    expect(source).toContain("kind: 'diff' as const")
    expect(source).toContain('@open-diff="openHistoryComparison"')
    expect(source).toContain('const request = historyComparisons.openComparison(snapshot)')
    expect(source).toContain('comparisonPaneRef.value?.focusViewer()')
    expect(source).toContain('historySnapshots.openCachedRevision({')
    expect(source).toContain(':history-read-only="Boolean(activeHistorySnapshot || activeHistoryComparison)"')
    expect(source).toContain('...historyComparisons.comparisons.value.map')
    expect(source).not.toContain('restoreComparison')
  })

  it('coordinates document restore outside the read-only viewers', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain('const historyRestore = useHistoryRestore({')
    expect(source).toContain('prepareEditorRestore: prepareHistoryRestore')
    expect(source).toContain('refreshComparison: historyComparisons.refreshDocumentComparison')
    expect(source).toContain('@restore="restoreHistoricalVersion"')
    expect(source).toContain("t('history.restore_unsaved')")
    expect(source).toContain("t('history.restore_no_commit')")
    expect(source).toContain('destructive: true')
  })

  it('confirms document batches before closing special tabs and applies workspace fallback', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const closeMany = source.match(/async function closeManyWorkspaceTabs[\s\S]*?\n}/)?.[0]

    expect(closeMany).toBeDefined()
    expect(closeMany).toContain('fallbackAfterClosingWorkspaceTabs')
    expect(closeMany).toContain('const documentsConfirmed = await confirmCloseEditorTabs(documentIds)')
    expect(closeMany).toContain('if (!documentsConfirmed) return')
    expect(closeMany!.indexOf('if (!documentsConfirmed) return'))
      .toBeLessThan(closeMany!.indexOf('historySnapshots.closeSnapshots(historyIds)'))
    expect(closeMany).toContain('closeManyEditorTabsConfirmed(documentIds)')
    expect(closeMany).toContain('await selectWorkspaceTab(fallbackId, false)')
  })

  it('refreshes a retained active Diff after its dirty Current tab is discarded', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const closeOne = source.match(/async function closeWorkspaceTab[\s\S]*?\n}/)?.[0]

    expect(closeOne).toBeDefined()
    expect(closeOne).toContain('await historyComparisons.refreshDocumentComparison(id)')
    expect(closeOne!.indexOf('await closeEditorTab(id)'))
      .toBeLessThan(closeOne!.indexOf('await historyComparisons.refreshDocumentComparison(id)'))
    expect(closeOne!.indexOf('await historyComparisons.refreshDocumentComparison(id)'))
      .toBeLessThan(closeOne!.indexOf('if (!wasActive) return'))
  })

  it('refreshes retained Diffs after Close Others removes their dirty Current tabs', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const closeMany = source.match(/async function closeManyWorkspaceTabs[\s\S]*?\n}/)?.[0]

    expect(closeMany).toBeDefined()
    expect(closeMany).toContain('const remainingComparisonPaths = documentIds.filter')
    expect(closeMany).toContain('historyComparisons.comparisons.value.some')
    expect(closeMany).toContain('await Promise.all(')
    expect(closeMany).toContain('historyComparisons.refreshDocumentComparison(path)')
    expect(closeMany!.indexOf('historyComparisons.closeComparisons(comparisonIds)'))
      .toBeLessThan(closeMany!.indexOf('const remainingComparisonPaths'))
    expect(closeMany!.indexOf('await Promise.all('))
      .toBeLessThan(closeMany!.indexOf('if (!activeWillClose) return'))
  })

  it('focuses loading History viewers before their network requests settle', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const openRevision = source.match(/async function openHistoryRevision[\s\S]*?\n}/)?.[0]
    const openComparison = source.match(/async function openHistoryComparison[\s\S]*?\n}/)?.[0]

    for (const handler of [openRevision, openComparison]) {
      expect(handler).toBeDefined()
      expect(handler).toContain('const request =')
      expect(handler!.indexOf('focusViewer()')).toBeLessThan(handler!.indexOf('await request'))
    }
  })
})
