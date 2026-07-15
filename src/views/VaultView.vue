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
import { useHistorySnapshots, type HistoryRevisionSelection } from '../composables/vault/useHistorySnapshots'
import {
  getLoadedEditorDocument,
  useHistoryComparisons,
  type HistoryComparison,
} from '../composables/vault/useHistoryComparisons'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { getLinkIndex, refreshLinkIndex, useLinkIndexSubscription } from '../composables/vault/useLinkIndex'
import { createPost, getPost, type DocumentMetadata } from '../lib/api'
import { isSlugSegment } from '../lib/slug'
import { resolveWikiTarget } from '../lib/linkResolve'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import { createVaultContext } from '../composables/vault/context/createVaultContext'
import { provideVaultContext } from '../composables/vault/context/useVaultContext'
import { createVaultFileChanges } from '../composables/vault/context/fileChanges'
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
import EditorTabs from '../components/vault/EditorTabs.vue'
import type { WorkspaceTab } from '../components/vault/tabs'
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
const emptyActions = computed(() => [
  { label: 'Command palette', keys: shortcuts.format('mod+P') },
  { label: 'Toggle sidebar', keys: shortcuts.format('mod+B') },
])

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
const { t } = useI18n()

// Lives in VaultView (not the composable) so the string `ref="vaultRef"`
// template binding resolves cleanly. startDrag takes the host as a parameter.
const vaultRef = shallowRef<HTMLElement | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
function openSearch() { paletteRef.value?.show() }

/* ---------- Tabs / save / route sync ---------- */
const fileChanges = createVaultFileChanges()
const {
  tree, vaultId, posts, tabs, activePath, activeTab, isDirty, activeSize,
  refresh, openPost: openEditorPost, closeTab: closeEditorTab, closeMany: closeManyEditorTabs,
  selectTab: selectEditorTab, onEditorChange, doSaveNow, resolveExternal,
  onKeydown: onEditorKeydown, onCommandPaletteNew,
} = useEditorTabs({ selectPanel, toggleViewMode: () => viewModeApi?.toggle(), fileChanges })
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

function basename(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.endsWith('.md') ? name.slice(0, -3) : name
}

const workspaceTabs = computed<WorkspaceTab[]>(() => [
  ...tabs.value.map((tab) => ({
    id: tab.path,
    label: basename(tab.path),
    title: `${tab.title || tab.path}\n${tab.path}`,
    dirty: tab.saveStatus === 'dirty',
    kind: 'document' as const,
  })),
  ...historySnapshots.snapshots.value.map((snapshot) => ({
    id: snapshot.tabId,
    label: `${snapshot.documentTitle} (${t('history.snapshot_tab_suffix')})`,
    title: `${snapshot.documentTitle}\n${snapshot.documentPath}`,
    dirty: false,
    kind: 'history' as const,
  })),
  ...historyComparisons.comparisons.value.map((comparison) => ({
    id: comparison.tabId,
    label: `${comparison.documentTitle} (${t('history.diff_tab_suffix')})`,
    title: `${comparison.documentTitle}\n${comparison.documentPath}`,
    dirty: false,
    kind: 'diff' as const,
  })),
])
const activeWorkspaceTabId = computed(() => (
  activeHistoryComparison.value?.tabId ?? activeHistorySnapshot.value?.tabId ?? activePath.value
))

async function openPost(path: string): Promise<void> {
  historyComparisons.deactivate()
  historySnapshots.viewCurrent()
  await openEditorPost(path)
}

function selectWorkspaceTab(id: string): void {
  if (historyComparisons.comparisons.value.some((comparison) => comparison.tabId === id)) {
    historySnapshots.viewCurrent()
    historyComparisons.selectComparison(id)
  } else if (historySnapshots.snapshots.value.some((snapshot) => snapshot.tabId === id)) {
    historyComparisons.deactivate()
    historySnapshots.selectSnapshot(id)
  } else {
    historyComparisons.deactivate()
    historySnapshots.viewCurrent()
    selectEditorTab(id)
  }
}

function closeWorkspaceTab(id: string): void {
  if (historyComparisons.comparisons.value.some((comparison) => comparison.tabId === id)) {
    historyComparisons.closeComparison(id)
  } else if (historySnapshots.snapshots.value.some((snapshot) => snapshot.tabId === id)) {
    historySnapshots.closeSnapshot(id)
  } else {
    closeEditorTab(id)
  }
}

function closeManyWorkspaceTabs(ids: string[]): void {
  const historyIds = ids.filter((id) => id.startsWith('history:'))
  const comparisonIds = ids.filter((id) => id.startsWith('diff:'))
  historySnapshots.closeSnapshots(historyIds)
  historyComparisons.closeComparisons(comparisonIds)
  closeManyEditorTabs(ids.filter((id) => !id.startsWith('history:') && !id.startsWith('diff:')))
}

