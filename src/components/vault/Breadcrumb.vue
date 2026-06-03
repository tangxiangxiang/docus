<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{ currentPath: string | null }>()
const router = useRouter()

const segments = computed(() => {
  if (!props.currentPath) return []
  return props.currentPath.split('/')
})

function goTo(index: number) {
  const segs = segments.value.slice(0, index + 1)
  router.push('/vault/' + segs.join('/'))
}
</script>

<template>
  <!-- The implicit 'content' root is a server-protocol detail and isn't
       surfaced in the file tree, so it doesn't belong in the breadcrumb
       either. The first path segment (inbox / literature / zettel) is the
       leftmost crumb. When no file is open, there's nothing meaningful to
       show, so the bar collapses. -->
  <nav v-if="currentPath" class="breadcrumb" aria-label="Path">
    <template v-for="(seg, i) in segments" :key="i">
      <a v-if="i < segments.length - 1" class="seg" @click="goTo(i)">{{ seg }}</a>
      <span v-else class="seg current">
        {{ seg }}<span class="ext">.md</span>
      </span>
      <span v-if="i < segments.length - 1" class="sep">›</span>
    </template>
  </nav>
</template>

<style scoped>
.seg { color: inherit; text-decoration: none; cursor: pointer; }
.seg:hover { color: var(--vs-text-1, #ddd); }
.seg.current { color: var(--vs-text-1, #ddd); cursor: default; }
.sep { color: var(--vs-text-3, #666); font-size: 0.85rem; padding: 0 2px; }
.ext { color: var(--vs-text-3, #666); }
</style>
