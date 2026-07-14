<script setup lang="ts">
/* The activity-bar buttons drive the side panels. Links used to be
   one of them (a 4-button row); it has been moved to live below the
   TOC in the read-mode right rail, so it's gone from here.

   The History button carries a small numeric badge when there are
   dirty files in the working tree. The count comes from the
   vault-scoped useHistory instance (which subscribes to the file-change bus)
   so the badge updates live as the user saves tabs. */
import { useHistory } from '../../composables/vault/useHistory.js'
import {
  ICON_AB_FILES,
  ICON_AB_GIT_HISTORY,
  ICON_AB_SETTINGS,
  ICON_AB_TAGS,
} from './icons'
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
      <span class="ab-btn-icon" v-html="ICON_AB_FILES" aria-hidden="true" />
    </button>
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'tags' }"
      title="Tags"
      :aria-pressed="activePanel === 'tags'"
      @click="emit('select-panel', 'tags')"
    >
      <span class="ab-btn-icon" v-html="ICON_AB_TAGS" aria-hidden="true" />
    </button>
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'history' }"
      title="History"
      :aria-pressed="activePanel === 'history'"
      @click="emit('select-panel', 'history')"
    >
      <span class="ab-btn-icon" v-html="ICON_AB_GIT_HISTORY" aria-hidden="true" />
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
      <span class="ab-btn-icon" v-html="ICON_AB_SETTINGS" aria-hidden="true" />
    </button>
  </aside>
</template>
