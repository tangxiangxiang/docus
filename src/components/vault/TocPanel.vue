<script setup lang="ts">
// Right-rail read-mode panel: stacked vertically with the page TOC
// on top and the bi-directional Links panel below, sharing the
// column's height 50/50. Renders whenever the vault is in read mode
// (the rail itself is read-mode's auxiliary surface; individual
// halves decide whether they have content to show). A document with
// no headings but with links still gets the rail — the TOC half
// shows an empty-state placeholder, the Links half is populated.
//
// Stylistically the two halves read as a single visual family: same
// background token (var(--vs-side-bg)), same header rhythm (icon +
// title row, uppercase tracked, 8px/12px padding, 1px border-bottom),
// same row hover treatment. The TOC keeps one piece of its own
// chrome — the active heading's left-edge accent bar — because the
// scroll-spy highlight is the whole point of the TOC; the Links panel
// has no such per-item active state.
//
// The two halves use `flex: 1 1 0; min-height: 0` so they split the
// column height equally; a 1px divider between them is rendered as
// `border-top` on the Links half so it tracks the column resize.
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
import { ICON_TOC } from './icons'
import type { PostSummary } from '../../lib/api'
import LinksPanel from './LinksPanel.vue'

const props = defineProps<{
  /** Active note path. Forwarded to <LinksPanel>. */
  path: string | null
  /** All posts (title resolution for link rows). Forwarded to <LinksPanel>. */
  posts: PostSummary[]
}>()

const emit = defineEmits<{
  /** Emitted when the user clicks a row in the Links panel. */
  'link-navigate': [path: string]
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
    <section class="toc-panel" aria-label="Page navigation">
      <header class="toc-panel-header">
        <div class="toc-panel-title" role="presentation">
          <span class="toc-panel-icon" aria-hidden="true" v-html="ICON_TOC" />
          <span class="toc-panel-title-text">Page Navigation</span>
        </div>
      </header>

      <div v-if="!hasHeadings" class="toc-panel-empty">
        No headings
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
            <span class="toc-panel-link-level" aria-hidden="true">H{{ h.level }}</span>
            <span class="toc-panel-link-text">{{ h.text }}</span>
          </a>
        </li>
      </ul>
    </section>

    <section class="links-slot" aria-label="Links">
      <LinksPanel
        :path="path"
        :posts="posts"
        @navigate="onLinkNavigate"
      />
    </section>
  </div>
</template>

<style scoped>
/* The two halves are visually twins: same column background, same
   header rhythm. flex-basis: 0 + flex-grow: 1 forces an even 50/50
   split regardless of intrinsic content height. The min-height: 0
   is the standard flex-overflow escape hatch — without it the list
   inside grows past its allotted slice and the second half gets
   pushed out of the column. */
.right-rail {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--vs-side-bg, var(--bg-soft));
  overflow: hidden;
}

.toc-panel,
.links-slot {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 1px divider between the two halves. Sits on the Links side so the
   top half's bottom border doesn't double up against it. */
.links-slot {
  border-top: 1px solid var(--vs-border, var(--border));
}

/* ----- TOC half: matches LinksPanel's header + row rhythm -----
   Header mirrors the .links-panel > header layout: icon + title row,
   8px/12px padding, 1px border-bottom, uppercase tracked text. */
.toc-panel-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vs-border, var(--border));
  flex-shrink: 0;
}

.toc-panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vs-text-2, var(--text-muted));
  font-size: 0.78rem;
}

.toc-panel-icon {
  display: inline-flex;
  color: var(--vs-text-2, var(--text-muted));
}

.toc-panel-title-text { color: var(--vs-text-1, var(--text)); }

.toc-panel-empty {
  padding: 18px 14px;
  font-size: 0.88rem;
  color: var(--vs-text-2, var(--text-muted));
  font-style: italic;
}

.toc-panel-list {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 4px 0;
  scrollbar-width: thin;
  min-height: 0;
}

.toc-panel-item {
  position: relative;
  margin: 0;
  overflow: hidden;
}

/* Row uses the same vertical rhythm as a .link-entry (6px/12px
   padding, 0.88rem font-size, 1.4 line-height) so the two halves
   have matching row heights. The text + level-hint pair sits on one
   line: the heading text fills the available width (truncated with
   ellipsis on overflow) and a small "H2" / "H3" / "H4" badge on the
   right gives a quick at-a-glance hierarchy cue without breaking
   the rhythm. */
.toc-panel-link {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  /* min-width: 0 lets this flex item shrink below its intrinsic
     content width when the column is narrow, so the level badge
     stays inside the row instead of being clipped off the right
     edge. Without it the <a> grows to fit "H2"/"H3"/"H4" plus the
     full heading text, and the badge ends up rendered outside the
     visible area. */
  min-width: 0;
  padding: 6px 12px 6px 16px;
  font-size: 0.88rem;
  line-height: 1.4;
  color: var(--vs-text-2, var(--text-muted));
  text-decoration: none;
  border-left: 2px solid transparent;
  transition: background 0.12s ease, color 0.12s ease;
}

.toc-panel-link-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc-panel-link-level {
  flex-shrink: 0;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--vs-text-3, var(--text-muted));
  font-variant-numeric: tabular-nums;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--vs-code-bg, rgba(0, 0, 0, 0.18));
}

.toc-panel-link:hover {
  background: var(--vs-row-hover, var(--bg-soft));
  color: var(--vs-text-1, var(--text));
}

.toc-panel-item.active .toc-panel-link {
  color: var(--vs-text-1, var(--text));
  font-weight: 500;
}

/* Active row gets the same accent left border that the .section
   focus state uses in LinksPanel. Drawn on the <a> so the indent
   for h3/h4 composes with the 2px bar. */
.toc-panel-item.active .toc-panel-link {
  border-left-color: var(--vs-accent, var(--accent));
}

/* H3 / H4 indents: 16px baseline + 8px per level. */
.toc-panel-item.lvl-3 .toc-panel-link { padding-left: 24px; }
.toc-panel-item.lvl-4 .toc-panel-link { padding-left: 32px; }

/* LinksPanel renders its own <aside class="links-panel">. We strip
   the right border (the .right-rail already provides the column
   boundary) and make the panel fill the slot — LinksPanel's own
   styles set height: 100%. */
.links-slot :deep(.links-panel) {
  border-right: 0;
  height: 100%;
}
</style>
