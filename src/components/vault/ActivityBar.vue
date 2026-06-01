<script setup lang="ts">
defineProps<{ fileTreeOpen: boolean }>()
const emit = defineEmits<{ 'toggle-file-tree': [] }>()
</script>

<template>
  <aside class="activity-bar" aria-label="Activity bar">
    <button
      class="ab-btn"
      :class="{ active: fileTreeOpen }"
      title="Explorer"
      :aria-pressed="fileTreeOpen"
      @click="emit('toggle-file-tree')"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    </button>
  </aside>
</template>
