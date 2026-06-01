<script setup lang="ts">
import { posts } from '../posts'
import PostCard from '../components/PostCard.vue'

const recent = posts.slice(0, 5)
</script>

<template>
  <section class="home">
    <h1>docus</h1>
    <p class="lead">A minimal markdown blog built with Vue 3, vue-router and markdown-it.</p>
    <h2>Recent posts</h2>
    <p v-if="!recent.length" class="empty">No posts yet. Add a <code>.md</code> file in <code>src/content/posts</code>.</p>
    <div v-else class="post-list">
      <PostCard v-for="p in recent" :key="p.slug" :post="p" />
    </div>
  </section>
</template>
