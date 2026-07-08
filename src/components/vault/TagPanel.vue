<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PostSummary } from '../../lib/api'
import { PROTECTED_ROOTS } from '../../composables/zettelProtocol'
import { ICON_SEARCH } from './icons'

const props = defineProps<{
  posts: PostSummary[]
  activeTags: string[]
  path: string | null
}>()

const emit = defineEmits<{
  select: [tag: string]
  open: [path: string]
}>()

/* The panel is a small two-section layout:
     1. tag picker (filter input + scrollable list of chips)
     2. results preview (posts that match the active tag set)
   When no tags are active, only the picker shows. Multi-select uses
   OR semantics: a post passes if it has at least one active tag. */

const tagMap = computed(() => {
  const map = new Map<string, number>()
  for (const p of props.posts) {
    for (const t of p.tags) {
      map.set(t, (map.get(t) ?? 0) + 1)
    }
  }
  return Array.from(map.entries()).sort((a, b) => {
    // Selected tags float to the top so the user can find what they
    // picked without scrolling. Within each group, sort by count desc
    // so the most common tags come first.
    const aSel = props.activeTags.includes(a[0]) ? 1 : 0
    const bSel = props.activeTags.includes(b[0]) ? 1 : 0
    if (aSel !== bSel) return bSel - aSel
    if (a[1] !== b[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })
})

const filter = ref('')
const visibleTags = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return tagMap.value
  return tagMap.value.filter(([t]) => t.toLowerCase().includes(q))
})

const activeSet = computed(() => new Set(props.activeTags))

const filtered = computed(() => {
  if (props.activeTags.length === 0) return []
  const set = activeSet.value
  return props.posts.filter((p) => p.tags.some((t) => set.has(t)))
})

/** Path display: drop the leading "inbox/" / "literature/" / "zettel/"
 *  so the right-rail result row shows the meaningful tail, e.g. a file
 *  at `inbox/notes/draft.md` becomes "notes / draft". */
function pathTail(p: string): string {
  const parts = p.split('/')
  if (parts.length > 1 && PROTECTED_ROOTS.has(parts[0])) parts.shift()
  return parts.join(' / ')
}

// Reuse the same root set the FileTree uses for its scope chips — the
// trim rule is shared, so the helper lives next to the source of truth.

function onFilterKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && filter.value) {
    e.stopPropagation()
    filter.value = ''
  }
}
</script>

<template>
  <aside class="tag-panel" aria-label="Tags panel">
    <header>
      <div class="tag-filter">
        <span class="tag-filter-icon" v-html="ICON_SEARCH" aria-hidden="true" />
        <input
          v-model="filter"
          class="tag-filter-input"
          type="text"
          placeholder="过滤 tag…"
          aria-label="过滤 tag"
          @keydown="onFilterKeydown"
        />
        <button
          v-if="filter"
          class="tag-filter-clear-x"
          title="清空过滤"
          aria-label="清空过滤"
          @click="filter = ''"
        >×</button>
        <span
          class="tag-filter-count"
          :title="filter ? `共 ${tagMap.length} 个 tag` : undefined"
          aria-label="Tag 总数"
        >{{ tagMap.length }}</span>
      </div>
    </header>

    <ul v-if="visibleTags.length" class="tag-list" role="listbox" aria-multiselectable="true" aria-label="Tag 列表">
      <li v-for="[tag, count] in visibleTags" :key="tag">
        <button
          class="tag-entry"
          :class="{ active: activeSet.has(tag) }"
          :aria-pressed="activeSet.has(tag)"
          :title="activeSet.has(tag) ? `取消 #${tag}` : `筛选 #${tag}`"
          @click="emit('select', tag)"
        >
          <span class="tag-name">#{{ tag }}</span>
          <span class="tag-count">{{ count }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="filter" class="empty">没有匹配的 tag。</p>
    <p v-else class="empty">No tags yet.</p>

    <div v-if="activeTags.length" class="results" aria-live="polite">
      <header class="results-header">
        <span class="results-title">
          <template v-for="(t, i) in activeTags" :key="t">
            <span v-if="i > 0" class="results-sep" aria-hidden="true">∪</span>#{{ t }}
          </template>
        </span>
        <span class="results-count">{{ filtered.length }}</span>
      </header>
      <ul v-if="filtered.length" class="results-list">
        <li v-for="p in filtered" :key="p.path">
          <button
            class="result-entry"
            :class="{ active: p.path === path }"
            :title="p.path"
            @click="emit('open', p.path)"
          >
            <span class="result-title">{{ p.title }}</span>
            <span class="result-path">{{ pathTail(p.path) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="empty">No posts with these tags.</p>
    </div>
  </aside>
</template>
