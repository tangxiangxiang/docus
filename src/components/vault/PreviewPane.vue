<script setup lang="ts">
import { ref } from 'vue'
import RenderedMarkdown from './RenderedMarkdown.vue'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'

const props = defineProps<{
  raw: string
  /** Resolver for [[wiki]] / [t](path.md) links. Omit to render
   *  with the identity (as-written) resolver — useful for tests
   *  and for any caller that doesn't have a link index loaded. */
  resolver?: WikiResolver
}>()

const articleEl = ref<HTMLElement | null>(null)

/* Expose the article element so the parent's edit-mode scroll-sync
   composable can identify the rendered body. Note: the actual
   scroll container is the .preview-pane wrapper (overflow:auto in
   style.css under .vault scope, plus min-height:100% on .article
   means the article itself never has internal overflow). We expose
   articleEl here only for symmetry with EditorPane's getScrollEl;
   the composable queries .preview-pane directly. Kept on the
   component for now in case future tooling needs the rendered
   root. */
defineExpose({
  el: articleEl,
})
</script>

<template>
  <RenderedMarkdown
    :raw="raw"
    :resolver="resolver"
    @rendered="articleEl = $event"
  />
</template>
