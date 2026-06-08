<script setup lang="ts">
import { toRef } from 'vue'
import { useMarkdownRender } from '../../composables/vault/useMarkdownRender'
import { getOpenPostForClicks } from '../../composables/vault/useEditorTabs'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'

const props = defineProps<{
  raw: string
  /** Resolver for [[wiki]] / [t](path.md) links. Omit to render
   *  with the identity (as-written) resolver — useful for tests
   *  and for any caller that doesn't have a link index loaded. */
  resolver?: WikiResolver
}>()

const { html, error: renderError } = useMarkdownRender(toRef(props, 'raw'), props.resolver)

/* Delegated click handler for wiki-link anchors. We mount this on
   the .article root (not on VaultView) so it only catches links
   inside the rendered article body — the right-rail TOC, the
   header-anchor permalinks, etc. are not affected. Middle-click /
   cmd-click / right-click fall through to the browser because we
   only preventDefault on the primary button for resolved links. */
function onArticleClick(e: MouseEvent) {
  if (e.button !== 0) return  // primary button only
  const target = e.target as HTMLElement | null
  const a = target?.closest('a.wiki-link') as HTMLAnchorElement | null
  if (!a) return
  const dest = a.dataset.target
  if (!dest) return  // missing target — let the browser handle href="#"
  e.preventDefault()
  getOpenPostForClicks()?.(dest)
}
</script>

<template>
  <div v-if="renderError" class="render-error">{{ renderError }}</div>
  <div v-else class="article preview" v-html="html" @click="onArticleClick" />
</template>
