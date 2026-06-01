<script setup lang="ts">
defineProps<{ slug: string | null }>()
</script>

<template>
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <template v-if="slug">
      <span class="bc-segment">posts</span>
      <span class="bc-sep">›</span>
      <span class="bc-current">{{ slug }}.md</span>
    </template>
    <template v-else>
      <span class="bc-placeholder">No file open</span>
    </template>
  </nav>
</template>
