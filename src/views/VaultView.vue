<script setup lang="ts">
import { ref, inject, shallowRef, watch, computed, defineAsyncComponent, onBeforeUnmount, nextTick } from 'vue'
import { useStorage } from '@vueuse/core'
import { useShortcutDisplay } from '../composables/useShortcutDisplay'
import { useVaultLayout } from '../composables/vault/useVaultLayout'
import { useSplitterDrag } from '../composables/vault/useSplitterDrag'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useI18n } from '../composables/useI18n'
import { useEditorTabs } from '../composables/vault/useEditorTabs'
import { deriveDocumentSavePresentation } from '../composables/vault/editor-tabs/savePresentation'
import { useHistory } from '../composables/vault/useHistory'
import { useHistoryCommit } from '../composables/vault/useHistoryCommit'
import { useHistoryWithdraw } from '../composables/vault/useHistoryWithdraw'
import { createPathMutationLock } from '../composables/vault/pathMutationLock'
import { useHistorySnapshots, type HistoryRevisionSelection } from '../composables/vault/useHistorySnapshots'
import {
  useHistoryRestore,
  type HistoryRestoreRequest,
  type HistoryRestoreSource,
} from '../composables/vault/useHistoryRestore'
import {
  getLoadedEditorDocument,
  useHistoryComparisons,
  type HistoryComparison,
} from '../composables/vault/useHistoryComparisons'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { getLinkIndex, refreshLinkIndex, useLinkIndexSubscription } from '../composables/vault/useLinkIndex'
import { getPost, type DocumentMetadata } from '../lib/api'
import { formatHistoryDate } from '../lib/history-date'
import { isSlugSegment } from '../lib/slug'
import { resolveWikiTarget } from '../lib/linkResolve'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import { createVaultContext } from '../composables/vault/context/createVaultContext'
import { provideVaultContext } from '../composables/vault/context/useVaultContext'
import { createVaultFileChanges } from '../composables/vault/context/fileChanges'
import { useDocumentLifecycle } from '../composables/vault/useDocumentLifecycle'
import type { DocumentLifecycle } from '../composables/vault/useDocumentLifecycle'
import FileTree from '../components/vault/FileTree.vue'
import TagPanel from '../components/vault/TagPanel.vue'
import ReadingPane from '../components/vault/ReadingPane.vue'
import TocPanel from '../components/vault/TocPanel.vue'
import EmptyState from '../components/vault/EmptyState.vue'
import ActivityBar from '../components/vault/ActivityBar.vue'
import SettingsModal from '../components/vault/SettingsModal.vue'
import DocumentMetadataModal from '../components/vault/DocumentMetadataModal.vue'
import HistoryPanel from '../components/vault/HistoryPanel.vue'
import HistorySnapshotPane from '../components/vault/HistorySnapshotPane.vue'
import HistoryComparisonPane from '../components/vault/HistoryComparisonPane.vue'
import EditorTabs, {
  type WorkspaceTabReorderRequest,
} from '../components/vault/EditorTabs.vue'
import {
  closeManyWorkspaceTabState,
  closeWorkspaceTabState,
} from '../components/vault/workspaceClose'
import type { WorkspaceTab } from '../components/vault/tabs'
import {
  applyWorkspaceTabOrder,
  migrateWorkspaceTabIds,
  reconcileWorkspaceTabOrder,
} from '../components/vault/workspaceTabOrder'
import {
  focusedWorkspaceTabId,
  restoreRenamedWorkspaceTabFocus,
} from '../components/vault/workspaceTabFocus'
import {
  copyTextToClipboard,
  revealWorkspacePath,
} from '../components/vault/workspaceTabActions'
import StatusBar from '../components/vault/StatusBar.vue'
import CommandPalette from '../components/vault/CommandPalette.vue'

// Monaco is the heaviest client dependency. Load it only when edit mode
// actually mounts an editor, keeping navigation/read-only startup lean.
const EditorPane = defineAsyncComponent(() => import('../components/vault/EditorPane.vue'))

/* App.vue provides a global "open search" trigger so the NavBar button
   (which lives outside the router view) can ask the vault to open its
   CommandPalette. We watch the tick and call show() each time. */
const navSearch = inject<{ tick: ReturnType<typeof ref<number>>; trigger: () => void } | null>('openSearch', null)
const settingsOpen = ref(false)
const metadataOpen = ref(false)
const metadataPath = ref<string | null>(null)
const editorFocusWidth = useStorage('docus.editor.focus-width', true)

/* Platform-aware shortcut display for the empty-state hint chips.
   Computed once at module load (see useShortcutDisplay), so this
   just hands back the same `{ isMac, format }` for the whole
   session. */
const shortcuts = useShortcutDisplay()

/* Both edit-mode and read-mode render the same "no file open"
   empty card when `tabs.length === 0`. The action list lives here
   so the label / shortcut keys only need to be edited once and the
   template can `v-for` over them. The `.content-empty` wrapper
   around the card still owns the absolute-fill centering in either
   mode, so this list only describes the card body. */
