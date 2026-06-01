<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { PostSummary } from '../../lib/api'

const props = defineProps<{ posts: PostSummary[] }>()

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
        <RouterLink class="tag-entry" :to="`/tags/${tag}`">
          <span class="tag-name">#{{ tag }}</span>
          <span class="tag-count">{{ count }}</span>
        </RouterLink>
      </li>
    </ul>
    <p v-else class="empty">No tags yet.</p>
  </aside>
</template>
