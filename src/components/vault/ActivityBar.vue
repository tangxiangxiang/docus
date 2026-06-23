<script setup lang="ts">
/* The three activity-bar buttons drive the three side panels. Links
   used to be one of them (a 4-button row); it has been moved to live
   below the TOC in the read-mode right rail, so it's gone from here. */
export type SidePanel = 'files' | 'tags' | 'graph'

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
      :class="{ active: activePanel === 'graph' }"
      title="Knowledge Graph"
      :aria-pressed="activePanel === 'graph'"
      @click="emit('select-panel', 'graph')"
    >
      <!-- Force-graph icon: a node with three outgoing edges, the
           visual language of "graph view". 22x22, same stroke
           weight as the other three. -->
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <line x1="6.5" y1="7" x2="10.5" y2="16.5" />
        <line x1="17.5" y1="7" x2="13.5" y2="16.5" />
        <line x1="7" y1="6" x2="17" y2="6" />
      </svg>
    </button>
  </aside>
</template>
