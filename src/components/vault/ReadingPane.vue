<script setup lang="ts">
// Distraction-free reading surface used when the vault is in read mode.
// Same markdown pipeline as PreviewPane (so frontmatter title handling
// and render errors stay consistent), presented in a centered single
// column with reading-friendly typography.
//
// Page navigation (TOC) has been extracted to TocPanel.vue — a separate
// vault grid column on the left. This component still owns the
// IntersectionObserver scroll-spy and publishes heading state via
// useTocState so TocPanel can render the active-highlighted list.

import { ref, computed, watch, onBeforeUnmount } from 'vue'
import RenderedMarkdown from './RenderedMarkdown.vue'
import type { Heading } from '../../composables/vault/useMarkdownRender'
import { tocHeadings, tocActiveId, tocScrollTo } from '../../composables/vault/useTocState'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'

const props = defineProps<{
  raw: string
  /** Resolver for [[wiki]] / [t](path.md) links. See PreviewPane. */
  resolver?: WikiResolver
}>()
const headings = ref<Heading[]>([])

/* True when the active document is empty (no tabs opened, or the
   current tab is still loading). We render a soft placeholder instead
   of a blank centered pane. */
const isEmpty = computed(() => !props.raw || !props.raw.trim())

/* ----- Scroll-spy for TocPanel ----------
   We observe the article's h2/h3/h4 elements with IntersectionObserver.
   The observer's root is the .reading-pane scroll container, and we
   shrink its effective rect with a negative bottom rootMargin so a
   heading only "intersects" when it crosses near the top of the
   visible area.

   The active section is the heading whose top is *closest to (but
   still above) the trigger line* — i.e. the last heading the reader
   has scrolled past. This is the VitePress behavior and matches what
   users expect: while reading a section, the section title is what's
   highlighted, not the next one.

   The active-id and heading list are published to useTocState so the
   TocPanel (a sibling in the vault grid) renders them. */

const articleEl = ref<HTMLElement | null>(null)
const readingPaneEl = ref<HTMLElement | null>(null)

let observer: IntersectionObserver | null = null

/* After a TOC click, the user-initiated smooth scroll fires many
   IntersectionObserver ticks on the way down. Without a freeze the
   active state would flicker across whatever intermediate sections
   the scroll passes through. We pin the active id for one frame
   after a click; the observer resumes driving the highlight when
   the freeze lifts. */
let freezeActiveUntil = 0

function disconnectObserver() {
  if (observer) { observer.disconnect(); observer = null }
}

function getHeadingEls(): HTMLElement[] {
  if (!articleEl.value) return []
  const out: HTMLElement[] = []
  for (const h of headings.value) {
    const el = articleEl.value.querySelector<HTMLElement>(`#${cssEscape(h.id)}`)
    if (el) out.push(el)
  }
  return out
}

function pickActiveId(els: HTMLElement[]): string {
  if (els.length === 0) return ''
  const container = readingPaneEl.value
  if (!container) return els[0].id
  const triggerY = container.getBoundingClientRect().top + 16
  let active = els[0]
  for (const el of els) {
    if (el.getBoundingClientRect().top <= triggerY) active = el
    else break
  }
  return active.id
}

/* Build the observer once the article is in the DOM and the headings
   have been resolved. Publishes the active heading id to the shared
   tocActiveId ref so TocPanel can highlight it. */
function attachObserver() {
  disconnectObserver()
  if (!articleEl.value || !readingPaneEl.value || headings.value.length === 0) return
  const els = getHeadingEls()
  if (els.length === 0) return
  observer = new IntersectionObserver(
    () => {
      if (Date.now() < freezeActiveUntil) return
      tocActiveId.value = pickActiveId(els)
    },
    {
      root: readingPaneEl.value,
      rootMargin: '0px 0px -60% 0px',
      threshold: 0,
    },
  )
  for (const el of els) observer.observe(el)
  if (!tocActiveId.value) tocActiveId.value = pickActiveId(els)
}

/* The slugify in ../../lib/markdown.ts allows CJK characters, which
   are valid in HTML id attributes but invalid as bare CSS selectors.
   Escape them so querySelector('#xxx') works. */
function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id)
  return id.replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1')
}

/* Scroll-to handler published to TocPanel via tocScrollTo. Smooth-scrolls
   the target heading into view inside the .reading-pane scroll container. */
function scrollToHeading(id: string) {
  if (!articleEl.value) return
  const target = articleEl.value.querySelector<HTMLElement>(`#${cssEscape(id)}`)
  if (!target) return
  freezeActiveUntil = Date.now() + 800
  tocActiveId.value = id
  const pane = readingPaneEl.value
  if (pane) {
    const paneRect = pane.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const top = targetRect.top - paneRect.top + pane.scrollTop
    pane.scrollTo({ top, behavior: 'smooth' })
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  if (history.replaceState) history.replaceState(null, '', `#${id}`)
}

/* Publish heading state to the shared module. TocPanel reads these
   refs to render the navigation list. We publish immediately on each
   render and reset on unmount so a stale document's TOC doesn't linger
   when switching away from read mode. */
watch(headings, (h) => { tocHeadings.value = h }, { immediate: true })
tocScrollTo.value = scrollToHeading

onBeforeUnmount(() => {
  disconnectObserver()
  tocHeadings.value = []
  tocActiveId.value = ''
  tocScrollTo.value = null
})

watch([articleEl, readingPaneEl, headings], () => attachObserver(), { flush: 'post' })
watch(() => props.raw, () => {
  /* Reset published state so the TocPanel doesn't keep rendering the
     previous document's heading list during the brief render window
     of the new one. useMarkdownRender's onWatcherCleanup also guards
     against an in-flight render clobbering the new result. */
  tocHeadings.value = []
  tocActiveId.value = ''
  freezeActiveUntil = 0
})
</script>

<template>
  <div ref="readingPaneEl" class="reading-pane">
    <div v-if="isEmpty" class="reading-empty">
      未打开文件。在侧栏选一个或按 <kbd>⌘P</kbd> 新建。
    </div>
    <div v-else class="reading-layout">
      <RenderedMarkdown
        :raw="raw"
        :resolver="resolver"
        tag="article"
        mode="reading"
        @update:headings="headings = $event"
        @rendered="articleEl = $event"
      />
    </div>
  </div>
</template>
