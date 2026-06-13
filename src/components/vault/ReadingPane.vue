<script setup lang="ts">
// Distraction-free reading surface used when the vault is in read mode.
// Same markdown pipeline as PreviewPane (so frontmatter title handling
// and render errors stay consistent), presented in a centered single
// column with reading-friendly typography, plus a sticky right-side
// page navigation (à la VitePress) that highlights the section the
// reader is currently in.

import { toRef, ref, computed, watch, onBeforeUnmount } from 'vue'
import { useMarkdownRender } from '../../composables/vault/useMarkdownRender'
import { useMarkmapMount } from '../../composables/useMarkmapMount'
import { useMermaidMount } from '../../composables/useMermaidMount'
import { getOpenPostForClicks } from '../../composables/vault/useEditorTabs'
import type { Resolver as WikiResolver } from '../../lib/wikiLinks'

const props = defineProps<{
  raw: string
  /** Resolver for [[wiki]] / [t](path.md) links. See PreviewPane. */
  resolver?: WikiResolver
}>()
const { html, error: renderError, headings } = useMarkdownRender(toRef(props, 'raw'), props.resolver)

/* Same delegated click handler as PreviewPane. Mounted on .article
   so the right-side page-nav (.reading-toc) keeps its own click
   handling. */
function onArticleClick(e: MouseEvent) {
  if (e.button !== 0) return
  const target = e.target as HTMLElement | null
  const a = target?.closest('a.wiki-link') as HTMLAnchorElement | null
  if (!a) return
  const dest = a.dataset.target
  if (!dest) return
  e.preventDefault()
  getOpenPostForClicks()?.(dest)
}

/* True when the active document is empty (no tabs opened, or the
   current tab is still loading). We render a soft placeholder instead
   of a blank centered pane. */
const isEmpty = computed(() => !props.raw || !props.raw.trim())

/* ----- Right-side page navigation (scroll spy) -----
   We observe the article's h2/h3/h4 elements with IntersectionObserver.
   The observer's root is the .reading-pane scroll container, and we
   shrink its effective rect with a negative bottom rootMargin so a
   heading only "intersects" when it crosses near the top of the
   visible area.

   The active section is the heading whose top is *closest to (but
   still above) the trigger line* — i.e. the last heading the reader
   has scrolled past. This is the VitePress behavior and matches what
   users expect: while reading a section, the section title is what's
   highlighted, not the next one. We fall back to the first heading
   on short docs and to the last heading when the reader scrolls past
   the final section. */

const articleEl = ref<HTMLElement | null>(null)
const readingPaneEl = ref<HTMLElement | null>(null)
const activeId = ref<string>('')

/* Mount ```markmap``` and ```mermaid``` placeholders as live widgets
   (same pipeline as PreviewPane — the article is the same v-html
   surface, just with a different surrounding layout). */
useMarkmapMount(articleEl)
useMermaidMount(articleEl)

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
  /* The "trigger line" sits near the top of the reading pane. A
     heading is considered "above the trigger" once its top has
     scrolled past it. We bias the line down a touch (16px) so the
     active state updates right as the next heading reaches the top,
     not while it's still half-visible from above. */
  const triggerY = container.getBoundingClientRect().top + 16
  /* The headings are in document order, so the *last* heading whose
     top is <= triggerY is the one the reader is currently in. If no
     heading is past the trigger yet (e.g. we're still above the
     first h2), highlight the first heading. */
  let active = els[0]
  for (const el of els) {
    if (el.getBoundingClientRect().top <= triggerY) active = el
    else break
  }
  return active.id
}

/* Build the observer once the article is in the DOM and the headings
   have been resolved. The article ref populates on mount, and headings
   populate async (after the render), so we watch both and re-attach
   the observer when either changes. */
function attachObserver() {
  disconnectObserver()
  if (!articleEl.value || !readingPaneEl.value || headings.value.length === 0) return
  const els = getHeadingEls()
  if (els.length === 0) return
  /* The IntersectionObserver itself is only used to *trigger* a recompute
     on each scroll-ish tick — the actual active id is chosen from the
     full heading list above. Using the observer as a "something moved"
     signal lets us avoid a per-frame scroll listener and keeps the
     active state correct even when a heading never intersects the
     trigger zone (e.g. user scrolls fast and skips a whole region). */
  observer = new IntersectionObserver(
    () => {
      if (Date.now() < freezeActiveUntil) return
      activeId.value = pickActiveId(els)
    },
    {
      root: readingPaneEl.value,
      /* The observer's job is to fire when *any* heading enters or
         leaves the area near the top of the pane. The negative bottom
         margin shrinks the effective rect so headings way down the
         page (still on screen but below the trigger) don't count. */
      rootMargin: '0px 0px -60% 0px',
      threshold: 0,
    },
  )
  for (const el of els) observer.observe(el)
  /* If the article is short enough that no heading ever crosses the
     trigger zone, or the observer hasn't ticked yet, seed a sensible
     default so the TOC isn't unhighlighted. */
  if (!activeId.value) activeId.value = pickActiveId(els)
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
  /* Pin the active id through the smooth-scroll animation. Smooth
     scrolling on a long doc can take ~600ms; 800ms is a safe upper
     bound for typical content. If the user scrolls again mid-flight
     we want the observer to resume — so we *extend* (not replace)
     the freeze each time the observer would otherwise tick. */
  freezeActiveUntil = Date.now() + 800
  activeId.value = id
  /* Scroll the .reading-pane explicitly instead of letting
     scrollIntoView cascade up the ancestor chain. When the body
     is overflow:hidden but its content is 1-2px taller than the
     viewport, scrollIntoView would otherwise set bodyScrollTop
     and shift the entire layout under the sticky navbar — which
     makes the active-tab bar visually disappear until the next
     layout pass. Scrolling the reading-pane directly keeps the
     body locked. */
  const pane = readingPaneEl.value
  if (pane) {
    const paneRect = pane.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const top = targetRect.top - paneRect.top + pane.scrollTop
    pane.scrollTo({ top, behavior: 'smooth' })
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  /* Update the hash without triggering a navigation; a subsequent
     observer tick will set activeId to the clicked id. */
  if (history.replaceState) history.replaceState(null, '', `#${id}`)
}

watch([articleEl, readingPaneEl, headings], () => attachObserver(), { flush: 'post' })
watch(() => props.raw, () => {
  activeId.value = ''
  freezeActiveUntil = 0
})
onBeforeUnmount(disconnectObserver)
</script>

<template>
  <div ref="readingPaneEl" class="reading-pane">
    <div v-if="isEmpty" class="reading-empty">
      未打开文件。在侧栏选一个或按 <kbd>⌘P</kbd> 新建。
    </div>
    <div v-else-if="renderError" class="render-error">{{ renderError }}</div>
    <div v-else class="reading-layout">
      <article ref="articleEl" class="article reading" v-html="html" @click="onArticleClick" />
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