/* View mode is provided globally by App.vue (see VaultViewModeKey).
   Default to 'edit' so this view still renders sensibly if it's ever
   mounted outside the App provider (e.g. in a unit test harness). */
const viewModeApi = inject(VaultViewModeKey, null)
const isReadMode = computed(() => viewModeApi?.mode.value === 'read')

/* ---------- Layout ---------- */
const {
  activePanel,
  sidePanelOpen,
  sidePanelWidth,
  rightRailWidth,
  vaultStyle,
  selectPanel,
  rightRailTab,
  rightRailCollapsed,
} = useVaultLayout()

/* Splitter drag lives in its own composable — it mutates the same
   width/ratio refs useVaultLayout returns, so the grid updates
   synchronously as the user drags. */
const { startDrag } = useSplitterDrag({
  sidePanelWidth,
  rightRailWidth,
})

/* The unified rail remains available in edit and read modes. */
const rightRailVisible = computed(() => !rightRailCollapsed.value)
// Side-panel filters are temporary view state. Keep the Files value here so
// switching to Tags or History can unmount FileTree without losing it.
const filesFilter = ref('')
const tagsFilter = ref('')
/* The splitter is a grid child only when the rail is visible. In the
   collapsed state the chevron affordance is rendered as an absolutely-
   positioned button pinned to the vault's right edge (see template
   below) — putting it in the grid would either force an extra column
   (creating a 1px gray strip where the rail used to be) or, with the
   default grid-auto-flow: row, wrap the splitter to row 2 (status
   bar), which is what produced the gray area the user reported. */
const toast = useToast()
const { confirm } = useConfirm()
const { locale, t } = useI18n()
const emptyActions = computed(() => [
  { label: t('vault.command_palette'), keys: shortcuts.format('mod+P') },
  { label: t('vault.toggle_sidebar'), keys: shortcuts.format('mod+B') },
])

// Lives in VaultView (not the composable) so the string `ref="vaultRef"`
// template binding resolves cleanly. startDrag takes the host as a parameter.
const vaultRef = shallowRef<HTMLElement | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
const editorTabsRef = ref<InstanceType<typeof EditorTabs> | null>(null)
const fileTreeRef = ref<InstanceType<typeof FileTree> | null>(null)
const snapshotPaneRef = ref<InstanceType<typeof HistorySnapshotPane> | null>(null)
const comparisonPaneRef = ref<InstanceType<typeof HistoryComparisonPane> | null>(null)
const workspaceTabOrder = ref<string[]>([])
function openSearch() { paletteRef.value?.show() }

/* ---------- Tabs / save / route sync ---------- */
const fileChanges = createVaultFileChanges()
const historyMutationLock = createPathMutationLock()
let lifecycleCreateFile: DocumentLifecycle['createFile'] | null = null
const {
  tree, vaultId, posts, tabs, activePath, activeTab, activeSize,
  refresh, openPost: openEditorPost, closeTab: closeEditorTab,
  confirmCloseMany: confirmCloseEditorTabs,
  closeManyConfirmed: closeManyEditorTabsConfirmed,
  selectTab: selectEditorTab, onEditorChange, doSaveNow, resolveExternal,
  prepareHistoryRestore, onKeydown: onEditorKeydown, onCommandPaletteNew,
  prepareHistoryCommit,
  prepareDocumentMutation, renameOpenDocuments, removeOpenDocuments,
  reorderOpenDocuments,
  applyLifecycleReferenceWrites,
} = useEditorTabs({
  selectPanel,
  toggleViewMode: () => viewModeApi?.toggle(),
  fileChanges,
  mutationLock: historyMutationLock,
  workspaceShortcuts: false,
  prepareWorkspaceRename,
  createDocument: (input) => {
    if (!lifecycleCreateFile) throw new Error('document lifecycle is not ready')
    return lifecycleCreateFile(input)
  },
})

function restoreRenamedTabFocus(
  focusedId: string | null,
  mappings: ReadonlyArray<{ from: string; to: string }>,
  expectedFocus?: Element | null,
): void {
  void restoreRenamedWorkspaceTabFocus(
    focusedId,
    mappings,
    (id) => editorTabsRef.value?.focusTab(id),
    expectedFocus,
  )
}

function prepareWorkspaceRename(from: string, to: string): () => void {
  const focusedId = focusedWorkspaceTabId()
  const focusedElement = document.activeElement
  return () => {
    workspaceTabOrder.value = reconcileWorkspaceTabOrder(
      migrateWorkspaceTabIds(workspaceTabOrder.value, [{ from, to }]),
      naturalWorkspaceTabIds.value,
    )
    if (document.activeElement === focusedElement) {
      restoreRenamedTabFocus(focusedId, [{ from, to }], focusedElement)
    }
  }
}

