<script setup lang="ts">
// Interactive markmap widget. Mounted by useMarkmapMount into the
// position of a `.markmap-mount` placeholder emitted by the
// ```markmap``` fence rule in src/lib/markdown.ts.
//
// Mirrors the reference VitePress component (controls: reset, fullscreen)
// but takes its colors from the docus light/dark theme via a small
// palette.
//
// Theme switch: when `theme` flips, we tear down the current markmap
// instance and create a new one on the SAME svg. We deliberately do
// NOT key the svg — that would only swap the DOM element while the
// markmap instance (and its d3 listeners) stayed alive pointing at a
// detached svg, which is what the previous `:key` approach did.
// Keeping the svg stable also means fullscreen state on the wrapper
// survives a theme flip.

import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useTheme } from '../composables/useTheme'

const props = defineProps<{
  /** Source markdown the Transformer should parse. */
  content: string
}>()

const { theme } = useTheme()
const wrapperRef = ref<HTMLDivElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const isFullscreen = ref(false)
const mountError = ref<string | null>(null)
/* Pan/zoom gate. Default is locked — the markmap is read-only out of
   the box; the user has to click the toolbar lock to drag/zoom it.
   The lock is *pan/zoom*, not node-level drag, because markmap
   itself doesn't expose a node-drag handler (it only pans the
   canvas). The d3 listeners consult this option on every pointer
   event, so flipping it via setOptions() takes effect mid-gesture
   on the next event tick. */
const isLocked = ref(true)

/* Light/dark palettes for the markmap node-link tree. The colors
   mirror the project's accent (`--vs-accent`) and a small
   ramp off it; we keep saturation high enough that adjacent
   nodes are easy to tell apart. */
const PALETTES: Record<'light' | 'dark', string[]> = {
  light: ['#005fb8', '#1f8ad2', '#0a7e3a', '#b45309', '#a21caf', '#dc2626'],
  dark:  ['#7dd3fc', '#a5b4fc', '#86efac', '#fcd34d', '#f0abfc', '#fca5a5'],
}

function currentPalette(): string[] {
  return PALETTES[theme.value] ?? PALETTES.light
}

/* markmap's `color` callback receives a node and returns the single
   color for that node's link/fill. We hash the node's text into the
   palette so siblings of different labels land on different colors.
   The function reads the *current* theme's palette on every call, so
   after a theme switch + remount the new colors take effect. */
function colorForNode(_node: unknown): string {
  const palette = currentPalette()
  const paletteIndex = Math.abs(hashStr(String((_node as { content?: string })?.content ?? ''))) % palette.length
  return palette[paletteIndex]
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

interface MmInstance { destroy?: () => void; fit?: () => void }
let mm: MmInstance | null = null

/* `mountMarkmap` is idempotent: it tears down any previous instance
   on the same svg before building a new one. We chain pending mounts
   with a single-flight guard so a fast theme toggle (or a watch
   firing before the first mount finishes) doesn't race two markmaps
   onto the same svg. */
let mountPromise: Promise<void> | null = null
let pendingRemount = false

async function mountMarkmap() {
  if (mountPromise) {
    /* Another mount is in flight; queue a follow-up so the *latest*
       theme wins instead of whichever finishes first. */
    pendingRemount = true
    return mountPromise
  }
  mountPromise = (async () => {
    /* svgRef may not be bound yet if the watcher fires between
       component setup and the first onMounted — `onMounted` retries
       us right after the svg is attached. */
    const svg = svgRef.value
    if (!svg) return
    mountError.value = null
    /* Drop the previous instance and any svg children it appended.
       Destroying is the only way to detach d3's mouse listeners;
       just calling mm.fit() with new opts wouldn't re-tint existing
       link strokes (markmap caches the resolved color per node). */
    mm?.destroy?.()
    mm = null
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    try {
      const [{ Transformer }, { Markmap, loadCSS, loadJS, deriveOptions }] =
        await Promise.all([import('markmap-lib'), import('markmap-view')])
      /* If the article was re-rendered while we were awaiting
         imports (e.g. the user switched documents in the vault),
         the host is no longer in the document — v-html has
         already replaced the article body. The captured `svg`
         is detached but still has child nodes we just cleared
         in the lines above. Running Markmap.create on a detached
         svg starts d3's force simulation on a ghost element and
         produces `<g transform="translate(NaN,NaN) …">`, which
         the browser logs as

           <g> attribute transform: Expected number, "translate(NaN,NaN) scale(N…"

         The fix is to bail out as soon as we notice the svg
         has been detached. The new widget for the next document
         will get its own mountMarkmap call from its own onMounted;
         this one is finished. */
      if (!svg.isConnected) return
      const transformer = new Transformer()
      const { root, features } = transformer.transform(props.content)
      const { styles, scripts } = transformer.getUsedAssets(features)
      if (styles) loadCSS(styles)
      if (scripts) loadJS(scripts, { getMarkmap: () => ({ Markmap, deriveOptions }) })
      if (!svg.isConnected) return
      mm = Markmap.create(svg, {
        autoFit: true,
        color: colorForNode,
        pan: !isLocked.value,
        zoom: !isLocked.value,
      }, root) as unknown as MmInstance
    } catch (e) {
      mountError.value = (e as Error).message
    }
  })()
  try {
    await mountPromise
  } finally {
    mountPromise = null
    if (pendingRemount) {
      pendingRemount = false
      void mountMarkmap()
    }
  }
}

onMounted(() => {
  void mountMarkmap()
  document.addEventListener('fullscreenchange', onFullscreenChange)
  /* If the user entered fullscreen before mount finished, the
     document.fullscreenElement might already be our wrapper; reflect
     it into local state. */
  onFullscreenChange()
})

/* Theme flip → drop the old instance, build a new one on the same
   svg. The svg is kept stable (no :key) so wrapper-level state
   (fullscreen, scroll) survives. */
watch(theme, () => { void mountMarkmap() })

/* Lock toggle → flip pan/zoom in place. setOptions() updates markmap's
   internal option map and the next pointer event consults the new
   flags, so the user feels the change immediately. Falling back to
   a full rebuild is fine if a future markmap drops setOptions —
   the rebuild path is the one we already exercise on theme change. */
watch(isLocked, (locked) => {
  const inst = mm as (MmInstance & { setOptions?: (o: Record<string, unknown>) => void }) | null
  if (inst?.setOptions) {
    inst.setOptions({ pan: !locked, zoom: !locked })
  } else {
    void mountMarkmap()
  }
})

function toggleLock() {
  isLocked.value = !isLocked.value
}

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  mm?.destroy?.()
  mm = null
  /* Always exit fullscreen if WE are the fullscreen element, otherwise
     the browser keeps the body locked and the next mount looks broken. */
  if (document.fullscreenElement === wrapperRef.value) {
    void document.exitFullscreen().catch(() => { /* user denied; harmless */ })
  }
})

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === wrapperRef.value
}

