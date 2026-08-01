<script setup lang="ts">
import { ICON_CHEVRON } from './icons'

defineProps<{
  label: string
  countLabel: string
  expanded: boolean
  toggleLabel: string
}>()

const emit = defineEmits<{ toggle: [] }>()

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  emit('toggle')
}
</script>

<template>
  <section class="history-timeline-group">
    <button
      type="button"
      class="history-timeline-group-header"
      data-history-row
      role="treeitem"
      aria-level="1"
      :aria-expanded="expanded"
      :aria-label="toggleLabel"
      @click="emit('toggle')"
      @keydown="onKeydown"
    >
      <span class="history-disclosure" :class="{ expanded }" v-html="ICON_CHEVRON" />
      <span class="history-timeline-group-title">{{ label }}</span>
      <span class="history-timeline-count">{{ countLabel }}</span>
    </button>
    <div v-if="expanded" class="history-timeline-group-items" role="group">
      <slot />
    </div>
  </section>
</template>