function renameWorkspaceDocuments(
  mappings: ReadonlyArray<{ from: string; to: string }>,
): void {
  const focusedId = focusedWorkspaceTabId()
  const focusedElement = document.activeElement
  workspaceTabOrder.value = migrateWorkspaceTabIds(workspaceTabOrder.value, mappings)
  renameOpenDocuments(mappings)
  restoreRenamedTabFocus(focusedId, mappings, focusedElement)
}

const documentLifecycle = useDocumentLifecycle({
  fileChanges,
  mutationLock: historyMutationLock,
  prepareDocumentMutation,
  getOpenDocumentPaths: () => tabs.value.map((tab) => tab.path),
  applyReferenceWrites: applyLifecycleReferenceWrites,
  renameOpenDocuments: renameWorkspaceDocuments,
  removeOpenDocuments,
  refresh,
})
lifecycleCreateFile = documentLifecycle.createFile
const vaultContext = createVaultContext({
  vaultId,
  fileChanges,
  tabs,
  activePath,
  activeTab,
  openPost,
  lifecycle: documentLifecycle,
})
provideVaultContext(vaultContext)
onBeforeUnmount(() => { vaultContext.dispose() })
const historySnapshots = useHistorySnapshots()
const activeHistorySnapshot = historySnapshots.activeSnapshot
const historyComparisons = useHistoryComparisons({
  getCurrentDocument(path) {
    return getLoadedEditorDocument(tabs.value, path)
  },
  async loadCurrentDocument(path) {
    return (await getPost(path)).raw
  },
})
const activeHistoryComparison = historyComparisons.activeComparison
const history = useHistory(vaultContext)
const historyCommit = useHistoryCommit({
  history,
  saveSelected: prepareHistoryCommit,
  acquireMutation: historyMutationLock.acquire,
  canMutate: historyMutationLock.canAcquire,
  async refreshComparisons(committedPaths) {
    await Promise.all(committedPaths.map((path) => (
      historyComparisons.refreshDocumentComparison(path.endsWith('.md') ? path.slice(0, -3) : path)
    )))
  },
})

async function confirmHistoryWithdraw(): Promise<boolean> {
  return confirm(t('history.withdraw_title'), t('history.withdraw_detail'), {
    confirmLabel: t('history.withdraw_confirm'),
    cancelLabel: t('history.withdraw_cancel'),
    destructive: true,
  })
}

const historyWithdraw = useHistoryWithdraw({
  history,
  confirm: confirmHistoryWithdraw,
  acquireMutation: historyMutationLock.acquireAll,
  canMutate: historyMutationLock.canAcquireAll,
  refreshIndexRepairStatus: historyCommit.refreshIndexRepairStatus,
  registerIndexRepair: historyCommit.registerIndexRepair,
  settleIndexRepairPaths: historyCommit.settleIndexRepairPaths,
  async refreshComparisons(paths) {
    await Promise.all(paths.map((filePath) => (
      historyComparisons.refreshDocumentComparison(
        filePath.endsWith('.md') ? filePath.slice(0, -3) : filePath,
      )
    )))
  },
  closeDroppedRevision(sha) {
    historySnapshots.closeSnapshots(
      historySnapshots.snapshots.value
        .filter((snapshot) => snapshot.revisionId === sha)
        .map((snapshot) => snapshot.tabId),
    )
    historyComparisons.closeComparisons(
      historyComparisons.comparisons.value
        .filter((comparison) => comparison.revisionId === sha)
        .map((comparison) => comparison.tabId),
    )
  },
})

function restoreSource(source: typeof activeHistorySnapshot.value | HistoryComparison): HistoryRestoreSource | null {
  if (!source || source.status !== 'ready') return null
  return {
    documentPath: source.documentPath,
    documentTitle: source.documentTitle,
    revisionId: source.revisionId,
    revisionTime: source.revisionTime,
    historicalRaw: 'rawMarkdown' in source ? source.rawMarkdown : source.oldRaw,
  }
}

function restoreDate(timestamp: number): string {
  return formatHistoryDate(timestamp, locale.value)
}

async function confirmHistoryRestore(request: HistoryRestoreRequest): Promise<boolean> {
  const detail = [
    t('history.restore_detail', {
      title: request.documentTitle,
      date: restoreDate(request.revisionTime),
    }),
    request.currentDirty ? t('history.restore_unsaved') : '',
    t('history.restore_no_commit'),
  ].filter(Boolean).join('\n\n')
  return confirm(t('history.restore_title'), detail, {
    confirmLabel: t('history.restore_confirm'),
    cancelLabel: t('history.restore_cancel'),
    destructive: true,
  })
}

