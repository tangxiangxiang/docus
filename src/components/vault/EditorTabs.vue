<script setup lang="ts">
import type { Tab } from './tabs'

defineProps<{ tabs: Tab[]; activePath: string | null }>()
const emit = defineEmits<{ select: [path: string]; close: [path: string] }>()

/* The tab label is just the file's basename, not the full path —
   the status bar footer now carries the full path (formerly a
   breadcrumb row above the editor). The tooltip on the tab keeps
   the path available on hover for power users. */
function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}
function stripMd(name: string): string {
  return name.endsWith('.md') ? name.slice(0, -3) : name
}
</script>

<template>
  <div class="tabs" role="tablist">
    <div
      v-for="t in tabs"
      :key="t.path"
      role="tab"
      :aria-selected="t.path === activePath"
      :title="`${t.title || t.path}\n${t.path}\n中键 / × 关闭`"
      class="tab"
      :class="{ active: t.path === activePath }"
      @click="emit('select', t.path)"
      @auxclick.middle="emit('close', t.path)"
    >
      <span class="tab-dot" :class="{ dirty: t.saveStatus === 'dirty' }" />
      <!-- Tab label is the filename (no .md), period. The frontmatter
           title still lives on Tab.title and surfaces in the hover
           tooltip (line above), but tabs are a navigation surface —
           they should anchor on the stable identifier (filename),
           not the variable display field (title), or some notes
           show one and some show the other. -->
      <span class="tab-title">{{ stripMd(basename(t.path)) }}</span>
      <button
        class="tab-close"
        title="关闭"
        @click.stop="emit('close', t.path)"
      >×</button>
    </div>
  </div>
</template>
