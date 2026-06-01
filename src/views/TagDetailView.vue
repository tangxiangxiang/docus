<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { posts } from '../posts'
import PostCard from '../components/PostCard.vue'

const route = useRoute()
const filtered = computed(() =>
  posts.filter((p) => p.tags.includes(String(route.params.tag))),
)
</script>

<template>
  <section>
    <h1>Tag: #{{ route.params.tag }}</h1>
    <p v-if="!filtered.length" class="empty">No posts with this tag.</p>
    <div v-else class="post-list">
      <PostCard v-for="p in filtered" :key="p.slug" :post="p" />
    </div>
  </section>
</template>