const historyRestore = useHistoryRestore({
  tabs,
  fileChanges,
  confirm: confirmHistoryRestore,
  prepareEditorRestore: prepareHistoryRestore,
  refreshVault: refresh,
  refreshComparison: historyComparisons.refreshDocumentComparison,
  acquireMutation: historyMutationLock.acquire,
  onConflict(request) {
    toast.info(t('history.document_mutation_in_progress'))
    void nextTick(() => {
      if (activeHistorySnapshot.value?.documentPath === request.documentPath) {
        snapshotPaneRef.value?.focusViewer()
      } else if (activeHistoryComparison.value?.documentPath === request.documentPath) {
        comparisonPaneRef.value?.focusViewer()
      }
    })
  },
  onSuccess(request, result) {
    if (result.refreshFailed) {
      toast.info(t('history.restore_partial', { title: request.documentTitle }), 5000)
    } else {
      toast.success(t('history.restore_success', { title: request.documentTitle }))
    }
  },
  onError(_request, error) {
    const message = error instanceof Error && error.message
      ? error.message
      : t('history.comparison_load_failed')
    toast.error(t('history.restore_failed', { error: message }))
  },
})

function restoreHistoricalVersion(source: typeof activeHistorySnapshot.value | HistoryComparison): void {
  const captured = restoreSource(source)
  if (captured) void historyRestore.restore(captured)
}

