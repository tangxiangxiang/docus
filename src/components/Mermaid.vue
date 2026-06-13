<script setup lang="ts">
// Interactive mermaid diagram. Mounted by useMermaidMount into the
// position of a `.mermaid-mount` placeholder emitted by the
// ```mermaid``` fence rule in src/lib/markdown.ts.
//
// Mirrors the reference VitePress component but takes its theme
// from the docus `useTheme` composable instead of polling the
// `dark` class on <html> — docus themes via `data-theme` and we
// already have a reactive `theme` ref for it. mermaid itself is
// async (it lazy-loads per-diagram-type layout engines on first
// render), so we dynamic-import the module once and keep a
// per-component `isDark` flag for the latest theme handed to
// `mermaid.initialize`.
//
// We deliberately do NOT use mermaid's `run()` global API — it
// looks for `.mermaid` selectors in the document and re-renders
// everything. We want per-instance control so a theme switch only
// re-renders the widget the user is looking at.

import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useTheme } from '../composables/useTheme'

const props = defineProps<{
  /** Source mermaid syntax the renderer should parse. */
  code: string
}>()

const { theme } = useTheme()
const containerRef = ref<HTMLDivElement | null>(null)
const renderError = ref<string | null>(null)

/* Module-scope so we only pay the dynamic-import + JSDOM
   initialization once across all mermaid widgets on the page.
   `mermaid` is typed loosely because the published typings don't
   surface the `themeVariables` overload we use for docus token
   rebinding — see MERMAID_THEME_VARS below. */
let mermaidModule: { default: MermaidNS } | null = null
let mermaidRenderCount = 0

interface MermaidRenderResult { svg: string; bindFunctions?: (el: HTMLElement) => void }
interface MermaidNS {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, code: string) => Promise<MermaidRenderResult | string>
}

async function getMermaid(): Promise<MermaidNS> {
  if (!mermaidModule) {
    mermaidModule = await import('mermaid')
  }
  return mermaidModule.default
}

/* Light/dark theme variable overrides. mermaid exposes a `themeVariables`
   object on its initialize() config — keys map 1:1 to mermaid's
   internal CSS variables. We rebind the ones that ship as hard
   hexes in the default palette so the diagram tracks docus
   tokens. The full variable list lives in mermaid's
   themeVariables type; the ones we override here are the ones
   that visibly clash with a dark background in dark mode. */
function themeVars(): Record<string, string> {
  if (theme.value === 'dark') {
    return {
      background: 'transparent',
      primaryColor: '#1f2937',
      primaryTextColor: '#e5e7eb',
      primaryBorderColor: '#374151',
      lineColor: '#9ca3af',
      secondaryColor: '#111827',
      tertiaryColor: '#0b1220',
      noteBkgColor: '#1f2937',
      noteTextColor: '#e5e7eb',
      noteBorderColor: '#374151',
      actorBkg: '#1f2937',
      actorBorder: '#374151',
      actorTextColor: '#e5e7eb',
      actorLineColor: '#9ca3af',
      signalColor: '#e5e7eb',
      signalTextColor: '#e5e7eb',
      labelBoxBkgColor: '#1f2937',
      labelBoxBorderColor: '#374151',
      labelTextColor: '#e5e7eb',
      loopTextColor: '#e5e7eb',
    }
  }
  return {
    background: 'transparent',
    primaryColor: '#ffffff',
    primaryTextColor: '#1f2937',
    primaryBorderColor: '#d1d5db',
    lineColor: '#6b7280',
    secondaryColor: '#f3f4f6',
    tertiaryColor: '#f9fafb',
    noteBkgColor: '#fffbeb',
    noteTextColor: '#92400e',
    noteBorderColor: '#fcd34d',
    actorBkg: '#ffffff',
    actorBorder: '#d1d5db',
    actorTextColor: '#1f2937',
    actorLineColor: '#6b7280',
    signalColor: '#1f2937',
    signalTextColor: '#1f2937',
    labelBoxBkgColor: '#ffffff',
    labelBoxBorderColor: '#d1d5db',
    labelTextColor: '#1f2937',
    loopTextColor: '#1f2937',
  }
}

/* Mermaid's layout engine measures the container with
   getBoundingClientRect / clientWidth; if the host is 0×0 when
   render() runs (a hidden tab, a collapsed split, an unsplit
   vault preview), the math produces `translate(NaN, NaN)` in the
   output svg, which the browser then rejects with:

     <g> attribute transform: Expected number, "translate(NaN,NaN) scale(N…"

   The fix is a two-part gate: (1) defer the first render one
   animation frame so layout has settled, and (2) skip the
   render entirely if the container still has no width. A
   ResizeObserver re-runs render() once the container gets a
   real size (tab switch, split toggle, window resize). */
