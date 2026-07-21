<script setup lang="ts">
/* The activity-bar buttons drive the side panels. Links used to be
   one of them (a 4-button row); it has been moved to live below the
   TOC in the read-mode right rail, so it's gone from here.

   The History button carries a small numeric badge when there are
   dirty files in the working tree. The count comes from the
   vault-scoped useHistory instance (which subscribes to the file-change bus)
   so the badge updates live as the user saves tabs. */
import { useHistory } from '../../composables/vault/useHistory.js'
import { useI18n } from '../../composables/useI18n'
import {
  ICON_AB_GIT_HISTORY,
  ICON_AB_SETTINGS,
  ICON_FOLDER,
  ICON_TAG,
} from './icons'
export type SidePanel = 'files' | 'tags' | 'history' | 'recovery'

defineProps<{ activePanel: SidePanel | null }>()
const emit = defineEmits<{
  'select-panel': [panel: SidePanel]
  'open-settings': []
}>()

const h = useHistory()
const { t } = useI18n()
</script>

<template>
  <aside class="activity-bar" :aria-label="t('activity.label')">
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'files' }"
      :title="t('activity.explorer')"
      :aria-label="t('activity.explorer')"
      :aria-pressed="activePanel === 'files'"
      @click="emit('select-panel', 'files')"
    >
      <span class="ab-btn-icon" v-html="ICON_FOLDER" aria-hidden="true" />
    </button>
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'tags' }"
      :title="t('activity.tags')"
      :aria-label="t('activity.tags')"
      :aria-pressed="activePanel === 'tags'"
      @click="emit('select-panel', 'tags')"
    >
      <span class="ab-btn-icon" v-html="ICON_TAG" aria-hidden="true" />
    </button>
    <button
      class="ab-btn"
      :class="{ active: activePanel === 'history' }"
      :title="t('history.activity_label')"
      :aria-label="t('history.activity_label')"
      :aria-pressed="activePanel === 'history'"
      @click="emit('select-panel', 'history')"
    >
      <span class="ab-btn-icon" v-html="ICON_AB_GIT_HISTORY" aria-hidden="true" />
      <span
        v-if="h.dirtyCount.value > 0"
        class="ab-badge"
        :aria-label="t('history.changed_files', { count: h.dirtyCount.value })"
      >{{ h.dirtyCount.value }}</span>
    </button>
    <div class="ab-spacer" aria-hidden="true" />
    <button
      class="ab-btn ab-btn-settings"
      :title="t('activity.settings')"
      :aria-label="t('activity.settings')"
      @click="emit('open-settings')"
    >
      <span class="ab-btn-icon" v-html="ICON_AB_SETTINGS" aria-hidden="true" />
    </button>
  </aside>
</template>
