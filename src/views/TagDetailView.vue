<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { listPosts, type PostSummary } from '../lib/api'

/* See TagsView.vue for the rationale on reading from /api/posts instead
   of the build-time glob. This page additionally renders each post's
   path as a deep-link into the vault so a click on a tag result opens
   the file. */

const route = useRoute()
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

/** `posts/notes/draft` -> `notes / draft` (drops the `posts/` prefix). */
function pathTail(p: string): string {
  return p.replace(/^posts\//, '')
}

const filtered = computed(() => {
  const tag = String(route.params.tag)
  return posts.value.filter((p) => p.tags.includes(tag))
})
</script>

<template>
  <section>
    <h1>Tag: #{{ route.params.tag }}</h1>
    <p v-if="loading" class="empty">Loading…</p>
    <p v-else-if="loadError" class="empty">Failed to load: {{ loadError }}</p>
    <p v-else-if="!filtered.length" class="empty">No posts with this tag.</p>
    <ul v-else class="post-list">
      <li v-for="p in filtered" :key="p.path">
        <RouterLink :to="`/vault/${p.path}`">{{ p.title }}</RouterLink>
        <span class="path">{{ pathTail(p.path) }}</span>
      </li>
    </ul>
  </section>
</template>
