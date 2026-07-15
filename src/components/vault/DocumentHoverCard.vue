<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  visible: boolean
  position: Record<string, string>
  title: string
  path: string
  mtime?: number
  tags?: string[]
}>()

const { t } = useI18n()

const modifiedLabel = computed(() => props.mtime
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(props.mtime))
  : '')
</script>

<template>
  <Teleport to="body">
    <Transition name="document-hover-card">
      <div v-if="visible" class="document-hover-card" :style="position" role="tooltip">
        <strong>{{ title }}</strong>
        <code>{{ path }}</code>
        <span v-if="modifiedLabel">{{ t('document_hover.modified', { date: modifiedLabel }) }}</span>
        <span v-if="tags?.length" class="document-hover-tags">{{ tags.map(tag => `#${tag}`).join(' ') }}</span>
      </div>
    </Transition>
  </Teleport>
</template>
