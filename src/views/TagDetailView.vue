<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { posts } from '../posts'

const route = useRoute()
const filtered = computed(() =>
  posts.filter((p) => p.tags.includes(String(route.params.tag))),
)
</script>

<template>
  <section>
    <h1>Tag: #{{ route.params.tag }}</h1>
    <p v-if="!filtered.length" class="empty">No posts with this tag.</p>
    <ul v-else class="post-list">
      <li v-for="p in filtered" :key="p.slug">
        <RouterLink :to="`/vault/${p.slug}`">{{ p.title }}</RouterLink>
        <span class="date">{{ p.date }}</span>
      </li>
    </ul>
  </section>
</template>
