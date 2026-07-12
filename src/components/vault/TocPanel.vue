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
// title row, 8px/12px padding, 1px border-bottom),
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
import { tocHeadings, tocActiveId, tocScrollTo, linksEmpty } from '../../composables/vault/useTocState'
import { ICON_FILE_MD } from './icons'
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
const currentPost = computed(() => props.posts.find((post) => post.path === props.path))
const documentTitle = computed(() => currentPost.value?.title || props.path?.split('/').at(-1) || '未打开文档')
function compactDirectory(parts: string[]): string {
  const labels = parts.map((part, index) => index === 0
    ? part.charAt(0).toUpperCase() + part.slice(1)
    : part.replace(/-/g, ' '))
  return labels.length <= 2 ? labels.join(' / ') : `${labels[0]} / … / ${labels.at(-1)}`
}
const documentDirectory = computed(() => {
  if (!props.path) return ''
  return compactDirectory(props.path.split('/').slice(0, -1))
})

/* The right-rail is split 50/50 by default, but that's wasteful when
   one half is empty (a 30-heading note with 0 links leaves half the
   rail sitting on "No links yet"). When exactly one half is empty we
   collapse the empty one and let the populated half take the full
   column. When both are empty we fall back to 50/50 so the "No
   headings" / "No links yet" empty states still have somewhere to
   sit. `linksEmpty` is published by LinksPanel via a watchEffect on
   its own isEmpty computed (which tracks the async backlinks fetch
   + the link index), so it stays in lockstep with what the panel
   actually shows. */
const isTocEmpty = computed(() => !hasHeadings.value)
const isLinksEmpty = computed(() => linksEmpty.value)
const bothEmpty = computed(() => isTocEmpty.value && isLinksEmpty.value)
const tocCollapsed = computed(() => isTocEmpty.value && !bothEmpty.value)
const linksCollapsed = computed(() => isLinksEmpty.value && !bothEmpty.value)

function onTocClick(id: string) {
  tocScrollTo.value?.(id)
}

function onLinkNavigate(p: string) {
  emit('link-navigate', p)
}
</script>

<template>
  <div
    class="right-rail"
    :class="{ 'toc-collapsed': tocCollapsed, 'links-collapsed': linksCollapsed }"
  >
    <header class="document-context">
      <span class="document-context-icon" aria-hidden="true" v-html="ICON_FILE_MD" />
      <div class="document-context-copy">
        <strong :title="documentTitle">{{ documentTitle }}</strong>
        <span v-if="documentDirectory" :title="documentDirectory">{{ documentDirectory }}</span>
      </div>
    </header>

    <section class="toc-panel" aria-label="目录">
      <header class="rail-section-header">
        <span>目录</span>
      </header>

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

    <section class="links-slot" aria-label="引用关系">
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
  background: var(--vs-side-bg, var(--vs-bg-1));
  overflow: hidden;
}

.document-context {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  flex: 0 0 auto;
  padding: 8px 14px 7px;
  border-bottom: 1px solid color-mix(in srgb, var(--vs-border, var(--border)) 40%, transparent);
}
.document-context-icon { display: inline-flex; flex: 0 0 auto; margin-top: 2px; color: var(--vs-text-2, var(--text-muted)); }
.document-context-copy { min-width: 0; display: grid; gap: 2px; }
.document-context-copy strong,
.document-context-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.document-context-copy strong { color: var(--vs-text-1, var(--text)); font-size: 0.86rem; font-weight: 600; }
.document-context-copy span { color: var(--vs-text-3, var(--text-muted)); font-size: 0.7rem; }

.toc-panel,
.links-slot {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.toc-panel { flex: 0 1 auto; max-height: 40%; }
.links-slot { flex: 1 1 auto; }
.right-rail.links-collapsed .toc-panel { flex: 1 1 auto; max-height: none; }

/* 1px divider between the two halves. Sits on the Links side so the
   top half's bottom border doesn't double up against it. Dropped
   when the TOC half is collapsed — there's no boundary to draw. */
.links-slot {
  border-top: 1px solid color-mix(in srgb, var(--vs-border, var(--border)) 40%, transparent);
}
.right-rail.toc-collapsed .links-slot {
  border-top: 0;
}

/* Collapse the empty half so the populated one takes the full rail
   height. The .right-rail stays a flex column, and the surviving
   half's existing `flex: 1 1 0` makes it stretch to fill. When both
   halves are empty (no .toc-collapsed / .links-collapsed class), the
   default 50/50 split still applies so the empty states have room. */
.right-rail.toc-collapsed .toc-panel,
.right-rail.links-collapsed .links-slot {
  display: none;
}

.rail-section-header {
  display: flex;
  align-items: center;
  min-height: 30px;
  padding: 5px 14px 3px;
  flex-shrink: 0;
  color: var(--vs-text-2, var(--text-muted));
  font-size: 0.72rem;
  font-weight: 600;
}

.toc-panel-empty {
  padding: 7px 14px 12px;
  font-size: 0.78rem;
  color: var(--vs-text-2, var(--text-muted));
  font-style: italic;
}

.toc-panel-list {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  list-style: none;
  margin: 0;
  padding: 0;
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
   have matching row heights. The heading text fills the available
   width and is truncated with ellipsis on overflow. H3/H4 indents
   (8px per level on top of the 16px baseline) provide the hierarchy
   cue without a separate badge. */
.toc-panel-link {
  display: block;
  width: 100%;
  /* min-width: 0 lets this flex item shrink below its intrinsic
     content width when the column is narrow. */
  min-width: 0;
  padding: 5px 14px 5px 16px;
  font-size: 0.84rem;
  line-height: 1.4;
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
  background: var(--vs-row-hover, var(--bg-soft));
  color: var(--vs-text-1, var(--text));
}

.toc-panel-item.active .toc-panel-link {
  color: var(--vs-accent, var(--accent));
  font-weight: 600;
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
