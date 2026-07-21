<script setup lang="ts">
// Unified document sidebar. Lightweight tabs switch one shared content
// region between the TOC, bi-directional links, and AI assistant.
//
// Components:
//   - The TOC list comes from ReadingPane via Vault-scoped useTocState
//     (ReadingPane owns the IntersectionObserver scroll-
//     spy, TocPanel only renders the active-highlighted list).
//   - The Links panel is a full embed of <LinksPanel>. It needs
//     `path` and `posts` props, which VaultView passes through.
//     We forward `navigate` to VaultView as `link-navigate` so the
//     parent can route through openPost.

import { computed } from 'vue'
import { useVaultTocState } from '../../composables/vault/useTocState'
import { useI18n } from '../../composables/useI18n'
import type { PostSummary } from '../../lib/api'
import LinksPanel from './LinksPanel.vue'
import AiPanel from './AiPanel.vue'
import type { RightRailTab } from '../../composables/vault/useVaultLayout'

const { tocHeadings, tocActiveId, tocScrollTo } = useVaultTocState()
const { t } = useI18n()

const props = defineProps<{
  /** Active note path. Forwarded to <LinksPanel>. */
  path: string | null
  /** All posts (title resolution for link rows). Forwarded to <LinksPanel>. */
  posts: PostSummary[]
  activeTab: RightRailTab
  /**
   * Kept for VaultView compatibility, no longer gating anything:
   * Edit-10.3 lifted the read-only AI gate so History/Diff/Recovery
   * views can send their own live context.
   */
  historyReadOnly?: boolean
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
    <nav class="sidebar-tabs" role="tablist" :aria-label="t('rail.navigation')">
      <!-- Edit-10.3: the old "no AI in read-only views" gate is lifted —
           History/Diff/Recovery views now transport their own live
           context (readOnly snapshots) instead of being cut off. -->
      <button
        role="tab"
        :aria-selected="activeTab === 'ai'"
        :class="{ active: activeTab === 'ai' }"
        @click="emit('update:activeTab', 'ai')"
      >{{ t('rail.ai') }}</button>
      <button role="tab" :aria-selected="activeTab === 'toc'" :class="{ active: activeTab === 'toc' }" @click="emit('update:activeTab', 'toc')">{{ t('rail.toc') }}</button>
      <button role="tab" :aria-selected="activeTab === 'links'" :class="{ active: activeTab === 'links' }" @click="emit('update:activeTab', 'links')">{{ t('rail.links') }}</button>
    </nav>

    <section v-show="activeTab === 'toc'" class="toc-panel" role="tabpanel" :aria-label="t('rail.toc')">

      <div v-if="!hasHeadings" class="toc-panel-empty">
        {{ t('rail.toc_empty') }}
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

    <section v-show="activeTab === 'links'" class="links-slot" role="tabpanel" :aria-label="t('rail.links_panel')">
      <LinksPanel
        :path="path"
        :posts="posts"
        @navigate="onLinkNavigate"
      />
    </section>
    <section v-show="activeTab === 'ai'" class="ai-slot" role="tabpanel" :aria-label="t('rail.ai')">
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

/* Right-rail tab nav. Modeled on Figma / Linear / Notion / Cursor
   right-side panel headers: text-only, no per-tab cards or vertical
   dividers, a single thin strip with a short accent line under the
   active label.

   - The active indicator is `border-bottom` on the button itself.
     Because the button is `inline-flex` with `padding: 0`, its width
     collapses to the label width, so the 2px accent reads as an
     underline under just the active text — not a full-width tab bar.
   - The transparent default border reserves the same 2px on inactive
     tabs so the label never shifts when a tab becomes active.
   - `box-sizing: border-box` keeps the reserved 2px inside the 36px
     row height instead of pushing the button past it. */
.sidebar-tabs {
  display: flex;
  align-items: stretch;
  gap: 20px;
  height: 36px;
  box-sizing: border-box;
  padding: 0 14px;
  border-bottom: 1px solid var(--vs-border, var(--border));
}
.sidebar-tabs button {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  box-sizing: border-box;
  background: transparent;
  color: var(--vs-text-3, var(--text-muted));
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.sidebar-tabs button:hover { color: var(--vs-text-1, var(--text)); }
.sidebar-tabs button:disabled { cursor: not-allowed; opacity: 0.45; }
.sidebar-tabs button.active {
  color: var(--vs-text-1, var(--text));
  font-weight: 600;
  border-bottom-color: var(--vs-accent, var(--accent));
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
   cue without a separate badge.

   Active state is communicated by text weight + a light row
   background, modeled on Cursor / VS Code Outline rather than the
   file-tree's accent-bar style — a TOC is a reading aid, not a
   navigation tree. */
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
  border-radius: 5px;
  transition: background 0.12s ease, color 0.12s ease;
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
  background: var(--vs-hover-bg, var(--bg-soft));
}

.toc-panel-item.active .toc-panel-link {
  color: var(--vs-text-1, var(--text));
  font-weight: 600;
  background: var(--vs-hover-bg, var(--bg-soft));
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
