import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('VaultView editor tab wiring', () => {
  it('derives one save presentation per document and shares the active result with StatusBar', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain('save: deriveDocumentSavePresentation(tab)')
    expect(source).toContain('save: deriveDocumentSavePresentation(null)')
    expect(source).toContain('const activeSavePresentation = computed(() => (')
    expect(source).toContain(':save="activeSavePresentation"')
    expect(source).not.toContain("dirty: tab.saveStatus === 'dirty'")
    expect(source).not.toContain(':save-status=')
  })

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
    expect(source.match(/acquireMutation: historyMutationLock\.acquire\b/g)).toHaveLength(2)
    expect(source).toContain('canMutate: historyMutationLock.canAcquire')
    expect(source).toContain("toast.info(t('history.document_mutation_in_progress'))")
    expect(source).toContain('snapshotPaneRef.value?.focusViewer()')
    expect(source).toContain('comparisonPaneRef.value?.focusViewer()')
    expect(source.match(/:mutation-locked="historyMutationLock\.has/g)).toHaveLength(2)
    expect(source).not.toContain(':save-before-commit=')
  })

  it('coordinates latest-version withdrawal at Vault scope and closes dropped viewers', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain('const historyWithdraw = useHistoryWithdraw({')
    expect(source).toContain('acquireMutation: historyMutationLock.acquireAll')
    expect(source).toContain('refreshIndexRepairStatus: historyCommit.refreshIndexRepairStatus')
    expect(source).toContain('registerIndexRepair: historyCommit.registerIndexRepair')
    expect(source).toContain('settleIndexRepairPaths: historyCommit.settleIndexRepairPaths')
    expect(source).toContain('.filter((snapshot) => snapshot.revisionId === sha)')
    expect(source).toContain('.filter((comparison) => comparison.revisionId === sha)')
    expect(source).toContain(':withdraw="historyWithdraw"')
  })

  it('keeps Monaco mounted and isolates shortcuts for read-only history tabs', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const shortcutHandler = source.match(/function onVaultKeydown[\s\S]*?\n}/)?.[0]

    expect(source).toContain('v-show="!activeHistorySnapshot && !activeHistoryComparison && !activeDraftRecovery"')
    expect(source).toContain('<HistorySnapshotPane')
    expect(source).toContain('<HistoryComparisonPane')
    expect(source).toContain(':snapshot="activeHistorySnapshot"')
    expect(source).toContain('const historySnapshots = useHistorySnapshots()')
    expect(source).toContain('const historyComparisons = useHistoryComparisons({')
    expect(source).toContain('getCurrentDocument(path)')
    expect(source).toContain('return getLoadedEditorDocument(tabs.value, path)')
    expect(source).toContain('return (await getPost(path)).raw')
    expect(source).toContain("meta && event.key.toLowerCase() === 's'")
    expect(source).toContain('void closeWorkspaceTab(activeId)')
    expect(shortcutHandler).toBeDefined()
    expect(shortcutHandler?.match(/onEditorKeydown\(event\)/g)).toHaveLength(1)
    expect(shortcutHandler).toContain('if (!readOnlyTab)')
    expect(source).not.toContain('snapshots.value.push(activeTab')
  })

  it('revalidates recovery identity after View Current opens the document', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const handler = source.match(
      /async function viewCurrentRecoveryDocument[\s\S]*?\n}/,
    )?.[0]

    expect(handler).toBeDefined()
    expect(handler?.match(/await draftRecovery\.retry\(recoveryId\)/g)).toHaveLength(2)
    expect(handler).toContain('await openEditorPost(disk.documentPath)')
    expect(handler).toContain('refreshedDisk.documentId !== refreshed.draft.documentId')
    expect(handler).toContain('opened.documentId !== refreshed.draft.documentId')
    expect(handler).toContain('opened.loading')
    expect(handler).toContain('opened.loadError')
    expect(handler).toContain('recoveryTabs.open(refreshed, requestedView)')
    expect(handler).toContain('focusTab(refreshedDisk.documentPath)')
  })

  it('refreshes a failed recovery adoption before opening recovery content', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const handler = source.match(
      /async function restoreRecoveryDraft[\s\S]*?\n}/,
    )?.[0]

    expect(handler).toBeDefined()
    expect(handler?.match(/await draftRecovery\.retry\(recoveryId\)/g)).toHaveLength(3)
    expect(handler).toContain("if (latest?.status === 'ready' && latest.decision)")
    expect(handler).toContain("recoveryTabs.open(latest, 'content')")
    expect(handler).not.toContain("recoveryTabs.open(item, 'content')")
    expect(handler).not.toContain("recoveryTabs.open(refreshed, 'content')")
  })

  it('opens one dedicated diff workspace tab from a ready snapshot', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain("id: comparison.tabId")
    expect(source).toContain("kind: 'diff' as const")
    expect(source).toContain('@open-diff="openHistoryComparison"')
    expect(source).toContain('const request = historyComparisons.openComparison(snapshot)')
    expect(source).toContain('comparisonPaneRef.value?.focusViewer()')
    expect(source).toContain('historySnapshots.openCachedRevision({')
    expect(source).toContain(':history-read-only="Boolean(activeHistorySnapshot || activeHistoryComparison || activeDraftRecovery)"')
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

  it('routes command-palette and missing-wiki creation through the lifecycle service', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    expect(source).toContain('createDocument: (input) => {')
    expect(source).toContain('return lifecycleCreateFile(input)')
    expect(source).toContain('const created = await documentLifecycle.createFile({ path, title })')
    expect(source).toContain('await openPost(created.path, { refresh: false })')
    expect(source).not.toContain("await createPost({ path, title })")
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

  it('hands focus to the active tab after closing a non-active workspace tab', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const closeOne = source.match(/async function closeWorkspaceTab[\s\S]*?\n}/)?.[0]
    const closeMany = source.match(/async function closeManyWorkspaceTabs[\s\S]*?\n}/)?.[0]

    for (const handler of [closeOne, closeMany]) {
      expect(handler).toBeDefined()
      expect(handler).toContain('if (!result.activeWillClose)')
      expect(handler).toContain('const activeId = activeWorkspaceTabId.value')
      expect(handler).toContain('editorTabsRef.value?.focusTab(activeId)')
      expect(handler).toContain('vaultRef.value?.focus()')
    }
  })

  it('maps all tab kinds through one stable workspace order and persists only documents', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const reorder = source.match(/async function reorderWorkspaceTabs[\s\S]*?\n}/)?.[0]

    expect(source).toContain('const naturalWorkspaceTabs = computed<WorkspaceTab[]>')
    expect(source).toContain('const workspaceTabOrder = ref<string[]>([])')
    expect(source).toContain('reconcileWorkspaceTabOrder(workspaceTabOrder.value, availableIds)')
    expect(source).toContain('const workspaceTabs = computed<WorkspaceTab[]>')
    expect(reorder).toContain('applyWorkspaceTabOrder(')
    expect(reorder).toContain("tab?.kind === 'document'")
    expect(reorder).toContain('reorderOpenDocuments(documentPaths)')
    expect(reorder).toContain("request.input === 'keyboard'")
    expect(source).toContain('@reorder="reorderWorkspaceTabs"')
  })

  it('migrates renamed document IDs in place and owns Workspace close/cycle shortcuts', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const shortcut = source.match(/function onVaultKeydown[\s\S]*?\n}/)?.[0]

    expect(source).toContain('workspaceTabOrder.value = migrateWorkspaceTabIds(')
    expect(source).toContain('renameOpenDocuments: renameWorkspaceDocuments')
    expect(source).toContain('prepareWorkspaceRename,')
    expect(source).toContain('restoreRenamedWorkspaceTabFocus(')
    expect(source).toContain('workspaceShortcuts: false')
    expect(shortcut).toContain("event.key.toLowerCase() === 'w' && activeId")
    expect(shortcut).toContain("event.key === 'Tab' && workspaceTabs.value.length > 0")
    expect(shortcut).toContain('const direction = event.shiftKey ? -1 : 1')
    expect(shortcut).toContain('void selectWorkspaceTab(nextTab.id)')
  })

  it('warns when a family move settles without persisting the latest edit', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const handler = source.match(
      /onDraftFamilyMoveSettled: \(settlement\) => \{[\s\S]*?\n  \},/,
    )?.[0]

    expect(handler).toBeDefined()
    expect(handler).toContain("settlement.status === 'moved-write-failed'")
    expect(handler).toContain("toast.info(t('draft_recovery.family_settle_persist_warning'), 6000)")
    // The refresh still runs — the warning is additive, the tab
    // and pending state stay intact for the retry.
    expect(handler).toContain('void refreshRecoveryAfterFamilySettle(settlement)')
  })
})
