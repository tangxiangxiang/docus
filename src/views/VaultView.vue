<script setup lang="ts">
import { ref, inject, shallowRef, watch, computed } from 'vue'
import { useVaultLayout } from '../composables/vault/useVaultLayout'
import { useEditorTabs } from '../composables/vault/useEditorTabs'
import { useTagFilter } from '../composables/vault/useTagFilter'
import { useScopeFilter } from '../composables/vault/useScopeFilter'
import { VaultViewModeKey } from '../composables/vault/viewMode'
import FileTree from '../components/vault/FileTree.vue'
import AiPanel from '../components/vault/AiPanel.vue'
import TagPanel from '../components/vault/TagPanel.vue'
import EditorPane from '../components/vault/EditorPane.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'
import ReadingPane from '../components/vault/ReadingPane.vue'
import ActivityBar from '../components/vault/ActivityBar.vue'
import EditorTabs from '../components/vault/EditorTabs.vue'
import Breadcrumb from '../components/vault/Breadcrumb.vue'
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

/* ---------- Layout ---------- */
const {
  activePanel,
  vaultStyle,
  contentStyle,
  selectPanel,
  toggleAi,
  aiOpen,
  startDrag,
} = useVaultLayout()

// Lives in VaultView (not the composable) so the string `ref="vaultRef"`
// template binding resolves cleanly. startDrag takes the host as a parameter.
const vaultRef = shallowRef<HTMLElement | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
function openSearch() { paletteRef.value?.show() }

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
const { activeTagList, toggleTag, clear: clearTagFilter, removeTag } = useTagFilter({ activePanel })

watch(() => navSearch?.tick.value, () => openSearch())

/* The mode toggle only swaps the editor/preview split for a single
   reading surface — the side panel, activity bar, tabs, breadcrumb,
   and status bar all stay put so the user can still navigate while
   reading. So the vault's grid layout is the same in both modes. */
</script>

<template>
  <div
    ref="vaultRef"
    class="vault"
    :class="{ 'is-read': isReadMode }"
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
      @clear-tag-filter="clearTagFilter"
      @remove-tag="removeTag"
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
      v-show="activePanel"
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      title="拖动调整侧栏宽度"
      @pointerdown="startDrag(vaultRef!, 'tree', $event)"
    />

    <section class="editor-area">
      <EditorTabs
        :tabs="tabs"
        :active-path="activePath"
        @select="selectTab"
        @close="closeTab"
      />
      <Breadcrumb :current-path="activePath" />

      <!-- Edit mode: editor + preview side-by-side, draggable mid-splitter. -->
      <div v-if="!isReadMode" class="content" :style="contentStyle">
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
          <PreviewPane v-if="!t.loading && !t.loadError" :raw="t.raw" />
        </div>
      </div>

      <!-- Read mode: single reading surface in the same slot. The side
           panel, tabs, breadcrumb, and status bar above/below stay
           untouched so navigation still works while reading. -->
      <div v-else class="content reading-content">
        <div
          v-for="t in tabs"
          v-show="t.path === activePath"
          :key="`r-${t.path}`"
          class="reading-slot"
        >
          <ReadingPane :raw="t.raw" />
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
