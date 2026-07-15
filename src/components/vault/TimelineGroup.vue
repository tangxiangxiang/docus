<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <section class="history-timeline-group" role="group" :aria-label="label">
    <h3 class="history-timeline-group-title">{{ label }}</h3>
    <div class="history-timeline-group-items">
      <slot />
    </div>
  </section>
</template>
