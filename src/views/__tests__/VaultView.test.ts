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

  it('owns Create Version coordination at Vault scope across sidebar remounts', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain('const historyCommit = useHistoryCommit({')
    expect(source).toContain(':commit="historyCommit"')
    expect(source).toContain('refreshComparisons(committedPaths)')
    expect(source).toContain('const historyMutationLock = createPathMutationLock()')
    expect(source.match(/acquireMutation: historyMutationLock\.acquire/g)).toHaveLength(2)
    expect(source).toContain('canMutate: historyMutationLock.canAcquire')
    expect(source).toContain("toast.info(t('history.document_mutation_in_progress'))")
    expect(source).toContain('snapshotPaneRef.value?.focusViewer()')
    expect(source).toContain('comparisonPaneRef.value?.focusViewer()')
    expect(source.match(/:mutation-locked="historyMutationLock\.has/g)).toHaveLength(2)
    expect(source).not.toContain(':save-before-commit=')
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
