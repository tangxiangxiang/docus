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
      <!-- tab.title is the frontmatter title when present, otherwise the
           raw path (set by useEditorTabs). We normalise both down to a
           filename-only display. -->
      <span class="tab-title">{{ t.title === t.path ? stripMd(basename(t.path)) : t.title }}</span>
      <button
        class="tab-close"
        title="关闭"
        @click.stop="emit('close', t.path)"
      >×</button>
    </div>
  </div>
</template>