function basename(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

const naturalWorkspaceTabs = computed<WorkspaceTab[]>(() => [
  ...tabs.value.map((tab) => ({
    id: tab.path,
    label: basename(tab.path),
    title: tab.title || tab.path,
    save: deriveDocumentSavePresentation(tab),
    kind: 'document' as const,
    documentPath: tab.path,
  })),
  ...historySnapshots.snapshots.value.map((snapshot) => ({
    id: snapshot.tabId,
    label: `${snapshot.documentTitle} (${t('history.snapshot_tab_suffix')})`,
    title: snapshot.documentTitle,
    save: deriveDocumentSavePresentation(null),
    kind: 'history' as const,
    documentPath: snapshot.documentPath,
  })),
  ...historyComparisons.comparisons.value.map((comparison) => ({
    id: comparison.tabId,
    label: `${comparison.documentTitle} (${t('history.diff_tab_suffix')})`,
    title: comparison.documentTitle,
    save: deriveDocumentSavePresentation(null),
    kind: 'diff' as const,
    documentPath: comparison.documentPath,
  })),
])
const naturalWorkspaceTabIds = computed(() => naturalWorkspaceTabs.value.map((tab) => tab.id))
watch(
  naturalWorkspaceTabIds,
  (availableIds) => {
    workspaceTabOrder.value = reconcileWorkspaceTabOrder(workspaceTabOrder.value, availableIds)
  },
  { immediate: true },
)
const workspaceTabs = computed<WorkspaceTab[]>(() => {
  const natural = naturalWorkspaceTabs.value
  const byId = new Map(natural.map((tab) => [tab.id, tab]))
  return reconcileWorkspaceTabOrder(workspaceTabOrder.value, natural.map((tab) => tab.id))
    .map((id) => byId.get(id))
    .filter((tab): tab is WorkspaceTab => Boolean(tab))
})
const activeSavePresentation = computed(() => (
  activeHistorySnapshot.value || activeHistoryComparison.value
    ? deriveDocumentSavePresentation(null)
    : deriveDocumentSavePresentation(activeTab.value)
))
const activeWorkspaceTabId = computed(() => (
  activeHistoryComparison.value?.tabId ?? activeHistorySnapshot.value?.tabId ?? activePath.value
))

async function reorderWorkspaceTabs(request: WorkspaceTabReorderRequest): Promise<void> {
  const availableIds = workspaceTabs.value.map((tab) => tab.id)
  if (!availableIds.includes(request.movedId)) return
  const nextOrder = applyWorkspaceTabOrder(
    workspaceTabOrder.value,
    request.orderedIds,
    availableIds,
  )
  if (!nextOrder) return
  workspaceTabOrder.value = nextOrder

  const byId = new Map(workspaceTabs.value.map((tab) => [tab.id, tab]))
  const documentPaths = nextOrder
    .map((id) => byId.get(id))
    .filter((tab): tab is WorkspaceTab => tab?.kind === 'document')
    .map((tab) => tab.documentPath ?? tab.id)
  reorderOpenDocuments(documentPaths)

  if (request.input === 'keyboard' || !activeWorkspaceTabId.value) {
    await nextTick()
    if (
      request.input === 'keyboard'
      && workspaceTabs.value.some((tab) => tab.id === request.movedId)
    ) {
      editorTabsRef.value?.focusTab(request.movedId)
    } else if (!activeWorkspaceTabId.value) {
      vaultRef.value?.focus()
    }
  }
}

async function openPost(path: string, options: { refresh?: boolean } = {}): Promise<void> {
  historyComparisons.deactivate()
  historySnapshots.viewCurrent()
  await openEditorPost(path, options)
}

async function selectWorkspaceTab(id: string, focusViewer = true): Promise<void> {
  if (historyComparisons.comparisons.value.some((comparison) => comparison.tabId === id)) {
    historySnapshots.viewCurrent()
    historyComparisons.selectComparison(id)
    if (focusViewer) {
      await nextTick()
      comparisonPaneRef.value?.focusViewer()
    }
  } else if (historySnapshots.snapshots.value.some((snapshot) => snapshot.tabId === id)) {
    historyComparisons.deactivate()
    historySnapshots.selectSnapshot(id)
    if (focusViewer) {
      await nextTick()
      snapshotPaneRef.value?.focusViewer()
    }
  } else {
    historyComparisons.deactivate()
    historySnapshots.viewCurrent()
    selectEditorTab(id)
    if (focusViewer) {
      await nextTick()
      editorTabsRef.value?.focusTab(id)
    }
  }
}

async function closeWorkspaceTab(id: string): Promise<void> {
  const result = await closeWorkspaceTabState(id, {
    workspaceTabs: workspaceTabs.value,
    activeId: activeWorkspaceTabId.value,
    comparisons: historyComparisons.comparisons.value,
    snapshotTabIds: historySnapshots.snapshots.value.map((snapshot) => snapshot.tabId),
    closeEditorTab,
    closeComparison: historyComparisons.closeComparison,
    closeSnapshot: historySnapshots.closeSnapshot,
    refreshDocumentComparison: historyComparisons.refreshDocumentComparison,
  })
  if (!result.closed) return
  if (!result.activeWillClose) {
    await nextTick()
    const activeId = activeWorkspaceTabId.value
    if (activeId) editorTabsRef.value?.focusTab(activeId)
    else vaultRef.value?.focus()
    return
  }
  if (!result.fallbackId) {
    await nextTick()
    vaultRef.value?.focus()
    return
  }

  await selectWorkspaceTab(result.fallbackId, false)
  await nextTick()
  editorTabsRef.value?.focusTab(result.fallbackId)
}

async function closeManyWorkspaceTabs(ids: string[]): Promise<void> {
  const result = await closeManyWorkspaceTabState(ids, {
    workspaceTabs: workspaceTabs.value,
    activeId: activeWorkspaceTabId.value,
    comparisons: () => historyComparisons.comparisons.value,
    confirmEditorTabs: confirmCloseEditorTabs,
    closeEditorTabsConfirmed: closeManyEditorTabsConfirmed,
    closeSnapshots: historySnapshots.closeSnapshots,
    closeComparisons: historyComparisons.closeComparisons,
    refreshDocumentComparison: historyComparisons.refreshDocumentComparison,
  })
  if (!result.closed) return
  if (!result.activeWillClose) {
    await nextTick()
    const activeId = activeWorkspaceTabId.value
    if (activeId) editorTabsRef.value?.focusTab(activeId)
    else vaultRef.value?.focus()
    return
  }
  if (!result.fallbackId) {
    await nextTick()
    vaultRef.value?.focus()
    return
  }
  await selectWorkspaceTab(result.fallbackId, false)
  await nextTick()
  editorTabsRef.value?.focusTab(result.fallbackId)
}

async function copyWorkspaceTabPath(path: string): Promise<void> {
  const copied = await copyTextToClipboard(path)
  if (copied) toast.success(t('workspace_tab.path_copied', { path }))
  else toast.error(t('workspace_tab.copy_path_failed'))
}

async function revealWorkspaceTabInTree(path: string): Promise<void> {
  activePanel.value = 'files'
  filesFilter.value = ''
  activeScope.value = null
  await nextTick()
  await revealWorkspacePath(path, {
    revealPath: async (targetPath) => fileTreeRef.value?.revealPath(targetPath),
    refresh,
    afterRefresh: nextTick,
    onNotFound: (targetPath) => toast.info(t('workspace_tab.reveal_failed', { path: targetPath })),
    onError: (targetPath) => toast.error(t('workspace_tab.reveal_failed', { path: targetPath })),
  })
}

function onVaultKeydown(event: KeyboardEvent): void {
  const readOnlyTab = activeHistoryComparison.value ?? activeHistorySnapshot.value
  const meta = event.metaKey || event.ctrlKey
  const activeId = activeWorkspaceTabId.value
  if (meta && event.key.toLowerCase() === 'w' && activeId) {
    event.preventDefault()
    void closeWorkspaceTab(activeId)
    return
  }
  if (meta && event.key === 'Tab' && workspaceTabs.value.length > 0) {
    event.preventDefault()
    const current = workspaceTabs.value.findIndex((tab) => tab.id === activeId)
    const direction = event.shiftKey ? -1 : 1
    const next = current < 0
      ? (direction > 0 ? 0 : workspaceTabs.value.length - 1)
      : (current + direction + workspaceTabs.value.length) % workspaceTabs.value.length
    const nextTab = workspaceTabs.value[next]
    if (nextTab) void selectWorkspaceTab(nextTab.id)
    return
  }
  if (!readOnlyTab) {
    onEditorKeydown(event)
    return
  }
  if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault()
    return
  }
  if (meta && event.key.toLowerCase() === 'e') {
    event.preventDefault()
    return
  }
  // A history snapshot keeps Monaco mounted only to preserve its model,
  // undo stack, and view state. Never forward snapshot key events to that
  // hidden editable document; unhandled keys belong to the read-only viewer.
}

