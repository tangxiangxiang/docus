<script setup lang="ts">
import type { PostMeta } from '../posts'
import { RouterLink } from 'vue-router'

defineProps<{ post: PostMeta }>()
</script>

<template>
  <article class="post-card">
    <h3>
      <RouterLink :to="`/posts/${post.slug}`">{{ post.title }}</RouterLink>
    </h3>
    <p class="meta">
      <time v-if="post.date">{{ post.date }}</time>
      <span v-if="post.tags.length" class="tags">
        <RouterLink v-for="t in post.tags" :key="t" :to="`/tags/${t}`" class="tag">#{{ t }}</RouterLink>
      </span>
    </p>
    <p v-if="post.summary" class="summary">{{ post.summary }}</p>
  </article>
</template>
