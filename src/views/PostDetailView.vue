<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { loadPost } from '../posts'
import Article from '../components/Article.vue'

const route = useRoute()
const frontmatter = ref<Record<string, any> | null>(null)
const content = ref<string>('')
const notFound = ref(false)

watchEffect(async () => {
  const slug = String(route.params.slug)
  try {
    const post = await loadPost(slug)
    frontmatter.value = post.frontmatter
    content.value = post.content
    notFound.value = false
  } catch {
    frontmatter.value = null
    content.value = ''
    notFound.value = true
  }
})
</script>

<template>
  <article v-if="frontmatter" class="post-detail">
    <h1>{{ frontmatter.title ?? route.params.slug }}</h1>
    <p class="meta">
      <time v-if="frontmatter.date">{{ frontmatter.date }}</time>
    </p>
    <Article :markdown="content" />
    <p class="back">
      <RouterLink to="/">← Back to home</RouterLink>
    </p>
  </article>
  <p v-else-if="notFound">Post not found. <RouterLink to="/">Back to home</RouterLink></p>
  <p v-else>Loading…</p>
</template>