async function openHistoryRevision(selection: HistoryRevisionSelection): Promise<void> {
  historyComparisons.deactivate()
  const request = historySnapshots.openRevision(selection)
  await nextTick()
  snapshotPaneRef.value?.focusViewer()
  await request
}

async function viewCurrentDocument(path: string): Promise<void> {
  historyComparisons.deactivate()
  historySnapshots.viewCurrent()
  await openEditorPost(path)
  await nextTick()
  editorTabsRef.value?.focusTab(path)
}

async function openHistoryComparison(snapshot: typeof activeHistorySnapshot.value): Promise<void> {
  if (!snapshot || snapshot.status !== 'ready') return
  historySnapshots.viewCurrent()
  const request = historyComparisons.openComparison(snapshot)
  await nextTick()
  comparisonPaneRef.value?.focusViewer()
  await request
}

async function viewHistoricalComparison(comparison: HistoryComparison): Promise<void> {
  historyComparisons.deactivate()
  historySnapshots.openCachedRevision({
    documentPath: comparison.documentPath,
    documentTitle: comparison.documentTitle,
    revisionId: comparison.revisionId,
    revisionTime: comparison.revisionTime,
    summary: comparison.summary,
  }, comparison.oldRaw)
  await nextTick()
  snapshotPaneRef.value?.focusViewer()
}

const editorLinkTargets = computed(() => posts.value.map((post) => ({ path: post.path, title: post.title })))

async function onMetadataSaved(metadata: DocumentMetadata) {
  const tab = tabs.value.find((item) => item.path === metadata.path)
  if (tab) tab.title = metadata.title
  metadataOpen.value = false
  await Promise.all([refresh(), refreshLinkIndex(fileChanges)])
}

function openDocumentProperties(path: string) {
  metadataPath.value = path
  metadataOpen.value = true
}

async function createMissingWikiNote(ref: string) {
  const clean = ref.replace(/\.md$/i, '').trim()
  const segments = clean.split('/')
  if (!segments.length || segments.some((segment) => !isSlugSegment(segment))) {
    toast.error(t('vault.wiki_path_invalid'))
    return
  }
  const path = clean.startsWith('inbox/') ? clean : `inbox/${clean}`
  const title = segments.at(-1)!.split('-').join(' ')
  try {
    const created = await documentLifecycle.createFile({ path, title })
    await openPost(created.path, { refresh: false })
    toast.success(t('common.created', { path: created.path }))
  } catch (error: any) {
    if (error?.status === 409) await openPost(path)
    else toast.error(t('common.create_failed', { error: error?.message ?? t('common.unknown_error') }))
  }
}

async function copyActiveContent() {
  const raw = activeHistoryComparison.value?.newRaw
    ?? activeHistorySnapshot.value?.rawMarkdown
    ?? activeTab.value?.raw
  if (raw === undefined) return
  try {
    await navigator.clipboard.writeText(raw)
    toast.success(t('vault.content_copied'))
  } catch { toast.error(t('vault.copy_failed')) }
}

async function showExternalDiff() {
  const tab = activeTab.value
  if (!tab) return
  await confirm(`${t('vault.local_version')}：\n\n${tab.raw.slice(0, 1600)}\n\n────────\n${t('vault.disk_version')}：\n\n${(tab.externalRaw ?? `(${t('vault.file_deleted')})`).slice(0, 1600)}`)
}

/* ---------- Scope filter (NavBar chips) ---------- */
// useScopeFilter is application-shell state because NavBar lives above the
// router view. This call installs its localStorage watcher; NavBar reads
// `activeScope` / `toggleScope` from the same instance, and FileTree
// filters `topLevel` off the same `activeScope` ref.
const { activeScope } = useScopeFilter()

/* ---------- Tag filter ---------- */
const selectedTag = ref<string | null>(null)

/* ---------- Bi-directional links ---------- */
// Mount the file-change-bus subscription so the link index stays
// fresh as the user (or AI) edits. The initial fetch is triggered
// by useLinkIndexSubscription's onMounted.
useLinkIndexSubscription(fileChanges)

// Wiki-link resolver: reads the *current* link index from
// this Vault instance's link index so updates flow through. The
// activeResolver in markdown.ts is set to a closure over this
// ref on every render). We pass the resolver through a getter
// function so the panes always see the latest index without
// having to re-mount.
const linkIndex = getLinkIndex(fileChanges)
const wikiResolver = (ref: string, _anchor?: string) => {
  const allPaths = Array.from(linkIndex.value.paths)
  return {
    target: resolveWikiTarget(ref, activePath.value ?? '', allPaths),
    alias: ref,
  }
}
const historyWikiResolver = (ref: string, _anchor?: string) => {
  const allPaths = Array.from(linkIndex.value.paths)
  return {
    target: resolveWikiTarget(ref, activeHistorySnapshot.value?.documentPath ?? '', allPaths),
    alias: ref,
  }
}

