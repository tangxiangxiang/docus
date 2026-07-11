<script setup lang="ts">
import { ref, inject, shallowRef, watch, computed, provide, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { useStorage } from '@vueuse/core'
import { useShortcutDisplay } from '../composables/useShortcutDisplay'
import { useVaultLayout, setSelectPanelForClicks } from '../composables/vault/useVaultLayout'
import { useSplitterDrag } from '../composables/vault/useSplitterDrag'
import { useEditorPreviewScrollSync } from '../composables/vault/useEditorPreviewScrollSync'
import { useSplitReview } from '../composables/vault/useSplitReview'
import { splitNote, type SplitMode } from '../lib/ai-api'
import { useToast } from '../composables/useToast'
import { useEditorTabs } from '../composables/vault/useEditorTabs'
import { useTagFilter } from '../composables/vault/useTagFilter'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { getLinkIndex, refreshLinkIndex, useLinkIndexSubscription } from '../composables/vault/useLinkIndex'
import { createPost, type DocumentMetadata } from '../lib/api'
import { isSlugSegment } from '../lib/slug'
import { resolveWikiTarget } from '../lib/linkResolve'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import FileTree from '../components/vault/FileTree.vue'
import AiPanel from '../components/vault/AiPanel.vue'
import TagPanel from '../components/vault/TagPanel.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'
import ReadingPane from '../components/vault/ReadingPane.vue'
import KnowledgeGraph from '../components/vault/KnowledgeGraph.vue'
import TocPanel from '../components/vault/TocPanel.vue'
import EmptyState from '../components/vault/EmptyState.vue'
import ActivityBar from '../components/vault/ActivityBar.vue'
import SettingsModal from '../components/vault/SettingsModal.vue'
import DocumentMetadataModal from '../components/vault/DocumentMetadataModal.vue'
import HistoryPanel from '../components/vault/HistoryPanel.vue'
import DiffView from '../components/vault/DiffView.vue'
import EditorTabs from '../components/vault/EditorTabs.vue'
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

/* ---------- Layout ----------
   tocGate is declared first as `let` so useVaultLayout can close over
   it via a getter. The actual function body reads `isReadMode` and
   `activePanel`, both of which are declared further down — but the
   closure body is lazy: vaultStyle only invokes tocGate() when it
   first reads its computed (after setup has finished), so the late
   bindings are live by then. The `?? true` fallback covers the brief
   window before the real gate is wired in below. */
let tocGate: () => boolean = () => true

const {
  activePanel,
  sidePanelOpen,
  sidePanelWidth,
  editorRatio,
  aiPanelWidth,
  vaultStyle,
  contentStyle,
  selectPanel,
  toggleAi,
  aiOpen,
  tocPanelWidth,
  previewOpen,
  togglePreview,
  rightRailCollapsed,
  toggleRightRail,
} = useVaultLayout({ tocGate: () => tocGate() })

/* Splitter drag lives in its own composable — it mutates the same
   width/ratio refs useVaultLayout returns, so the grid updates
   synchronously as the user drags. */
const { startDrag } = useSplitterDrag({
  sidePanelWidth,
  editorRatio,
  aiPanelWidth,
  tocPanelWidth,
})

/* Right-rail visibility: the rail is a read-mode affordance and
   shows whenever the user is in read mode AND the AI panel is closed
   AND we're not in graph mode. Graph mode replaces the editor area
   entirely (force-graph canvas takes the full body), so the rail
   must hide — otherwise an empty 320px column would sit on the right
   of the graph. The rail hosts both the TOC (which has its own
   hasHeadings gate inside TocPanel) and the Links panel — a document
   with links but no headings still gets the rail with just the Links
   half populated. The same gate drives the grid track (via tocGate)
   and the v-if (via tocVisible) so they stay in lockstep. */
const tocPanelEnabled = computed(
  () => isReadMode.value && activePanel.value !== 'graph',
)
const tocVisible = computed(
  () => tocPanelEnabled.value && !aiOpen.value && !rightRailCollapsed.value,
)
/* The splitter is a grid child only when the rail is visible. In the
   collapsed state the chevron affordance is rendered as an absolutely-
   positioned button pinned to the vault's right edge (see template
   below) — putting it in the grid would either force an extra column
   (creating a 1px gray strip where the rail used to be) or, with the
   default grid-auto-flow: row, wrap the splitter to row 2 (status
   bar), which is what produced the gray area the user reported. */
tocGate = () => tocPanelEnabled.value

const review = useSplitReview()
// Provide the same instance to AiPanel so the tree-menu path
// (this function) and the /split slash command (handled in
// AiPanel) share state — the panel re-renders when we mutate.
provide('splitReview', review)
const toast = useToast()

// Lives in VaultView (not the composable) so the string `ref="vaultRef"`
// template binding resolves cleanly. startDrag takes the host as a parameter.
const vaultRef = shallowRef<HTMLElement | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
type EditorScrollApi = { setScrollFraction: (fraction: number) => void }
const editorRefs = new Map<string, EditorScrollApi>()
function registerEditorScroll(registration: { path: string; setScrollFraction: (fraction: number) => void }) {
  editorRefs.set(registration.path, { setScrollFraction: registration.setScrollFraction })
}
function unregisterEditorScroll(path: string) {
  editorRefs.delete(path)
}
function openSearch() { paletteRef.value?.show() }

/* Publish our selectPanel to children that need to close the graph
   panel from inside the editor area (KnowledgeGraph's node-click
   handler). VaultView is the one and only owner of the layout
   state, so this is the right place to register. */
onMounted(() => {
  setSelectPanelForClicks(selectPanel)
})
onBeforeUnmount(() => {
  setSelectPanelForClicks(null)
})

async function splitCard(path: string, mode: SplitMode) {
  review.setLoading(path, mode)
  // Make sure the AI panel is visible — the user might have
  // dismissed it. VaultView's aiOpen lives in useVaultLayout.
  if (!aiOpen.value) toggleAi()
  try {
    const { cards } = await splitNote({ path, mode })
    if (cards.length === 0) {
      review.setError('没有生成可用的卡片草稿')
      toast.info('没有生成可用的卡片草稿')
      return
    }
    review.setReview(mode, cards)
  } catch (err: any) {
    review.setError(err.message ?? '拆分失败')
    toast.error('拆分失败: ' + (err.message ?? '未知错误'))
  }
}

/* ---------- Tabs / save / route sync ---------- */
const {
  tree, posts, tabs, activePath, activeTab, isDirty, activeSize,
  refresh, openPost, closeTab, closeMany, selectTab, onEditorChange, doSaveNow, onKeydown, onCommandPaletteNew,
} = useEditorTabs({ selectPanel, togglePreview })
const editorLinkTargets = computed(() => posts.value.map((post) => ({ path: post.path, title: post.title })))

async function onMetadataSaved(metadata: DocumentMetadata) {
  const tab = tabs.value.find((item) => item.path === metadata.path)
  if (tab) tab.title = metadata.title
  metadataOpen.value = false
  await Promise.all([refresh(), refreshLinkIndex()])
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

watch(activePath, () => { metadataOpen.value = false })

/* Mirror the editor's scroll position onto the preview pane (and
   vice versa) so the two stay aligned as the user scrolls in edit
   mode. Read-only at the VaultView level — the composable finds the
   right scroll containers inside the vault root via data-path
   selectors. Wired after useEditorTabs because we need activePath. */
const editorPreviewScroll = useEditorPreviewScrollSync({
  vaultRoot: vaultRef,
  activePath,
  setEditorScrollFraction: (path, fraction) => editorRefs.get(path)?.setScrollFraction(fraction),
})

/* ---------- Scope filter (NavBar chips) ---------- */
// useScopeFilter is called here so the singleton state is wired up
// (the localStorage watcher installs on first call). NavBar reads
// `activeScope` / `toggleScope` from the same instance, and FileTree
// filters `topLevel` off the same `activeScope` ref.
useScopeFilter()

/* ---------- Tag filter ---------- */
const { activeTagList, toggleTag, removeTag } = useTagFilter({ activePanel })

/* ---------- Bi-directional links ---------- */
// Mount the file-change-bus subscription so the link index stays
// fresh as the user (or AI) edits. The initial fetch is triggered
// by useLinkIndexSubscription's onMounted.
useLinkIndexSubscription()

// Wiki-link resolver: reads the *current* link index from
// `useLinkIndex()` so updates flow through (the module-level
// activeResolver in markdown.ts is set to a closure over this
// ref on every render). We pass the resolver through a getter
// function so the panes always see the latest index without
// having to re-mount.
const linkIndex = getLinkIndex()
const wikiResolver = (ref: string, _anchor?: string) => {
  const allPaths = Array.from(linkIndex.value.paths)
  return {
    target: resolveWikiTarget(ref, activePath.value ?? '', allPaths),
    alias: ref,
  }
}

watch(() => navSearch?.tick.value, () => openSearch())

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
    :class="{ 'is-read': isReadMode, 'ai-open': aiOpen, 'toc-open': tocVisible }"
    tabindex="0"
    :style="vaultStyle"
    @keydown="onKeydown"
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
      :path="activePath"
      @close="metadataOpen = false"
      @saved="onMetadataSaved"
    />

    <FileTree
      v-if="activePanel === 'files'"
      :tree="tree"
      :posts="posts"
      :active-tags="activeTagList"
      :current-path="activePath"
      @select="openPost"
      @refresh="refresh"
      @remove-tag="removeTag"
      @split-card="splitCard"
    />
    <TagPanel
      v-else-if="activePanel === 'tags'"
      :posts="posts"
      :active-tags="activeTagList"
      :path="activePath"
      @select="toggleTag"
      @open="openPost"
    />
    <!-- History panel: side-panel host for the commit composer +
         changes list + commit timeline. The activity-bar button
         toggles `activePanel === 'history'`. The main editor area
         separately renders <DiffView> in the same mode (see below
         — same `activePanel === 'history'` gate) so the diff sits
         in the editor's grid track instead of fighting for the
         side-panel column. -->
    <HistoryPanel v-else-if="activePanel === 'history'" :current-path="activePath" />

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
      :class="{ 'is-read': isReadMode, 'ai-open': aiOpen, 'is-graph': activePanel === 'graph', 'is-history': activePanel === 'history', 'is-empty': tabs.length === 0 }"
    >
      <EditorTabs
        v-if="activePanel !== 'graph' && activePanel !== 'history' && tabs.length > 0"
        :tabs="tabs"
        :active-path="activePath"
        @select="selectTab"
        @close="closeTab"
        @close-many="closeMany"
      />

      <!-- Graph mode: replaces the entire edit / read surface with
           the knowledge-graph canvas. The EditorTabs row is also
           hidden (see the v-if above + the .editor-area.is-graph
           grid override in style.css) so the canvas gets the full
           editor height. ActivityBar, side panel, AI panel, and
           StatusBar stay put — the user keeps navigation context
           for everything except the per-tab switcher. The graph
           component reads from the link index singleton and
           dispatches node clicks through the same openPost
           singleton the wiki-link renderer uses. Checked first so
           the read/edit branches below stay the unchanged original. -->
      <div v-if="activePanel === 'graph'" class="content content-graph">
        <KnowledgeGraph />
      </div>

      <!-- History mode: side panel shows the HistoryPanel, this
           main area shows the DiffView. EditorTabs is hidden so
           the diff gets the full editor height. The side panel
           drives what the diff renders via useHistory.selectFile. -->
      <div v-else-if="activePanel === 'history'" class="content content-diff">
        <DiffView />
      </div>

      <!-- Edit mode: editor + preview side-by-side, draggable mid-splitter. -->
      <div v-else-if="!isReadMode" class="content" :style="contentStyle">
        <div
          v-if="activeTab"
          :key="activeTab.path"
          class="editor-pane"
          :data-path="activeTab.path"
        >
          <div v-if="activeTab.loading" class="empty">正在加载 {{ activeTab.path }}…</div>
          <div v-else-if="activeTab.loadError" class="empty error">{{ activeTab.loadError }}</div>
          <EditorPane
            v-else
            :model-value="activeTab.raw"
            :path="activeTab.path"
            :focus-width="editorFocusWidth"
            :link-targets="editorLinkTargets"
            @update:model-value="(val: string) => onEditorChange(activePath!, val)"
            @open-link="openPost"
            @create-link="createMissingWikiNote"
            @register-scroll="registerEditorScroll"
            @unregister-scroll="unregisterEditorScroll"
            @scroll-change="(fraction: number) => editorPreviewScroll.syncPreviewFromEditor(activePath!, fraction)"
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

        <div
          v-if="tabs.length && previewOpen"
          class="splitter splitter-mid"
          role="separator"
          aria-orientation="vertical"
          title="拖动调整编辑器 / 预览"
          @pointerdown="startDrag(vaultRef!, 'middle', $event)"
        />

        <template v-if="previewOpen && activeTab">
          <div
            :key="`p-${activeTab.path}`"
            class="preview-pane"
            :data-path="activeTab.path"
          >
            <PreviewPane v-if="!activeTab.loading && !activeTab.loadError" :raw="activeTab.raw" :resolver="wikiResolver" />
          </div>
        </template>
      </div>

      <!-- Read mode: single reading surface in the same slot. The side
           panel, tabs, and status bar above/below stay untouched so
           navigation still works while reading. -->
      <div v-else class="content reading-content">
        <!-- Only the active tab is mounted. Mounting one ReadingPane
             per tab (v-for + v-show) would have every instance write
             to the same module-level tocHeadings / tocActiveId, and
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
    </section>

    <div
      v-if="tocVisible"
      class="splitter splitter-toc"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整宽度 · 双击折叠右侧栏"
      @pointerdown="startDrag(vaultRef!, 'toc', $event)"
      @dblclick="toggleRightRail"
    >
      <button
        type="button"
        class="splitter-chevron"
        aria-label="折叠右侧栏"
        title="折叠右侧栏"
        @click.stop="toggleRightRail"
      >‹</button>
    </div>
    <!-- In collapsed mode the splitter is gone from the grid (see
         tocVisible above) — it's replaced by an absolutely-positioned
         chevron pinned to the vault's right edge. Putting it in the
         grid would either create an extra column or wrap the splitter
         into the status-bar row, both of which produce visual
         artifacts. Hidden while AI is open (the AI panel covers the
         right edge; clicking the rail chevron there would replace
         the AI panel, which is surprising). The collapsed state
         persists, so when AI closes the chevron returns. -->
    <button
      v-if="rightRailCollapsed && tocPanelEnabled && !aiOpen"
      type="button"
      class="rail-expand-edge"
      aria-label="展开右侧栏"
      title="展开右侧栏"
      @click="toggleRightRail"
    >›</button>
    <TocPanel
      v-if="tocVisible"
      class="toc-panel-slot"
      :path="activePath"
      :posts="posts"
      @link-navigate="openPost"
    />

    <div
      v-if="aiOpen"
      class="splitter splitter-ai"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整 AI 面板宽度"
      @pointerdown="startDrag(vaultRef!, 'ai', $event)"
    />
    <AiPanel
      v-if="aiOpen"
      class="ai-panel-slot"
      :posts="posts"
      @close="toggleAi"
      @open="openPost"
      @split-request="splitCard"
      @refresh-tree="refresh"
    />

    <StatusBar
      class="status-bar-row"
      :path="activePath"
      :save-status="activeTab?.saveStatus ?? 'idle'"
      :error="activeTab?.error ?? null"
      :size="activeSize"
      :dirty="isDirty"
      :focus-width="editorFocusWidth"
      @toggle-focus-width="editorFocusWidth = !editorFocusWidth"
      @open-metadata="metadataOpen = true"
      @retry-save="doSaveNow"
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