async function toggleFullscreen() {
  if (!wrapperRef.value) return
  if (document.fullscreenElement) {
    await document.exitFullscreen()
  } else {
    await wrapperRef.value.requestFullscreen()
  }
  /* markmap caches its size; after the wrapper resizes we re-fit so
     the tree re-centers inside the new viewport. */
  mm?.fit?.()
}

function resetView() {
  mm?.fit?.()
}
</script>

<template>
  <div ref="wrapperRef" class="markmap-widget">
    <div v-if="mountError" class="markmap-error">
      思维导图加载失败:{{ mountError }}
    </div>
    <svg ref="svgRef" class="markmap-svg" />
    <div class="markmap-toolbar-area">
      <div class="markmap-toolbar">
        <button
          @click="toggleLock"
          :title="isLocked ? '解锁后可拖动' : '锁定后不可拖动'"
          :aria-label="isLocked ? '解锁后可拖动' : '锁定后不可拖动'"
          class="markmap-lock-btn"
          :data-locked="isLocked ? 'true' : 'false'"
        >
          <svg v-if="isLocked" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 9.9-1" />
          </svg>
        </button>
        <button @click="resetView" title="重置视图" aria-label="重置视图">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </button>
        <button
          @click="toggleFullscreen"
          :title="isFullscreen ? '退出全屏' : '全屏'"
          :aria-label="isFullscreen ? '退出全屏' : '全屏'"
        >
          <svg v-if="isFullscreen" width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
            <path d="M384 128h-85.33v170.67H128V384h256zM896 384v-85.33H725.33V128H640v256zM725.33 725.33H896V640H640v256h85.33zM298.67 896H384V640H128v85.33h170.67z" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
            <path d="M128 384h85.33V213.33H384V128H128zM640 128v85.33h170.67V384H896V128zM810.67 810.67H640V896h256V640h-85.33zM213.33 640H128v256h256v-85.33H213.33z" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.markmap-widget {
  /* No outer frame — the markmap floats on the article background.
     `position: relative` is required for the absolute-positioned
     toolbar in the bottom-right; `overflow: hidden` clips the tree
     to the widget's box if a user pans past the edges. */
  position: relative;
  width: 100%;
  height: 480px;
  margin: 0;
  overflow: hidden;
}

.markmap-svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* The toolbar only reveals on hover so it doesn't compete with the
   graph for attention. Same pattern as the reference VitePress build. */
.markmap-toolbar-area {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.markmap-widget:hover .markmap-toolbar-area,
.markmap-toolbar-area:focus-within { opacity: 1; }

.markmap-toolbar {
  display: flex;
  gap: 4px;
  background: var(--vs-bg-1);
  border: 1px solid var(--vs-border);
  border-radius: 6px;
  padding: 2px;
}
.markmap-toolbar button {
  border: none;
  background: transparent;
  color: var(--vs-text-1);
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
}
.markmap-toolbar button:hover {
  background: var(--vs-hover-bg);
}

.markmap-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1em;
  color: var(--vs-text-2);
  font-size: 0.9em;
  text-align: center;
}

/* ---- markmap's own CSS variables, rebound to docus tokens ----
   markmap-view ships a stylesheet that sets --markmap-text-color
   to a hard-coded #333 and only flips to a light color when an
   ancestor has the `.markmap-dark` class. docus themes via
   `data-theme` instead, so the dark override never fires and the
   text is dark-gray on dark-gray in dark mode. We rebind the
   variables to docus tokens, which already follow data-theme. The
   link-stroke palette is controlled separately via the `color`
   option in Markmap.create — this only handles the *text* (and
   the few other things markmap hard-codes in CSS).

   The :deep() escape is necessary because markmap injects its
   inner <g class="markmap"> at runtime — those elements don't
   have Vue's [data-v-xxx] scope attribute, so a normal scoped
   selector wouldn't match them. */
.markmap-widget :deep(.markmap) {
  --markmap-text-color: var(--vs-text-1);
  --markmap-a-color: var(--vs-accent);
  --markmap-a-hover-color: var(--vs-accent-hover);
  --markmap-code-bg: var(--vs-bg-1);
  --markmap-code-color: var(--vs-text-1);
  --markmap-highlight-bg: var(--vs-active-bg);
}
</style>
