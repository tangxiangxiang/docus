<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ currentPath: string | null }>()

const segments = computed(() => {
  if (!props.currentPath) return []
  // Drop the .md extension from the leaf segment — it's an internal
  // detail of how the file is stored on disk, not part of the
  // document's identity as a zettel.
  const segs = props.currentPath.split('/')
  const last = segs.length - 1
  if (last >= 0 && segs[last].endsWith('.md')) segs[last] = segs[last].slice(0, -3)
  return segs
})
</script>

<template>
  <!-- The implicit 'content' root is a server-protocol detail and isn't
       surfaced in the file tree, so it doesn't belong in the breadcrumb
       either. The first path segment (inbox / literature / zettel) is the
       leftmost crumb. The <nav> is always rendered (even with no
       segments) so it occupies its 22px row in the editor-area grid —
       removing it via v-if would shift the .content area up into the
       breadcrumb's row, collapsing it from 1fr to 22px and clipping the
       empty-state card. -->
  <nav class="breadcrumb" aria-label="Path">
    <template v-for="(seg, i) in segments" :key="i">
      <span class="seg">{{ seg }}</span>
      <span v-if="i < segments.length - 1" class="sep">›</span>
    </template>
  </nav>
</template>

<style scoped>
.seg { color: var(--vs-text-2, #aaa); }
.sep { color: var(--vs-text-3, #666); font-size: 0.85rem; padding: 0 2px; }
</style>
