<script setup lang="ts">
// Unified document sidebar. Lightweight tabs switch one shared content
// region between the TOC, bi-directional links, and AI assistant.
//
// Components:
//   - The TOC list comes from ReadingPane via the module-level
//     useTocState (ReadingPane owns the IntersectionObserver scroll-
//     spy, TocPanel only renders the active-highlighted list).
//   - The Links panel is a full embed of <LinksPanel>. It needs
//     `path` and `posts` props, which VaultView passes through.
//     We forward `navigate` to VaultView as `link-navigate` so the
//     parent can route through openPost.

import { computed } from 'vue'
import { tocHeadings, tocActiveId, tocScrollTo } from '../../composables/vault/useTocState'
import type { PostSummary } from '../../lib/api'
import LinksPanel from './LinksPanel.vue'
import AiPanel from './AiPanel.vue'
import type { RightRailTab } from '../../composables/vault/useVaultLayout'

const props = defineProps<{
  /** Active note path. Forwarded to <LinksPanel>. */
  path: string | null
  /** All posts (title resolution for link rows). Forwarded to <LinksPanel>. */
  posts: PostSummary[]
  activeTab: RightRailTab
}>()

const emit = defineEmits<{
  /** Emitted when the user clicks a row in the Links panel. */
  'link-navigate': [path: string]
  'update:activeTab': [tab: RightRailTab]
}>()

const hasHeadings = computed(() => tocHeadings.value.length > 0)

function onTocClick(id: string) {
  tocScrollTo.value?.(id)
}

function onLinkNavigate(p: string) {
  emit('link-navigate', p)
}
</script>

<template>
  <div class="right-rail">
    <nav class="sidebar-tabs" role="tablist" aria-label="文档导航">
      <button role="tab" :aria-selected="activeTab === 'ai'" :class="{ active: activeTab === 'ai' }" @click="emit('update:activeTab', 'ai')">AI</button>
      <button role="tab" :aria-selected="activeTab === 'toc'" :class="{ active: activeTab === 'toc' }" @click="emit('update:activeTab', 'toc')">目录</button>
      <button role="tab" :aria-selected="activeTab === 'links'" :class="{ active: activeTab === 'links' }" @click="emit('update:activeTab', 'links')">引用</button>
    </nav>

    <section v-show="activeTab === 'toc'" class="toc-panel" role="tabpanel" aria-label="目录">

      <div v-if="!hasHeadings" class="toc-panel-empty">
        暂无目录
      </div>
      <ul v-else class="toc-panel-list">
        <li
          v-for="h in tocHeadings"
          :key="h.id"
          :class="['toc-panel-item', `lvl-${h.level}`, { active: tocActiveId === h.id }]"
        >
          <a
            class="toc-panel-link"
            :href="`#${h.id}`"
            :title="h.text"
            @click.prevent="onTocClick(h.id)"
          >
            <span class="toc-panel-link-text">{{ h.text }}</span>
          </a>
        </li>
      </ul>
    </section>

    <section v-show="activeTab === 'links'" class="links-slot" role="tabpanel" aria-label="引用关系">
      <LinksPanel
        :path="path"
        :posts="posts"
        @navigate="onLinkNavigate"
      />
    </section>
    <section v-show="activeTab === 'ai'" class="ai-slot" role="tabpanel" aria-label="AI">
      <AiPanel />
    </section>
  </div>
</template>

<style scoped>
.right-rail {
  height: 100%;
  min-height: 0;
  background: var(--vs-side-bg, var(--vs-bg-1));
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
}

.sidebar-tabs {
  display: flex;
  align-items: stretch;
  gap: 20px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 22px;
  border-bottom: 1px solid color-mix(in srgb, var(--vs-border, var(--border)) 42%, transparent);
}
.sidebar-tabs button {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--vs-text-3, var(--text-muted));
  font: inherit;
  font-size: 0.76rem;
  cursor: pointer;
}
.sidebar-tabs button:hover { color: var(--vs-text-1, var(--text)); }
.sidebar-tabs button.active { color: var(--vs-text-1, var(--text)); font-weight: 600; }
.sidebar-tabs button.active::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 2px;
  background: var(--vs-accent, var(--accent));
}

.toc-panel,
.links-slot { display: block; padding-top: 14px; padding-bottom: 24px; }
.ai-slot { height: calc(100% - 36px); min-height: 0; }
.ai-slot :deep(.ai-panel) { height: 100%; }
.toc-panel-empty {
  padding: 0 22px;
  font-size: 0.78rem;
  color: var(--vs-text-2, var(--text-muted));
  font-style: italic;
}

.toc-panel-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.toc-panel-item {
  position: relative;
  margin: 0;
  overflow: hidden;
}

/* Row uses the same vertical rhythm as a .link-entry (6px/12px
   padding, 0.88rem font-size, 1.4 line-height) so the two halves
   have matching row heights. The heading text fills the available
   width and is truncated with ellipsis on overflow. H3/H4 indents
   (8px per level on top of the 16px baseline) provide the hierarchy
   cue without a separate badge. */
.toc-panel-link {
  display: block;
  width: calc(100% - 28px);
  margin: 0 14px;
  /* min-width: 0 lets this flex item shrink below its intrinsic
     content width when the column is narrow. */
  min-width: 0;
  padding: 5px 10px;
  font-size: 0.8rem;
  line-height: 1.35;
  color: var(--vs-text-2, var(--text-muted));
  text-decoration: none;
  border-left: 2px solid transparent;
  /* Animate the accent border too — without it, scroll-spy jumps
     snap the bar in place while the row's text fades in, which
     reads as a tiny flicker on slow section transitions. */
  transition: background 0.12s ease, color 0.12s ease, border-left-color 0.18s ease;
}

.toc-panel-link-text {
  display: block;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc-panel-link:hover {
  color: var(--vs-text-1, var(--text));
}

.toc-panel-item.active .toc-panel-link {
  color: var(--vs-text-1, var(--text));
  font-weight: 600;
}

/* Active row gets the same accent left border that the .section
   focus state uses in LinksPanel. Drawn on the <a> so the indent
   for h3/h4 composes with the 2px bar. */
.toc-panel-item.active .toc-panel-link {
  border-left-color: var(--vs-accent, var(--accent));
}

/* H3 / H4 indents: 16px baseline + 8px per level. */
.toc-panel-item.lvl-1 .toc-panel-link,
.toc-panel-item.lvl-2 .toc-panel-link { padding-left: 10px; }
.toc-panel-item.lvl-3 .toc-panel-link { padding-left: 20px; }
.toc-panel-item.lvl-4 .toc-panel-link,
.toc-panel-item.lvl-5 .toc-panel-link,
.toc-panel-item.lvl-6 .toc-panel-link { padding-left: 30px; }

/* LinksPanel renders its own <aside class="links-panel">. We strip
   the right border (the .right-rail already provides the column
   boundary) and make the panel fill the slot — LinksPanel's own
   styles set height: 100%. */
.links-slot :deep(.links-panel) {
  border-right: 0;
  height: auto;
}
</style>
