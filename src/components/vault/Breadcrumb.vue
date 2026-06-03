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
function goRoot() { router.push('/vault') }
</script>

<template>
  <nav class="breadcrumb" aria-label="Path">
    <template v-if="!currentPath">
      <span class="seg current">content</span>
    </template>
    <template v-else>
      <a class="seg" @click="goRoot">content</a>
      <template v-for="(seg, i) in segments" :key="i">
        <span class="sep">›</span>
        <a v-if="i < segments.length - 1" class="seg" @click="goTo(i)">{{ seg }}</a>
        <span v-else class="seg current">{{ seg }}</span>
      </template>
      <span class="ext">.md</span>
    </template>
  </nav>
</template>

<style scoped>
.seg { color: inherit; text-decoration: none; cursor: pointer; }
.seg:hover { color: var(--vs-text-1, #ddd); }
.seg.current { color: var(--vs-text-1, #ddd); cursor: default; }
.sep { color: var(--vs-text-3, #666); font-size: 0.85rem; }
.ext { color: var(--vs-text-3, #666); }
</style>
