<script setup lang="ts">
import { computed } from 'vue'
import { posts } from '../posts'
import { RouterLink } from 'vue-router'

const tagMap = computed(() => {
  const map = new Map<string, number>()
  for (const p of posts) {
    for (const t of p.tags) {
      map.set(t, (map.get(t) ?? 0) + 1)
    }
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
})
</script>

<template>
  <section>
    <h1>Tags</h1>
    <p v-if="!tagMap.length" class="empty">No tags yet.</p>
    <ul v-else class="tag-list">
      <li v-for="[tag, count] in tagMap" :key="tag">
        <RouterLink :to="`/tags/${tag}`">#{{ tag }} <span class="count">({{ count }})</span></RouterLink>
      </li>
    </ul>
  </section>
</template>
