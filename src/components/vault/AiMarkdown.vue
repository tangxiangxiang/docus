<script setup lang="ts">
import { computed } from 'vue'
import { renderAiMarkdown } from '../../lib/aiMarkdown'

const props = defineProps<{
  content: string
}>()

const html = computed(() => renderAiMarkdown(props.content))
</script>

<template>
  <div class="ai-markdown article" v-html="html" />
</template>

<style scoped>
.ai-markdown {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
.ai-markdown :deep(:first-child) { margin-top: 0; }
.ai-markdown :deep(:last-child) { margin-bottom: 0; }
.ai-markdown :deep(pre) { max-width: 100%; overflow-x: auto; }
.ai-markdown :deep(code) { overflow-wrap: anywhere; }
.ai-markdown :deep(a) { overflow-wrap: anywhere; }
</style>
