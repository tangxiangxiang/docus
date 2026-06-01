<script setup lang="ts">
import { computed } from 'vue'
import { posts } from '../posts'
import { RouterLink } from 'vue-router'

const grouped = computed(() => {
  const map = new Map<string, typeof posts>()
  for (const p of posts) {
    const year = (p.date ?? '').slice(0, 4) || 'Unknown'
    if (!map.has(year)) map.set(year, [])
    map.get(year)!.push(p)
  }
  return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
})
</script>

<template>
  <section>
    <h1>Archives</h1>
    <p v-if="!grouped.length" class="empty">No posts yet.</p>
    <div v-for="[year, items] in grouped" :key="year" class="archive-year">
      <h2>{{ year }}</h2>
      <ul>
        <li v-for="p in items" :key="p.slug">
          <RouterLink :to="`/posts/${p.slug}`">{{ p.title }}</RouterLink>
          <span class="date">{{ p.date }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
