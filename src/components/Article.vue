<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { render } from '../lib/markdown'
import { useMarkmapMount } from '../composables/useMarkmapMount'
import { useMermaidMount } from '../composables/useMermaidMount'

const props = defineProps<{ markdown: string }>()
const html = ref<string>('')
const articleEl = ref<HTMLElement | null>(null)
/* ```markmap``` and ```mermaid``` fences get upgraded to interactive
   widgets on the public /posts/:slug page the same way they do in
   the vault editor preview / reading pane. */
useMarkmapMount(articleEl)
useMermaidMount(articleEl)

watchEffect(async () => {
  html.value = await render(props.markdown)
})
</script>

<template>
  <div ref="articleEl" class="article" v-html="html" />
</template>
