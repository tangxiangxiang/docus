<script setup lang="ts">
// Side panel for bi-directional links. Shows, for the active note:
//
//   - "Linked by" — notes that link TO the current note (backlinks)
//   - "Links to"  — notes the current note links to (outgoing)
//
// Both are derived from the server's link index (`useLinkIndex`):
// outgoing comes from the snapshot's `outgoing[path]` (no round-trip),
// backlinks come from a per-path fetch of `/api/backlinks?path=…`.
//
// Click on any item emits `navigate` with the target path so the
// parent (VaultView) can route through `useEditorTabs.openPost`.
// Same shape as FileTree / TagPanel emits.

import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { PostSummary, BacklinkRecord } from '../../lib/api'
import { getLinkIndex, fetchBacklinks } from '../../composables/vault/useLinkIndex'
import { getFileChangeBus } from '../../composables/vault/useFileChangeBus'
import { ICON_LINKS } from './icons'
import { PROTECTED_ROOTS } from '../../composables/zettelProtocol'

const props = defineProps<{
  /** Path of the currently active note, or null if no note is open. */
  path: string | null
  /** All posts (for friendly title resolution in the link rows). */
  posts: PostSummary[]
}>()

const emit = defineEmits<{
  navigate: [path: string]
}>()

const indexState = getLinkIndex()
const fileBus = getFileChangeBus()

const backlinks = ref<BacklinkRecord[]>([])

/** Path of the outgoing section. Stored separately from `props.path`
 *  so the debounce doesn't fire a re-fetch on every keystroke when
 *  the source path is unchanged (which it is — the user is editing
 *  the *content* of the current note, not switching notes). */
const activePath = computed(() => props.path)

/** Resolve a post's friendly title from the `posts` prop. Falls
 *  back to the path tail when the post is unknown (e.g. the index
 *  has been updated but the posts list hasn't). */
const titleByPath = computed(() => {
  const m = new Map<string, string>()
  for (const p of props.posts) m.set(p.path, p.title)
  return m
})

function displayTitle(p: string): string {
  return titleByPath.value.get(p) ?? pathTail(p)
}

/** Drop the leading protected root (`inbox/`, `zettel/`, etc.) so
 *  the panel rows read as "the meaningful tail", matching what
 *  TagPanel / FileTree do. */
function pathTail(p: string): string {
  const parts = p.split('/')
  if (parts.length > 1 && PROTECTED_ROOTS.has(parts[0])) parts.shift()
  return parts.join(' / ')
}

/** Outgoing links for the current path, derived from the
 *  module-level index snapshot. No async fetch needed — the index
 *  is refreshed in the background by `useLinkIndexSubscription`. */
const outgoing = computed(() => {
  const p = activePath.value
  if (!p) return []
  return indexState.value.outgoing[p] ?? []
})

const outgoingDisplay = computed(() => {
  return outgoing.value.map((l) => ({
    target: l.target,
    label: l.alias ?? displayTitle(l.target),
    anchor: l.anchor,
    kind: l.kind,
  }))
})

async function refetchBacklinks() {
  const p = activePath.value
  if (!p) {
    backlinks.value = []
    return
  }
  try {
    backlinks.value = await fetchBacklinks(p)
  } catch {
    // Network blip; keep the previous list. The next debounce will retry.
  }
}

// Debounced re-fetch on (a) path change, (b) any bus event.
// `useLinkIndexSubscription` is what populates the outgoing index;
// this is its mirror for the backlinks (which aren't in the snapshot
// for wire-size reasons).
const debouncedRefetch = useDebounceFn(() => { void refetchBacklinks() }, 400)

let busStop: (() => void) | null = null
let lastSeenSeq = 0

onMounted(() => {
  void refetchBacklinks()
  // Subscribe to bus for "any file changed → backlinks may have moved"
  // notifications. Same `seq` dedup pattern useEditorTabs uses.
  busStop = watch(
    () => fileBus.value,
    (events) => {
      const latest = events.at(-1)?.seq ?? lastSeenSeq
      if (latest <= lastSeenSeq) return
      lastSeenSeq = latest
      debouncedRefetch()
    },
    { flush: 'post' },
  )
})

onBeforeUnmount(() => {
  if (busStop) {
    busStop()
    busStop = null
  }
})