let resizeObserver: ResizeObserver | null = null
let rafId = 0

function hasNonZeroSize(): boolean {
  const el = containerRef.value
  if (!el) return false
  /* jsdom doesn't implement layout and returns 0 for clientWidth
     on every element. The real-browser case is: 0 (hidden) or
     >0 (visible) — never NaN. So `clientWidth > 0` is a clean
     gate. */
  return el.clientWidth > 0
}

function scheduleRender() {
  /* Coalesce: a theme toggle + a code edit landing in the same
     tick should produce one render, not two. The rAF also
     guarantees we're past the first paint, so clientWidth is
     accurate. */
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    void render()
  })
}

async function render() {
  if (!containerRef.value) return
  if (!hasNonZeroSize()) return
  renderError.value = null
  try {
    const mermaid = await getMermaid()
    mermaid.initialize({
      startOnLoad: false,
      theme: theme.value === 'dark' ? 'dark' : 'default',
      themeVariables: themeVars(),
      securityLevel: 'strict',
    })
    /* mermaid needs a unique id per render — it appends to
       `dompurify`-scrubbed nodes and the previous `<svg id="...">`
       still being in the document would collide. Date.now() is
       fine because we only ever have a handful of widgets. */
    const id = `mermaid-${++mermaidRenderCount}-${Date.now()}`
    const result = await mermaid.render(id, props.code)
    const svg = typeof result === 'string' ? result : result.svg
    containerRef.value.innerHTML = svg
    /* bindFunctions wires up click handlers / tooltips for
       interactive diagrams (e.g. classDiagram clickable nodes). */
    if (typeof result === 'object' && result.bindFunctions && containerRef.value) {
      result.bindFunctions(containerRef.value)
    }
  } catch (e) {
    renderError.value = (e as Error).message
    if (containerRef.value) {
      containerRef.value.innerHTML = `<pre class="mermaid-error-pre">${(e as Error).message}</pre>`
    }
  }
}

onMounted(() => {
  scheduleRender()
  /* ResizeObserver re-renders on visibility changes (tab switch,
     split open, accordion expand). It only fires scheduleRender
     when the container has a real size — a 0×0 tick during a
     collapse doesn't re-trigger a doomed render. Feature-detect:
     ResizeObserver may be missing in old test environments. */
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (hasNonZeroSize()) scheduleRender()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  resizeObserver?.disconnect()
  resizeObserver = null
  /* Clear the rendered svg so the DOMPurify-scrubbed nodes don't
     outlive the component (especially during HMR). */
  if (containerRef.value) containerRef.value.innerHTML = ''
})

/* Theme flip → re-render so the diagram re-tints. We go through
   scheduleRender so the render is gated on a non-zero size —
   a theme toggle while the widget is hidden (in a background
   tab) won't paint a broken svg. The ResizeObserver will
   re-trigger once the tab becomes visible. */
watch(theme, () => scheduleRender())

/* props.code change (e.g. the markdown source was edited) → re-
   render. */
watch(() => props.code, () => scheduleRender())
</script>

<template>
  <div class="mermaid-widget">
    <div ref="containerRef" class="mermaid-svg" />
    <div v-if="renderError" class="mermaid-error">
      图表渲染失败:{{ renderError }}
    </div>
  </div>
</template>

<style scoped>
.mermaid-widget {
  position: relative;
  width: 100%;
  margin: 0;
  padding: 0.75rem 0;
  /* Like the markmap, no outer frame — the diagram floats on the
     article background. `overflow-x: auto` lets wide diagrams
     (e.g. long sequence diagrams) scroll horizontally instead of
     breaking the article layout. */
  overflow-x: auto;
}

.mermaid-svg {
  display: flex;
  justify-content: center;
  width: 100%;
}
.mermaid-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}

.mermaid-error {
  color: var(--vs-text-2);
  font-size: 0.9em;
  text-align: center;
  padding: 0.5em;
}
:deep(.mermaid-error-pre) {
  color: #b91c1c;
  background: var(--vs-bg-1);
  border: 1px solid var(--vs-border);
  border-radius: 4px;
  padding: 0.6em 0.8em;
  font-size: 0.85em;
  white-space: pre-wrap;
  text-align: left;
  margin: 0;
}
</style>
