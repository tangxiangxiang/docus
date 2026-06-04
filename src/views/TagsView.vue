<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { listPosts, type PostSummary } from '../lib/api'

/* The /tags and /tags/:tag views used to read from a build-time glob
   (src/posts/index.ts -> import.meta.glob under content/posts), but
   content actually lives under src/content/{inbox,literature,zettel} —
   `posts/` is not a real subfolder. The glob returned an empty array, so
   the tag aggregation was always empty and the user saw "No tags yet."

   The fix pulls the same data the vault already uses: GET /api/posts.
   That keeps the tag views in sync with the rest of the app (the vault
   already uses the API to discover posts and their frontmatter tags),
   and means tag counts stay accurate after file create/rename/delete. */

const posts = ref<PostSummary[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

onMounted(async () => {
  try {
    posts.value = await listPosts()
  } catch (e) {
    loadError.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

const tagMap = computed(() => {
  const map = new Map<string, number>()
  for (const p of posts.value) {
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
    <p v-if="loading" class="empty">Loading…</p>
    <p v-else-if="loadError" class="empty">Failed to load: {{ loadError }}</p>
    <p v-else-if="!tagMap.length" class="empty">No tags yet.</p>
    <ul v-else class="tag-list">
      <li v-for="[tag, count] in tagMap" :key="tag">
        <RouterLink :to="`/tags/${tag}`">#{{ tag }} <span class="count">({{ count }})</span></RouterLink>
      </li>
    </ul>
  </section>
</template>
