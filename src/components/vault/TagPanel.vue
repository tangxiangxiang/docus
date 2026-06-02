<script setup lang="ts">
import { computed } from 'vue'
import type { PostSummary } from '../../lib/api'

const props = defineProps<{
  posts: PostSummary[]
  activeTag: string | null
}>()

defineEmits<{
  select: [tag: string]
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
</script>

<template>
  <aside class="tag-panel" aria-label="Tags panel">
    <header>
      <span class="title">Tags</span>
      <span class="count">{{ tagMap.length }}</span>
    </header>
    <ul v-if="tagMap.length">
      <li v-for="[tag, count] in tagMap" :key="tag">
        <button
          class="tag-entry"
          :class="{ active: tag === activeTag }"
          :aria-pressed="tag === activeTag"
          @click="$emit('select', tag)"
        >
          <span class="tag-name">#{{ tag }}</span>
          <span class="tag-count">{{ count }}</span>
        </button>
      </li>
    </ul>
    <p v-else class="empty">No tags yet.</p>
  </aside>
</template>