function onVaultKeydown(event: KeyboardEvent): void {
  const readOnlyTab = activeHistoryComparison.value ?? activeHistorySnapshot.value
  if (!readOnlyTab) {
    onEditorKeydown(event)
    return
  }

  const meta = event.metaKey || event.ctrlKey
  if (meta && event.key.toLowerCase() === 's') {
    event.preventDefault()
    return
  }
  if (meta && event.key.toLowerCase() === 'w') {
    event.preventDefault()
    if (activeHistoryComparison.value) historyComparisons.closeComparison(readOnlyTab.tabId)
    else historySnapshots.closeSnapshot(readOnlyTab.tabId)
    return
  }
  if (meta && event.key === 'Tab' && workspaceTabs.value.length > 0) {
    event.preventDefault()
    const current = workspaceTabs.value.findIndex((tab) => tab.id === activeWorkspaceTabId.value)
    const direction = event.shiftKey ? -1 : 1
    const next = (current + direction + workspaceTabs.value.length) % workspaceTabs.value.length
    const nextTab = workspaceTabs.value[next]
    if (nextTab) selectWorkspaceTab(nextTab.id)
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

function openHistoryRevision(selection: HistoryRevisionSelection): void {
  historyComparisons.deactivate()
  void historySnapshots.openRevision(selection)
}

async function viewCurrentDocument(path: string): Promise<void> {
  historyComparisons.deactivate()
  historySnapshots.viewCurrent()
  await openEditorPost(path)
}

function openHistoryComparison(snapshot: typeof activeHistorySnapshot.value): void {
  if (!snapshot || snapshot.status !== 'ready') return
  historySnapshots.viewCurrent()
  void historyComparisons.openComparison(snapshot)
}

function viewHistoricalComparison(comparison: HistoryComparison): void {
  historyComparisons.deactivate()
  historySnapshots.openCachedRevision({
    documentPath: comparison.documentPath,
    documentTitle: comparison.documentTitle,
    revisionId: comparison.revisionId,
    revisionTime: comparison.revisionTime,
    summary: comparison.summary,
  }, comparison.oldRaw)
}

const vaultContext = createVaultContext({ vaultId, fileChanges, tabs, activePath, activeTab, openPost })
provideVaultContext(vaultContext)
onBeforeUnmount(() => { vaultContext.dispose() })
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
    toast.error('无法创建：Wiki Link 必须使用英文 kebab-case 路径')
    return
  }
  const path = clean.startsWith('inbox/') ? clean : `inbox/${clean}`
  const title = segments.at(-1)!.split('-').join(' ')
  try {
    await createPost({ path, title })
    await refresh()
    await openPost(path)
    toast.success(`已创建: ${path}`)
  } catch (error: any) {
    if (error?.status === 409) await openPost(path)
    else toast.error(`创建失败: ${error?.message ?? '未知错误'}`)
  }
}

async function copyActiveContent() {
  const raw = activeHistoryComparison.value?.newRaw
    ?? activeHistorySnapshot.value?.rawMarkdown
    ?? activeTab.value?.raw
  if (raw === undefined) return
  try {
    await navigator.clipboard.writeText(raw)
    toast.success('已复制当前文档内容')
  } catch { toast.error('复制失败') }
}

async function showExternalDiff() {
  const tab = activeTab.value
  if (!tab) return
  await confirm(`本地版本：\n\n${tab.raw.slice(0, 1600)}\n\n────────\n磁盘版本：\n\n${(tab.externalRaw ?? '(文件已删除)').slice(0, 1600)}`)
}

/* ---------- Scope filter (NavBar chips) ---------- */
// useScopeFilter is application-shell state because NavBar lives above the
// router view. This call installs its localStorage watcher; NavBar reads
// `activeScope` / `toggleScope` from the same instance, and FileTree
// filters `topLevel` off the same `activeScope` ref.
useScopeFilter()

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
      :posts="posts"
      @open-revision="openHistoryRevision"
    />

    <div
      v-show="sidePanelOpen"
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整侧栏宽度"
      @pointerdown="startDrag(vaultRef!, 'tree', $event)"
    />

    <section
      class="editor-area"
      :class="{ 'is-read': isReadMode, 'is-empty': workspaceTabs.length === 0 }"
    >
      <EditorTabs
        v-if="workspaceTabs.length > 0"
        :tabs="workspaceTabs"
        :active-path="activeWorkspaceTabId"
        @select="selectWorkspaceTab"
        @close="closeWorkspaceTab"
        @close-many="closeManyWorkspaceTabs"
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
          <div v-if="activeTab.loading" class="empty">正在加载 {{ activeTab.path }}…</div>
          <div v-else-if="activeTab.loadError" class="empty error">{{ activeTab.loadError }}</div>
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
          <EmptyState title="No file open">
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
          <EmptyState title="No file open">
            <span v-for="a in emptyActions" :key="a.label" class="hint-row">
              <span class="hint-label">{{ a.label }}</span>
              <kbd class="hint-kbd">{{ a.keys }}</kbd>
            </span>
          </EmptyState>
        </div>
      </div>

      <div v-if="activeHistorySnapshot" class="content history-snapshot-content">
        <HistorySnapshotPane
          :snapshot="activeHistorySnapshot"
          :resolver="historyWikiResolver"
          @view-current="viewCurrentDocument"
          @open-diff="openHistoryComparison"
          @close="historySnapshots.closeSnapshot"
        />
      </div>

      <div v-if="activeHistoryComparison" class="content history-snapshot-content">
        <HistoryComparisonPane
          :comparison="activeHistoryComparison"
          @view-historical="viewHistoricalComparison"
          @view-current="viewCurrentDocument"
          @retry="historyComparisons.refreshComparison"
          @close="historyComparisons.closeComparison"
        />
      </div>
    </section>

    <div
      v-if="rightRailVisible"
      class="splitter splitter-toc"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整右侧栏宽度"
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
      :save-status="activeHistorySnapshot || activeHistoryComparison ? 'idle' : (activeTab?.saveStatus ?? 'idle')"
      :error="activeHistorySnapshot || activeHistoryComparison ? null : (activeTab?.error ?? null)"
      :size="activeHistoryComparison ? activeHistoryComparison.newRaw.length : (activeHistorySnapshot ? activeHistorySnapshot.rawMarkdown.length : activeSize)"
      :dirty="activeHistoryComparison ? activeHistoryComparison.currentDirty : (activeHistorySnapshot ? false : isDirty)"
      :focus-width="editorFocusWidth"
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
