<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps<{ currentPath: string | null }>()
const router = useRouter()

const segments = computed(() => {
  if (!props.currentPath) return []
  return props.currentPath.replace(/^posts\//, '').split('/')
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
      <span class="seg current">posts</span>
    </template>
    <template v-else>
      <a class="seg" @click="goRoot">posts</a>
      <template v-for="(seg, i) in segments" :key="i">
        <span class="sep">/</span>
        <a v-if="i < segments.length - 1" class="seg" @click="goTo(i)">{{ seg }}</a>
        <span v-else class="seg current">{{ seg }}</span>
      </template>
      <span class="ext">.md</span>
    </template>
  </nav>
</template>

<style scoped>
.breadcrumb { display: flex; align-items: center; gap: 4px; font-size: 0.85rem; color: var(--text-mute, #888); }
.seg { color: inherit; text-decoration: none; cursor: pointer; }
.seg:hover { color: var(--text, #ddd); text-decoration: underline; }
.seg.current { color: var(--text, #ddd); cursor: default; }
.seg.current:hover { text-decoration: none; }
.sep { color: var(--text-mute, #666); }
.ext { color: var(--text-mute, #666); }
</style>
