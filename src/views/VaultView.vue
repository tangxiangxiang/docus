<script setup lang="ts">
import { ref, inject, shallowRef, watch, computed, provide, onMounted, onBeforeUnmount } from 'vue'
import { useVaultLayout, setSelectPanelForClicks } from '../composables/vault/useVaultLayout'
import { useSplitterDrag } from '../composables/vault/useSplitterDrag'
import { useSplitReview } from '../composables/vault/useSplitReview'
import { splitNote, type SplitMode } from '../lib/ai-api'
import { useToast } from '../composables/useToast'
import { useEditorTabs } from '../composables/vault/useEditorTabs'
import { useTagFilter } from '../composables/vault/useTagFilter'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { getLinkIndex, useLinkIndexSubscription } from '../composables/vault/useLinkIndex'
import { resolveWikiTarget } from '../lib/linkResolve'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import FileTree from '../components/vault/FileTree.vue'
import AiPanel from '../components/vault/AiPanel.vue'
import TagPanel from '../components/vault/TagPanel.vue'
import EditorPane from '../components/vault/EditorPane.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'
import ReadingPane from '../components/vault/ReadingPane.vue'
import KnowledgeGraph from '../components/vault/KnowledgeGraph.vue'
import TocPanel from '../components/vault/TocPanel.vue'
import ActivityBar from '../components/vault/ActivityBar.vue'
import EditorTabs from '../components/vault/EditorTabs.vue'
import StatusBar from '../components/vault/StatusBar.vue'
import CommandPalette from '../components/vault/CommandPalette.vue'

/* App.vue provides a global "open search" trigger so the NavBar button
   (which lives outside the router view) can ask the vault to open its
   CommandPalette. We watch the tick and call show() each time. */
const navSearch = inject<{ tick: ReturnType<typeof ref<number>>; trigger: () => void } | null>('openSearch', null)

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
const tocVisible = computed(() => tocPanelEnabled.value && !aiOpen.value)
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
      review.setError('没有识别出独立的原子想法')
      toast.info('没有识别出独立的原子想法')
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
  refresh, openPost, closeTab, selectTab, onEditorChange, onKeydown, onCommandPaletteNew,
} = useEditorTabs({ selectPanel })

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
      :class="{ 'is-read': isReadMode, 'ai-open': aiOpen, 'is-graph': activePanel === 'graph' }"
    >
      <EditorTabs
        v-if="activePanel !== 'graph'"
        :tabs="tabs"
        :active-path="activePath"
        @select="selectTab"
        @close="closeTab"
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

      <!-- Edit mode: editor + preview side-by-side, draggable mid-splitter. -->
      <div v-else-if="!isReadMode" class="content" :style="contentStyle">
        <div
          v-for="t in tabs"
          v-show="t.path === activePath"
          :key="t.path"
          class="editor-pane"
        >
          <div v-if="t.loading" class="empty">正在加载 {{ t.path }}…</div>
          <div v-else-if="t.loadError" class="empty error">{{ t.loadError }}</div>
          <EditorPane
            v-else
            :model-value="t.raw"
            @update:model-value="(val: string) => onEditorChange(t.path, val)"
          />
        </div>
        <div v-if="!tabs.length" class="content-empty">
          <div class="empty-card">
            <div class="empty-title">No file open</div>
            <div class="empty-hint">
              <!-- Each hint item is one flex item so the kbd and its
                   label stay together when the row wraps. -->
              <span class="hint-item"><kbd>⌘P</kbd> command palette</span>
              <span class="dot" aria-hidden="true">·</span>
              <span class="hint-item"><kbd>⌘B</kbd> toggle sidebar</span>
            </div>
          </div>
        </div>

        <div
          v-if="tabs.length"
          class="splitter splitter-mid"
          role="separator"
          aria-orientation="vertical"
          title="拖动调整编辑器 / 预览"
          @pointerdown="startDrag(vaultRef!, 'middle', $event)"
        />

        <div
          v-for="t in tabs"
          v-show="t.path === activePath"
          :key="`p-${t.path}`"
          class="preview-pane"
        >
          <PreviewPane v-if="!t.loading && !t.loadError" :raw="t.raw" :resolver="wikiResolver" />
        </div>
      </div>

      <!-- Read mode: single reading surface in the same slot. The side
           panel, tabs, and status bar above/below stay untouched so
           navigation still works while reading. -->
      <div v-else class="content reading-content">
        <div
          v-for="t in tabs"
          v-show="t.path === activePath"
          :key="`r-${t.path}`"
          class="reading-slot"
        >
          <ReadingPane :raw="t.raw" :resolver="wikiResolver" />
        </div>
        <div v-if="!tabs.length" class="content-empty">
          <div class="empty-card">
            <div class="empty-title">No file open</div>
            <div class="empty-hint">
              <!-- Each hint item is one flex item so the kbd and its
                   label stay together when the row wraps. -->
              <span class="hint-item"><kbd>⌘P</kbd> command palette</span>
              <span class="dot" aria-hidden="true">·</span>
              <span class="hint-item"><kbd>⌘B</kbd> toggle sidebar</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="tocVisible"
      class="splitter splitter-toc"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整目录宽度"
      @pointerdown="startDrag(vaultRef!, 'toc', $event)"
    />
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
      @close="toggleAi"
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
