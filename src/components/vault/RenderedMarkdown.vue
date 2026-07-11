<script setup lang="ts">
import { nextTick, ref, toRef, watch } from 'vue'
import { useMarkdownRender, type Heading } from '../../composables/vault/useMarkdownRender'
import { useMarkmapMount } from '../../composables/useMarkmapMount'
import { useMermaidMount } from '../../composables/useMermaidMount'
import { getOpenPostForClicks } from '../../composables/vault/useEditorTabs'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'

const props = withDefaults(defineProps<{
  raw: string
  resolver?: WikiResolver
  tag?: 'div' | 'article'
  mode: 'preview' | 'reading'
}>(), { tag: 'div' })
const emit = defineEmits<{
  'update:headings': [headings: Heading[]]
  rendered: [el: HTMLElement | null]
}>()

const { html, error, headings } = useMarkdownRender(toRef(props, 'raw'), props.resolver)
const articleEl = ref<HTMLElement | null>(null)
useMarkmapMount(articleEl)
useMermaidMount(articleEl)

watch(headings, (value) => emit('update:headings', value), { immediate: true })
watch([html, articleEl], async () => {
  await nextTick()
  emit('rendered', articleEl.value)
}, { flush: 'post', immediate: true })

function onArticleClick(event: MouseEvent) {
  if (event.button !== 0) return
  const anchor = (event.target as HTMLElement | null)?.closest('a.wiki-link') as HTMLAnchorElement | null
  const destination = anchor?.dataset.target
  if (!destination) return
  event.preventDefault()
  getOpenPostForClicks()?.(destination)
}

defineExpose({ el: articleEl })
</script>

<template>
  <div v-if="error" class="render-error">{{ error }}</div>
  <component
    :is="tag"
    v-else
    ref="articleEl"
    class="article"
    :class="mode"
    v-html="html"
    @click="onArticleClick"
  />
</template>
