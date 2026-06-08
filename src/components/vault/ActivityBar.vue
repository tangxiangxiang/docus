<script setup lang="ts">
export type SidePanel = 'files' | 'tags' | 'links'

defineProps<{ activePanel: SidePanel | null }>()
const emit = defineEmits<{
  'select-panel': [panel: SidePanel]
}>()
</script>

<template>
  <aside class="activity-bar" aria-label="Activity bar">
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'files' }"
      title="Explorer (Ctrl/Cmd+B)"
      :aria-pressed="activePanel === 'files'"
      @click="emit('select-panel', 'files')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    </button>
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'tags' }"
      title="Tags"
      :aria-pressed="activePanel === 'tags'"
      @click="emit('select-panel', 'tags')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    </button>
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'links' }"
      title="Links"
      :aria-pressed="activePanel === 'links'"
      @click="emit('select-panel', 'links')"
    >
      <!-- Two interlocked rings, the same visual as the panel
           header icon. 22×22, same stroke weight as the other two. -->
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 14a4 4 0 0 1 0-5.66L12 6a4 4 0 1 1 5.66 5.66L15 14.34" />
        <path d="M14 10a4 4 0 0 1 0 5.66L12 18a4 4 0 1 1-5.66-5.66L9 9.66" />
      </svg>
    </button>
  </aside>
</template>
