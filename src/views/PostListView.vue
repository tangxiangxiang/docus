<script setup lang="ts">
import { posts } from '../posts'
import PostCard from '../components/PostCard.vue'
</script>

<template>
  <section class="post-list-view">
    <h1>All Posts</h1>
    <p v-if="!posts.length" class="empty">No posts yet.</p>
    <div v-else class="post-list">
      <PostCard v-for="p in posts" :key="p.slug" :post="p" />
    </div>
  </section>
</template>
