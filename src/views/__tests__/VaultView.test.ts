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
    // Adoption opens WITHOUT a workspace refresh: the tree/posts refresh
    // runs outside openPost's load try/catch, so a routine refresh
    // failure would otherwise reject the adoption (and abort the startup
    // loop). Recovery already certified the record through its stable
    // identity, and the retry right below re-verifies it after the open.
    expect(handler).toContain(
      'await openEditorPost(item.draft.documentPath, { refresh: false })',
    )
    expect(handler).toContain("if (latest?.status === 'ready' && latest.decision)")
    expect(handler).toContain("recoveryTabs.open(latest, 'content')")
    expect(handler).not.toContain("recoveryTabs.open(item, 'content')")
    expect(handler).not.toContain("recoveryTabs.open(refreshed, 'content')")
  })

  it('isolates a failed startup adoption without aborting the recovery loop', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const loop = source.match(
      /for \(const item of \[\.\.\.draftRecovery\.items\.value\]\)[\s\S]*?\n    \}/,
    )?.[0]

    expect(loop).toBeDefined()
    // Each startup adoption is wrapped individually: one failure must
    // keep the record and surface it through the Unsaved Content panel
    // instead of aborting Recovery for the remaining items —
    // baseline-match items never reach the Prompt, so a silent exception
    // would leave the stored bytes with no entry point at all.
    expect(loop).toContain('try {')
    expect(loop).toContain('await restoreRecoveryDraft(item.recoveryId)')
    expect(loop).toContain('} catch {')
    expect(loop).toContain('const failed = recoveryItem(item.recoveryId)')
    expect(loop).toContain("recoveryTabs.open(failed, 'content')")
    // The failed record must NOT be dismissed — it stays discoverable.
    expect(loop).not.toContain('dismissForSession')
  })

  it('keeps recovery storage read failures out of the workspace panel', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')
    const startup = source.match(
      /watch\(vaultId, \(id\) => \{[\s\S]*?\n\}, \{ immediate: true \}\)/,
    )?.[0]

    expect(startup).toBeDefined()
    // The ONLY panel switch inside startup recovery is the branch for
    // real unsupported records: a storage read failure must leave the
    // user's current panel (Files, Tags, History) alone instead of
    // auto-opening the Center on top of its default empty inventory.
    expect(startup?.match(/activePanel\.value = 'recovery'/g)).toHaveLength(1)
    expect(startup).toContain('warnRecoveryReadFailure(id)')
    // A successful read re-arms the notice for the next failure window.
    expect(startup).toContain('warnedRecoveryReadVaults.delete(id)')
    // The raw toast lives in the once-per-vault helper, not the watch.
    expect(startup).not.toContain("toast.info(t('draft_recovery.storage_read_failed')")
  })

  it('warns at most once per vault and re-arms on manual Center retry', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    // The startup watcher can re-fire (vault switches, reconnects); the
    // identical notice warns once per vault until the next successful
    // read clears the vault from the warned set.
    expect(source).toContain('const warnedRecoveryReadVaults = new Set<string>()')
    expect(source).toContain('if (warnedRecoveryReadVaults.has(vaultId)) return')
    expect(source).toContain('warnedRecoveryReadVaults.add(vaultId)')

    // A manual Center retry is user-initiated, so it re-arms the notice
    // and reports its own failure through the same deduplicated path.
    const manualRetry = source.match(/async function refreshRecoveryCenter[\s\S]*?\n}/)?.[0]
    expect(manualRetry).toBeDefined()
    expect(manualRetry).toContain('warnedRecoveryReadVaults.delete(currentVaultId)')
    expect(manualRetry).toContain('warnRecoveryReadFailure(currentVaultId)')
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

describe('VaultView AI live context capture wiring', () => {
  it('late-binds one synchronous capture delegate over the real workspace state', () => {
    const source = readFileSync(fileURLToPath(new URL('../VaultView.vue', import.meta.url)), 'utf8')

    // The sealed resolver is the only classifier; VaultView must not
    // duplicate its logic, so exactly one call site exists.
    expect(source).toContain("from '../composables/vault/aiLiveContext'")
    expect(source.match(/captureAiLiveContext\(/g) ?? []).toHaveLength(1)

    // Late-bound delegate: fail-closed none before the viewers exist,
    // declared BEFORE the context is created and provided.
    expect(source).toContain(
      "let captureWorkspaceAiContext: () => AiLiveContextCapture = () => ({ status: 'none' })",
    )
    expect(source.indexOf('let captureWorkspaceAiContext')).toBeLessThan(
      source.indexOf('const vaultContext = createVaultContext('),
    )
    expect(source).toContain('captureAiContext: () => captureWorkspaceAiContext()')

    // The rebind happens only after every workspace authority exists,
    // in particular after activeWorkspaceTabId itself.
    expect(source.indexOf('const activeWorkspaceTabId = computed(() => (')).toBeLessThan(
      source.indexOf('captureWorkspaceAiContext = () => captureAiLiveContext('),
    )

    // One capture over the real state — active workspace tab id as the
    // sole authority, never the route alone.
    expect(source).toContain('captureWorkspaceAiContext = () => captureAiLiveContext({')
    expect(source).toContain('vaultId: vaultId.value,')
    expect(source).toContain('activeWorkspaceTabId: activeWorkspaceTabId.value,')
    expect(source).toContain('documentTabs: tabs.value,')
    expect(source).toContain('historySnapshots: historySnapshots.snapshots.value,')
    expect(source).toContain('historyComparisons: historyComparisons.comparisons.value,')
    expect(source).toContain('recoveryTabs: recoveryTabs.tabs.value,')
    // Diff after-sides are re-read from the live editor buffer at the
    // capture instant.
    expect(source).toContain('liveDocument: (path) => liveEditorForPath(tabs.value, path)')
  })
})
