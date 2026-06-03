<script setup lang="ts">
import { computed } from 'vue'
import type { PostSummary } from '../../lib/api'

const props = defineProps<{
  posts: PostSummary[]
  activeTag: string | null
  path: string | null
}>()

const emit = defineEmits<{
  select: [tag: string]
  open: [path: string]
}>()

const tagMap = computed(() => {
  const map = new Map<string, number>()
  for (const p of props.posts) {
    for (const t of p.tags) {
      map.set(t, (map.get(t) ?? 0) + 1)
    }
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
})

/** "posts/notes/draft" -> "notes / draft" (drops the "posts/" prefix). */
function pathTail(p: string): string {
  return p.replace(/^posts\//, '')
}

const filtered = computed(() => {
  if (!props.activeTag) return []
  return props.posts.filter((p) => p.tags.includes(props.activeTag!))
})
</script>

<template>
  <aside class="tag-panel" aria-label="Tags panel">
    <header>
      <span class="title">Tags</span>
      <span class="count">{{ tagMap.length }}</span>
    </header>
    <ul v-if="tagMap.length" class="tag-list">
      <li v-for="[tag, count] in tagMap" :key="tag">
        <button
          class="tag-entry"
          :class="{ active: tag === activeTag }"
          :aria-pressed="tag === activeTag"
          @click="emit('select', tag)"
        >
          <span class="tag-name">#{{ tag }}</span>
          <span class="tag-count">{{ count }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="empty">No tags yet.</p>

    <div v-if="activeTag" class="results">
      <header class="results-header">
        <span class="results-title">#{{ activeTag }}</span>
        <span class="results-count">{{ filtered.length }}</span>
      </header>
      <ul v-if="filtered.length" class="results-list">
        <li v-for="p in filtered" :key="p.path">
          <button
            class="result-entry"
            :class="{ active: p.path === path }"
            @click="emit('open', p.path)"
          >
            <span class="result-title">{{ p.title }}</span>
            <span class="result-path">{{ pathTail(p.path) }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="empty">No posts with this tag.</p>
    </div>
  </aside>
</template>
