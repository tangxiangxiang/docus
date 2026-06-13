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
//
// Theme integration: we use mermaid's built-in `default` and
// `dark` themes (the only stable surface for color tokens).
// Earlier we passed a custom `themeVariables` map to rebind
// specific keys to docus tokens, but unknown keys in
// `themeVariables` interact badly with mermaid's internal
// layout and can produce `<g transform="translate(NaN,NaN) …">`
// in the output. The safer path is: ship mermaid's two built-in
// themes and override their actual color values via CSS in
// style.css (e.g. targeting the generated svg's `fill` /
// `stroke` rules).

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
   `mermaid` is typed loosely because the published typings
   don't surface all of the d.ts we use. */
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

/* Mermaid's layout occasionally emits
   `transform="translate(NaN,NaN) …"` in its output. The browser
   then logs
     <g> attribute transform: Expected number, "translate(NaN,NaN) scale(N…"
   when parsing the svg. This is NOT a JS throw — mermaid.render
   returns the string and the warning surfaces from the svg
   parser, so a try/catch around render() does nothing. The
   fix is a defense in depth:

     1. Don't call render() on a 0-sized container — the layout
        engine needs real dimensions to compute positions. We
        check both `getBoundingClientRect()` (which catches
        transform-scaled ancestors) and `clientWidth` (which is
        cheap).
     2. Defer the first render one rAF so layout has settled.
     3. Detect NaN in the returned svg string and refuse to
        inject the broken svg; show a friendly error instead.

   A ResizeObserver re-runs render() once the container gets a
   real size (tab switch, split toggle, window resize). */
let resizeObserver: ResizeObserver | null = null
let rafId = 0

function hasNonZeroSize(): boolean {
  const el = containerRef.value
  if (!el) return false
  /* jsdom doesn't implement layout; both getters return 0 in
     tests. The real-browser case is 0 (hidden) or >0 (visible)
     — never NaN — so `> 0` is a clean gate. */
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && el.clientWidth > 0
}

function scheduleRender() {
  /* Coalesce: a theme toggle + a code edit landing in the same
     tick should produce one render, not two.

     Two rAFs in a row, not one. The first rAF lets the current
     frame's JS settle (e.g. the theme ref's downstream effects
     have finished mutating the DOM); the second rAF lets the
     browser commit the resulting paint. mermaid's layout engine
     reads the document at render time — if we run on the same
     frame the theme was toggled, the layout sees a half-painted
     state and produces `<g transform="translate(NaN,NaN) …">`.
     A double rAF puts the render in a fresh frame AFTER the
     paint, which is what the size gate alone can't do. */
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = requestAnimationFrame(() => {
      rafId = 0
      void render()
    })
  })
}

async function render() {
  if (!containerRef.value) return
  if (!hasNonZeroSize()) return
  renderError.value = null
  /* `document.fonts.ready` resolves once all currently-loading
     fonts have loaded. Mermaid measures text via the canvas
     during layout; if a font with non-Latin glyphs (e.g. the
     system Chinese font used by the demo) hasn't loaded yet,
     the measurement returns 0 width and downstream positions
     can come out as NaN. We race with a 500ms timeout because
     some environments (jsdom, browsers that hang on a missing
     font) never resolve this promise — we'd rather render with
     a stale font metric than block forever. */
  if (typeof document !== 'undefined' && (document as Document).fonts && typeof (document as Document).fonts.ready?.then === 'function') {
    await Promise.race([
      (document as Document).fonts.ready.catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 500)),
    ])
  }
  try {
    const mermaid = await getMermaid()
    mermaid.initialize({
      startOnLoad: false,
      theme: theme.value === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
    })
    /* mermaid needs a unique id per render — it appends to
       `dompurify`-scrubbed nodes and the previous `<svg id="...">`
       still being in the document would collide. Date.now() is
       fine because we only ever have a handful of widgets.

       We retry up to 3 times if the layout produces NaN. The
       retry path is mostly defensive: in practice the
       combination of size-gate + double-rAF + fonts.ready
       should yield a clean svg on the first try. The retry
       exists for the rare case where mermaid's internal d3
       simulation gets a bad initial RNG seed and the first
       layout iteration produces degenerate positions; the
       second pass uses a different id so the module-level
       cache is fresh. */
    let svg = ''
    let bindFns: ((el: HTMLElement) => void) | undefined
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const id = `mermaid-${++mermaidRenderCount}-${Date.now()}-${attempt}`
      const result = await mermaid.render(id, props.code)
      svg = typeof result === 'string' ? result : result.svg
      if (typeof result === 'object') bindFns = result.bindFunctions
      if (!/translate\(NaN/.test(svg)) break
      /* else: try again with a fresh id */
    }
    if (/translate\(NaN/.test(svg)) {
      renderError.value = 'mermaid 布局异常（容器未正确布局或图表含无效字符），请稍后重试'
      /* Leave the container empty so the broken svg never
         reaches the parser. */
      containerRef.value.innerHTML = ''
      return
    }
    containerRef.value.innerHTML = svg
    /* bindFunctions wires up click handlers / tooltips for
       interactive diagrams (e.g. classDiagram clickable nodes).
       We use the bindFns from the successful attempt — the
       loop variable always reflects the last iteration. */
    if (bindFns && containerRef.value) bindFns(containerRef.value)
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
  /* Block layout with `text-align: center` (rather than flex)
     so the svg's intrinsic width is preserved — a flex
     container can collapse a single svg child to 0 if the
     svg has no explicit width attribute, which feeds mermaid
     a 0×0 box and produces the `translate(NaN, NaN)` svg. */
  display: block;
  text-align: center;
  width: 100%;
  /* Safety net: even if the host hasn't been laid out yet,
     this gives mermaid a real height to work with. */
  min-height: 120px;
}
.mermaid-svg :deep(svg) {
  display: inline-block;
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