// Re-fetch when the active path changes (no debounce — switching
// notes is a discrete user action).
watch(activePath, () => {
  // Cancel any pending debounce — a path change overrides it.
  const d = debouncedRefetch as { cancel?: () => void }
  d.cancel?.()
  void refetchBacklinks()
})

const isEmpty = computed(() =>
  !activePath.value ||
  (backlinks.value.length === 0 && outgoingDisplay.value.length === 0),
)
</script>

<template>
  <aside class="links-panel" aria-label="Links panel">
    <header>
      <div class="title" role="presentation">
        <span class="title-icon" v-html="ICON_LINKS" aria-hidden="true" />
        <span class="title-text">Links</span>
      </div>
    </header>

    <div v-if="!activePath" class="empty">
      打开一篇笔记以查看其链接。
    </div>
    <div v-else-if="isEmpty" class="empty">
      <p>暂无链接。</p>
      <p class="empty-hint">
        在正文里写 <code>[[other-note]]</code> 或
        <code>[other](other.md)</code> 来建立链接。
      </p>
    </div>

    <template v-else>
      <section class="section" aria-label="Linked by">
        <header class="section-header">
          <span class="section-title">Linked by</span>
          <span class="section-count">{{ backlinks.length }}</span>
        </header>
        <ul v-if="backlinks.length" class="link-list">
          <li v-for="b in backlinks" :key="b.source">
            <button
              class="link-entry"
              type="button"
              :title="b.source"
              @click="emit('navigate', b.source)"
            >
              <span class="link-title">{{ displayTitle(b.source) }}</span>
              <span class="link-path">{{ pathTail(b.source) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="empty section-empty">尚无其他笔记链接到这里。</p>
      </section>

      <section class="section" aria-label="Links to">
        <header class="section-header">
          <span class="section-title">Links to</span>
          <span class="section-count">{{ outgoingDisplay.length }}</span>
        </header>
        <ul v-if="outgoingDisplay.length" class="link-list">
          <li v-for="l in outgoingDisplay" :key="l.target + (l.anchor ?? '')">
            <button
              class="link-entry"
              type="button"
              :title="l.target"
              @click="emit('navigate', l.target)"
            >
              <span class="link-title">{{ l.label }}</span>
              <span class="link-path">{{ pathTail(l.target) }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="empty section-empty">本笔记暂未链接到其他笔记。</p>
      </section>
    </template>
  </aside>
</template>

<style scoped>
/* Layout matches TagPanel / FileTree so the three panels in the
   activity bar read as a single visual family. Background and
   border use the vault tokens so dark/light themes flow through. */
.links-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--vs-side-bg, var(--bg-soft));
  border-right: 1px solid var(--vs-border, var(--border));
  color: var(--vs-text, var(--text));
  height: 100%;
  overflow: hidden;
}
.links-panel > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vs-border, var(--border));
  background: var(--vs-side-header-bg, transparent);
}
.title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--vs-text-2, var(--text-muted));
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.title-icon {
  display: inline-flex;
  align-items: center;
  color: var(--vs-text-2, var(--text-muted));
}
.title-text { color: var(--vs-text-1, var(--text)); }

.empty {
  padding: 18px 14px;
  font-size: 0.88rem;
  color: var(--vs-text-2, var(--text-muted));
  font-style: italic;
}
.empty-hint { margin-top: 8px; font-size: 0.82rem; }
.empty code {
  font-family: var(--vs-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.85em;
  background: var(--vs-code-bg, rgba(0, 0, 0, 0.18));
  padding: 1px 4px;
  border-radius: 3px;
}

.section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  border-bottom: 1px solid var(--vs-border, var(--border));
}
.section:last-child { border-bottom: 0; }
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 0.78rem;
  color: var(--vs-text-2, var(--text-muted));
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--vs-side-section-bg, transparent);
  border-bottom: 1px solid var(--vs-border, var(--border));
}
.section-title { font-weight: 600; }
.section-count {
  font-variant-numeric: tabular-nums;
  color: var(--vs-text-3, var(--text-muted));
}

.link-list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}
.link-entry {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  padding: 6px 12px;
  background: transparent;
  border: 0;
  color: var(--vs-text, var(--text));
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: 0.88rem;
}
.link-entry:hover {
  background: var(--vs-row-hover, var(--bg-soft));
}
.link-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.link-path {
  font-size: 0.75rem;
  color: var(--vs-text-3, var(--text-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.section-empty {
  padding: 10px 14px;
  font-size: 0.82rem;
}
</style>
