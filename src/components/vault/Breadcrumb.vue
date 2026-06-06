<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ currentPath: string | null }>()

const segments = computed(() => {
  if (!props.currentPath) return []
  return props.currentPath.split('/')
})
</script>

<template>
  <!-- The implicit 'content' root is a server-protocol detail and isn't
       surfaced in the file tree, so it doesn't belong in the breadcrumb
       either. The first path segment (inbox / literature / zettel) is the
       leftmost crumb. When no file is open, there's nothing meaningful to
       show, so the bar collapses. -->
  <nav v-if="currentPath" class="breadcrumb" aria-label="Path">
    <template v-for="(seg, i) in segments" :key="i">
      <span class="seg">{{ seg }}</span>
      <span v-if="i < segments.length - 1" class="sep">›</span>
    </template>
    <span class="ext">.md</span>
  </nav>
</template>

<style scoped>
.seg { color: var(--vs-text-2, #aaa); }
.sep { color: var(--vs-text-3, #666); font-size: 0.85rem; padding: 0 2px; }
.ext { color: var(--vs-text-3, #666); }
</style>
