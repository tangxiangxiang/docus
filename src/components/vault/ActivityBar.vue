<script setup lang="ts">
/* The activity-bar buttons drive the side panels. Links used to be
   one of them (a 4-button row); it has been moved to live below the
   TOC in the read-mode right rail, so it's gone from here.

   The History button carries a small numeric badge when there are
   dirty files in the working tree. The count comes from the
   useHistory singleton (which subscribes to the file-change bus)
   so the badge updates live as the user saves tabs. */
import { useHistory } from '../../composables/vault/useHistory.js'
export type SidePanel = 'files' | 'tags' | 'history'

defineProps<{ activePanel: SidePanel | null }>()
const emit = defineEmits<{
  'select-panel': [panel: SidePanel]
  'open-settings': []
}>()

const h = useHistory()
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
      :class="{ active: activePanel === 'history' }"
      title="History"
      :aria-pressed="activePanel === 'history'"
      @click="emit('select-panel', 'history')"
    >
      <!-- Git-history icon: three commit dots connected by a curve. -->
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="5" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="6" cy="19" r="1.6" fill="currentColor" stroke="none" />
        <circle cx="17" cy="12" r="1.6" fill="currentColor" stroke="none" />
        <line x1="6" y1="6.5" x2="6" y2="17.5" />
        <path d="M6 12 C 10 12, 12 12, 15.4 12" />
      </svg>
      <span
        v-if="h.dirtyCount.value > 0"
        class="ab-badge"
        :aria-label="`${h.dirtyCount.value} changed files`"
      >{{ h.dirtyCount.value }}</span>
    </button>
    <div class="ab-spacer" aria-hidden="true" />
    <button
      class="ab-btn ab-btn-settings"
      title="Settings"
      aria-label="Settings"
      @click="emit('open-settings')"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.98 2.98l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21a2.1 2.1 0 0 1-4.2 0v-.06A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-1.98.36l-.04.04A2.1 2.1 0 0 1 3.4 16.72l.04-.04A1.8 1.8 0 0 0 3.8 14.7a1.8 1.8 0 0 0-1.66-1.1H2a2.1 2.1 0 0 1 0-4.2h.06A1.8 1.8 0 0 0 3.7 8.3a1.8 1.8 0 0 0-.36-1.98l-.04-.04A2.1 2.1 0 0 1 6.28 3.3l.04.04A1.8 1.8 0 0 0 8.3 3.7h.1A1.8 1.8 0 0 0 9.5 2.06V2a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.64 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 0 1 2.98 2.98l-.04.04a1.8 1.8 0 0 0-.36 1.98v.1a1.8 1.8 0 0 0 1.66 1.1H21a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15z" />
      </svg>
    </button>
  </aside>
</template>
