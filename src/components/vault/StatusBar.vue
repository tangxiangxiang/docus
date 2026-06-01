<script setup lang="ts">
import { computed } from 'vue'
import type { SaveStatus } from './tabs'

const props = defineProps<{
  slug: string | null
  saveStatus: SaveStatus
  error: string | null
  size: number
  dirty: boolean
}>()

const statusLabel = computed(() => {
  if (!props.slug) return '—'
  if (props.saveStatus === 'saving') return '$(loading) Saving…'
  if (props.saveStatus === 'dirty') return '● Unsaved'
  if (props.saveStatus === 'saved') return '✓ Saved'
  if (props.saveStatus === 'error') return `! ${props.error ?? 'Error'}`
  return 'Idle'
})

const sizeLabel = computed(() => {
  if (!props.size) return ''
  if (props.size < 1024) return `${props.size} B`
  return `${(props.size / 1024).toFixed(1)} KB`
})
</script>

<template>
  <footer class="status-bar" aria-label="Status bar">
    <div class="sb-left">
      <span class="sb-item sb-status" :data-status="saveStatus">{{ statusLabel }}</span>
    </div>
    <div class="sb-right">
      <span class="sb-item">Markdown</span>
      <span v-if="sizeLabel" class="sb-item">{{ sizeLabel }}</span>
    </div>
  </footer>
</template>