watch(activeHistorySnapshot, (snapshot) => {
  if (snapshot && rightRailTab.value === 'ai') rightRailTab.value = 'toc'
})
watch(activeHistoryComparison, (comparison) => {
  if (comparison && rightRailTab.value === 'ai') rightRailTab.value = 'toc'
})

watch(() => navSearch?.tick.value, () => openSearch())

/* After the Monaco addAction emits toggle-view-mode and isReadMode
   flips to true, the EditorPane is unmounted — taking the focused
   Monaco instance with it. The browser typically falls back to
   <body>, which is outside .vault's @keydown target. We explicitly
   move focus onto the vault container (which already has tabindex="0")
   so the next Cmd/Ctrl+E lands on the @keydown handler and can toggle
   back to edit mode. */
watch(isReadMode, async (reading) => {
  if (reading) {
    await nextTick()
    vaultRef.value?.focus()
  }
})

/* The mode toggle only swaps the editor/preview split for a single
   reading surface — the side panel, activity bar, tabs, and status
   bar (which now also carries the document path) all stay put so
   the user can still navigate while reading. So the vault's grid
   layout is the same in both modes. */
</script>

<template>
  <div
    ref="vaultRef"
    class="vault"
    :class="{ 'is-read': isReadMode, 'right-rail-open': rightRailVisible }"
    tabindex="0"
    :style="vaultStyle"
    @keydown="onVaultKeydown"
  >
    <ActivityBar
      :active-panel="activePanel"
      @select-panel="selectPanel"
      @open-settings="settingsOpen = true"
    />

    <SettingsModal
      :open="settingsOpen"
      @close="settingsOpen = false"
    />

    <DocumentMetadataModal
      :open="metadataOpen"
      :path="metadataPath"
      @close="metadataOpen = false"
      @saved="onMetadataSaved"
    />

    <FileTree
      v-if="activePanel === 'files'"
      ref="fileTreeRef"
      v-model:filter="filesFilter"
      :tree="tree"
      :posts="posts"
      :current-path="activePath"
      @select="openPost"
      @refresh="refresh"
      @open-properties="openDocumentProperties"
    />
    <TagPanel
      v-else-if="activePanel === 'tags'"
      v-model:filter="tagsFilter"
      :posts="posts"
      :selected-tag="selectedTag"
      :path="activePath"
      @select="selectedTag = selectedTag === $event ? null : $event"
      @open="openPost"
    />
    <HistoryPanel
      v-else-if="activePanel === 'history'"
      :history="history"
      :commit="historyCommit"
      :withdraw="historyWithdraw"
      :posts="posts"
      @open-revision="openHistoryRevision"
    />

    <div
      v-show="sidePanelOpen"
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      :title="t('vault.resize_sidebar')"
      @pointerdown="startDrag(vaultRef!, 'tree', $event)"
    />

    <section
      class="editor-area"
      :class="{ 'is-read': isReadMode, 'is-empty': workspaceTabs.length === 0 }"
    >
      <EditorTabs
        v-if="workspaceTabs.length > 0"
        ref="editorTabsRef"
        :tabs="workspaceTabs"
        :active-path="activeWorkspaceTabId"
        @select="selectWorkspaceTab"
        @close="closeWorkspaceTab"
        @close-many="closeManyWorkspaceTabs"
        @copy-path="copyWorkspaceTabPath"
        @reveal-in-tree="revealWorkspaceTabInTree"
        @reorder="reorderWorkspaceTabs"
      />

      <!-- Edit mode: single Monaco editor surface. -->
      <div
        v-if="!isReadMode"
        v-show="!activeHistorySnapshot && !activeHistoryComparison"
        class="content"
      >
        <div
          v-if="activeTab"
          class="editor-pane"
          :data-path="activeTab.path"
        >
          <div v-if="activeTab.loading" class="empty" role="status">{{ t('vault.loading_document', { path: activeTab.path }) }}</div>
          <div v-else-if="activeTab.loadError" class="empty error" role="alert">{{ activeTab.loadError }}</div>
          <EditorPane
            v-else
            :key="activeTab.path"
            :model-value="activeTab.raw"
            :path="activeTab.path"
            :focus-width="editorFocusWidth"
            :link-targets="editorLinkTargets"
            @update:model-value="(val: string) => onEditorChange(activeTab!.path, val)"
            @open-link="openPost"
            @create-link="createMissingWikiNote"
            @toggle-view-mode="viewModeApi?.toggle()"
          />
        </div>
        <div v-if="!tabs.length" class="content-empty">
          <EmptyState :title="t('vault.no_file_open')">
            <span v-for="a in emptyActions" :key="a.label" class="hint-row">
              <span class="hint-label">{{ a.label }}</span>
              <kbd class="hint-kbd">{{ a.keys }}</kbd>
            </span>
          </EmptyState>
        </div>
      </div>

      <!-- Read mode: single reading surface in the same slot. The side
           panel, tabs, and status bar above/below stay untouched so
           navigation still works while reading. -->
      <div
        v-else-if="!activeHistorySnapshot && !activeHistoryComparison"
        class="content reading-content"
      >
        <!-- Only the active tab is mounted. Mounting one ReadingPane
             per tab (v-for + v-show) would have every instance write
             to the same Vault-scoped tocHeadings / tocActiveId, and
             whichever rendered last would "win" — so switching tabs
             could surface the wrong document's TOC. Mounting a single
             keyed-by-path ReadingPane keeps the mapping 1:1 between
             the visible ReadingPane and the shared TOC state. -->
        <div
          v-if="activeTab"
          :key="activeTab.path"
          class="reading-slot"
        >
          <ReadingPane :raw="activeTab.raw" :resolver="wikiResolver" />
        </div>
        <div v-if="!tabs.length" class="content-empty">
          <EmptyState :title="t('vault.no_file_open')">
            <span v-for="a in emptyActions" :key="a.label" class="hint-row">
              <span class="hint-label">{{ a.label }}</span>
              <kbd class="hint-kbd">{{ a.keys }}</kbd>
            </span>
          </EmptyState>
        </div>
      </div>

      <div v-if="activeHistorySnapshot" class="content history-snapshot-content">
        <HistorySnapshotPane
          ref="snapshotPaneRef"
          :snapshot="activeHistorySnapshot"
          :resolver="historyWikiResolver"
          :restoring="historyRestore.restoring.value && historyRestore.restoringPath.value === activeHistorySnapshot.documentPath"
          :mutation-locked="historyMutationLock.has(`${activeHistorySnapshot.documentPath}.md`)"
          @view-current="viewCurrentDocument"
          @open-diff="openHistoryComparison"
          @restore="restoreHistoricalVersion"
          @retry="historySnapshots.retrySnapshot"
          @close="closeWorkspaceTab"
        />
      </div>

      <div v-if="activeHistoryComparison" class="content history-snapshot-content">
        <HistoryComparisonPane
          ref="comparisonPaneRef"
          :comparison="activeHistoryComparison"
          :restoring="historyRestore.restoring.value && historyRestore.restoringPath.value === activeHistoryComparison.documentPath"
          :mutation-locked="historyMutationLock.has(`${activeHistoryComparison.documentPath}.md`)"
          @view-historical="viewHistoricalComparison"
          @view-current="viewCurrentDocument"
          @restore="restoreHistoricalVersion"
          @retry="historyComparisons.refreshComparison"
          @close="closeWorkspaceTab"
        />
      </div>
    </section>

    <div
      v-if="rightRailVisible"
      class="splitter splitter-toc"
      role="separator"
      aria-orientation="vertical"
      :title="t('vault.resize_right_rail')"
      @pointerdown="startDrag(vaultRef!, 'rightRail', $event)"
    />
    <TocPanel
      v-if="rightRailVisible"
      class="toc-panel-slot"
      :path="activeHistoryComparison?.documentPath ?? activeHistorySnapshot?.documentPath ?? activePath"
      :posts="posts"
      :active-tab="rightRailTab"
      :history-read-only="Boolean(activeHistorySnapshot || activeHistoryComparison)"
      @update:active-tab="rightRailTab = $event"
      @link-navigate="openPost"
    />

    <StatusBar
      class="status-bar-row"
      :path="activeHistoryComparison?.documentPath ?? activeHistorySnapshot?.documentPath ?? activePath"
      :save="activeSavePresentation"
      :error="activeHistorySnapshot || activeHistoryComparison ? null : (activeTab?.error ?? null)"
      :size="activeHistoryComparison ? activeHistoryComparison.newRaw.length : (activeHistorySnapshot ? activeHistorySnapshot.rawMarkdown.length : activeSize)"
      :focus-width="editorFocusWidth"
      :external-kind="activeHistorySnapshot || activeHistoryComparison ? null : (activeTab?.externalKind ?? null)"
      @toggle-focus-width="editorFocusWidth = !editorFocusWidth"
      @retry-save="doSaveNow"
      @copy-content="copyActiveContent"
      @external-diff="showExternalDiff"
      @external-disk="activePath && resolveExternal(activePath, 'disk')"
      @external-local="activePath && resolveExternal(activePath, 'local')"
    />

    <CommandPalette
      ref="paletteRef"
      :posts="posts"
      :active-path="activePath"
      @select="openPost"
      @new="onCommandPaletteNew"
    />
  </div>
</template>
