<script setup lang="ts">
// Distraction-free reading surface used when the vault is in read mode.
// Same markdown pipeline as PreviewPane (so frontmatter title handling
// and render errors stay consistent), presented in a centered single
// column with reading-friendly typography, plus a sticky right-side
// page navigation (à la VitePress) that highlights the section the
// reader is currently in.

import { toRef, ref, computed, watch, onBeforeUnmount } from 'vue'
import { useMarkdownRender } from '../../composables/vault/useMarkdownRender'

const props = defineProps<{ raw: string }>()
const { html, error: renderError, headings } = useMarkdownRender(toRef(props, 'raw'))

/* True when the active document is empty (no tabs opened, or the
   current tab is still loading). We render a soft placeholder instead
   of a blank centered pane. */
const isEmpty = computed(() => !props.raw || !props.raw.trim())

/* ----- Right-side page navigation (scroll spy) -----
   We observe the article's h2/h3/h4 elements with IntersectionObserver.
   The observer's root is the .reading-pane scroll container, and we
   shrink its effective rect with a negative bottom rootMargin so a
   heading only "intersects" when it crosses near the top of the
   visible area. The active section is the topmost currently-intersecting
   heading in document order; if none intersect (e.g. user scrolled past
   every heading in view), we fall back to the last-seen id. */

const articleEl = ref<HTMLElement | null>(null)
const readingPaneEl = ref<HTMLElement | null>(null)
const activeId = ref<string>('')

let observer: IntersectionObserver | null = null
const intersecting = new Set<Element>()

function disconnectObserver() {
  if (observer) { observer.disconnect(); observer = null }
  intersecting.clear()
}

/* Build the observer once the article is in the DOM and the headings
   have been resolved. The article ref populates on mount, and headings
   populate async (after the render), so we watch both and re-attach
   the observer when either changes. */
function attachObserver() {
  disconnectObserver()
  if (!articleEl.value || !readingPaneEl.value || headings.value.length === 0) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) intersecting.add(entry.target)
        else intersecting.delete(entry.target)
      }
      if (intersecting.size > 0) {
        /* Pick the topmost (smallest top within the scroll container)
           currently-intersecting heading. */
        const els = Array.from(intersecting) as HTMLElement[]
        els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        const top = els[0]
        if (top && top.id) activeId.value = top.id
      }
    },
    {
      root: readingPaneEl.value,
      /* Trigger line sits ~10% from the top of the reading pane — a
         heading becomes "active" once its top crosses that line. The
         negative bottom margin means headings way down the page don't
         count just because they're on screen. */
      rootMargin: '0px 0px -85% 0px',
      threshold: 0,
    },
  )
  for (const h of headings.value) {
    const el = articleEl.value.querySelector<HTMLElement>(`#${cssEscape(h.id)}`)
    if (el) observer.observe(el)
  }
  /* If the article is short enough that no heading is near the top,
     pick the first heading as a sensible default. */
  if (!activeId.value && headings.value[0]) activeId.value = headings.value[0].id
}

/* The slugify in ../../lib/markdown.ts allows CJK characters, which
   are valid in HTML id attributes but invalid as bare CSS selectors.
   Escape them so querySelector('#xxx') works. */
function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id)
  return id.replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1')
}

/* Click handler: smooth-scroll the target heading into view inside
   the .reading-pane (which is the scroll container — not the window).
   Prevent the default anchor jump so we control the scroll behavior
   and the resulting :target style. */
function onTocClick(e: MouseEvent, id: string) {
  if (!articleEl.value) return
  const target = articleEl.value.querySelector<HTMLElement>(`#${cssEscape(id)}`)
  if (!target) return
  e.preventDefault()
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  /* Update the hash without triggering a navigation; a subsequent
     observer tick will set activeId to the clicked id. */
  if (history.replaceState) history.replaceState(null, '', `#${id}`)
  activeId.value = id
}

watch([articleEl, readingPaneEl, headings], () => attachObserver(), { flush: 'post' })
watch(() => props.raw, () => { activeId.value = '' })
onBeforeUnmount(disconnectObserver)
</script>

<template>
  <div ref="readingPaneEl" class="reading-pane">
    <div v-if="isEmpty" class="reading-empty">
      未打开文件。在侧栏选一个或按 <kbd>⌘P</kbd> 新建。
    </div>
    <div v-else-if="renderError" class="render-error">{{ renderError }}</div>
    <div v-else class="reading-layout">
      <article ref="articleEl" class="article reading" v-html="html" />
      <aside v-if="headings.length" class="reading-toc" aria-label="页面导航">
        <h2 class="reading-toc-title">页面导航</h2>
        <ul class="reading-toc-list">
          <li
            v-for="h in headings"
            :key="h.id"
            :class="['reading-toc-item', `lvl-${h.level}`, { active: activeId === h.id }]"
          >
            <a :href="`#${h.id}`" @click="onTocClick($event, h.id)">{{ h.text }}</a>
          </li>
        </ul>
      </aside>
    </div>
  </div>
</template>
