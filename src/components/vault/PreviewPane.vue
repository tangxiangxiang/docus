<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { parseDoc } from '../../lib/frontmatter'
import { render } from '../../lib/markdown'

const props = defineProps<{ raw: string }>()
const html = ref<string>('')
const renderError = ref<string | null>(null)

watchEffect(async () => {
  try {
    const { content } = parseDoc(props.raw)
    html.value = await render(content)
    renderError.value = null
  } catch (e) {
    renderError.value = (e as Error).message
  }
})
</script>

<template>
  <div v-if="renderError" class="render-error">{{ renderError }}</div>
  <div v-else class="article preview" v-html="html" />
</template>
