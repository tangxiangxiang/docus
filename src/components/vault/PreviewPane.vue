<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { parseDoc } from '../../lib/frontmatter'
import { render } from '../../lib/markdown'

const props = defineProps<{ raw: string }>()
const html = ref<string>('')
const renderError = ref<string | null>(null)

watchEffect(async () => {
  try {
    const { frontmatter, content } = parseDoc(props.raw)
    /* The frontmatter `title` is the canonical H1. Some posts already start the
     * body with `# …` (the author chose to write the title inline); in that case
     * honor the body's H1 and don't double up. For posts that begin with `## …`
     * or prose, prepend the frontmatter title so the preview isn't heading-less. */
    const title = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : ''
    const startsWithH1 = /^#\s+\S/.test(content.trimStart())
    const body = !startsWithH1 && title
      ? `# ${title}\n\n${content.replace(/^\n+/, '')}`
      : content
    html.value = await render(body)
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
