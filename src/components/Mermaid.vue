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
const wrapperRef = ref<HTMLDivElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const renderError = ref<string | null>(null)
/* Fullscreen toggle state. The browser owns the actual fullscreen
   bit on `document.fullscreenElement`; we just mirror it into a
   ref so the toolbar icon can flip between enter / exit and so
   the watch below doesn't have to touch the DOM. */
const isFullscreen = ref(false)

/* Per-instance cache so each widget only triggers the dynamic
   import once. The browser's module loader also caches by URL,
   so the actual cost on subsequent imports (different widget, or
   HMR after this instance is destroyed) is negligible — just a
   microtask. `mermaid` is typed loosely because the published
   typings don't surface all of the d.ts we use. */
let mermaidModule: { default: MermaidNS } | null = null
let mermaidRenderCount = 0

/* svg-pan-zoom: lazy-loaded only when the first diagram actually
   renders, so the library stays out of the main bundle. The
   shape mirrors `mermaidModule` — dynamic import → `{ default: fn }`.

   We track the active instance because re-renders happen on
   theme toggle, code edit, and ResizeObserver ticks. svg-pan-zoom
   attaches mousedown / wheel / touch listeners directly to the
   svg element; without an explicit destroy(), detaching the svg
   (via innerHTML = '') leaves those listeners alive on a
   detached node. The built-in control-icons cluster is disabled
   below so we don't have to worry about leftover icon DOM.

   The toolbar buttons (zoom in / out / reset / fullscreen) need
   a thin slice of the public API — the methods we list here are
   the only ones called from outside. `reset()` fits + centers in
   one call, which is what we want after a fullscreen toggle too. */
interface SvgPanZoomInstance {
  destroy: () => void
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  /* `resize()` re-measures the svg element's bounding rect and
     pushes the new dimensions into svg-pan-zoom's internal
     cache. svg-pan-zoom's other methods (reset, fit, …) read
     from that cache, not from the live DOM, so we have to call
     resize() before reset() whenever the svg's display size
     changes — currently that's just the fullscreen toggle. */
  resize: () => void
}
type SvgPanZoomFn = (svg: SVGSVGElement, opts?: Record<string, unknown>) => SvgPanZoomInstance
let panZoomModule: { default: SvgPanZoomFn } | null = null
let panZoomInstance: SvgPanZoomInstance | null = null

/* Render-generation counter. Incremented at the top of every
   render() pass. Captured by each pending getSvgPanZoom()
   callback so that a late resolution — which started against
   an svgEl that has since been wiped by a newer render — is
   discarded instead of binding a pan/zoom instance to a
   detached element. */
let renderGeneration = 0

/* `mermaid.initialize` mutates a process-global config object.
   `mermaid.render()` reads from that same global on every call.
   The init+render pair inside one render() pass is synchronous
   (render() itself returns a Promise that resolves after the
   layout completes), but the gap between the two is NOT — there
   are no awaits between initialize and render in the loop body,
   so a single widget can't race itself. The race we care about
   is between TWO widgets: A.initialize({theme:'dark'}) runs,
   the awaited `mermaid.render` inside A's pass suspends while
   mermaid's d3 layout computes, B.initialize({theme:'light'})
   runs during A's suspension, A's render resumes and reads the
   now-light global config and produces a light svg into a
   dark-themed widget.

   We can't synchronously pin the config for the duration of
   the async render — mermaid's API doesn't expose a per-call
   config — so we minimize the window. The fingerprint gate
   below keeps us from calling initialize() unnecessarily: when
   the same widget re-renders (theme toggle, code edit) into
   the same theme, we don't re-init at all, which is most of
   the time. The probe-then-restore dance in the NaN retry
   loop below also touches initialize and has to bypass the
   gate on purpose, so the gate is not a perfect fix — but it
   removes the dominant case (every render() re-initializing
   to the same value). */
let lastInitKey = ''

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

async function getSvgPanZoom(): Promise<SvgPanZoomFn> {
  if (!panZoomModule) {
    panZoomModule = (await import('svg-pan-zoom')) as unknown as { default: SvgPanZoomFn }
  }
  return panZoomModule.default
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
  /* Bump the generation at the top of every render so any
     pending getSvgPanZoom() callback from a previous render can
     detect it has been superseded and bail out. See the
     `renderGeneration` declaration above for the full rationale. */
  const myGen = ++renderGeneration
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
    const targetTheme = theme.value === 'dark' ? 'dark' : 'default'
    const initKey = `${targetTheme}|strict`
    /* Skip the global re-init when the fingerprint hasn't
       changed. mermaid.initialize is process-global; calling it
       unnecessarily just slows things down and (more
       importantly) races with sibling widgets' inits — see
       lastInitKey's declaration for the full story. */
    if (lastInitKey !== initKey) {
      mermaid.initialize({
        startOnLoad: false,
        theme: targetTheme,
        securityLevel: 'strict',
      })
      lastInitKey = initKey
    }
    /* mermaid needs a unique id per render — it appends to
       `dompurify`-scrubbed nodes and the previous `<svg id="...">`
       still being in the document would collide. Date.now() is
       fine because we only ever have a handful of widgets. */

    /* NaN retry: mermaid's internal d3 simulation sometimes
       produces `<g transform="translate(NaN,NaN) …">` on a
       bad RNG roll. Re-rendering with the same id / theme /
       code does NOT reseed the layout — d3 picks the same
       initial positions and NaNs out identically. The actual
       thing that shakes the seed loose is a different theme:
       mermaid rebuilds the layout config for the new theme
       and d3 starts from a fresh deterministic seed. We try
       the user's target theme first, and on NaN cycle
       through a small theme list so the retries genuinely
       differ. The final accepted render is in the user's
       target theme because we re-initialize with that theme
       once a clean svg lands (and the global lastInitKey is
       restored so the next render() on this widget sees the
       expected fingerprint).

       Filter targetTheme out of the probe list: a retry must
       never re-use the target theme's layout config, or the
       d3 seed is the same as attempt 0 and the NaN reproduces.
       Light mode (targetTheme='default') keeps all three
       candidates ['base','dark','neutral']; dark mode
       (targetTheme='dark') shrinks to ['base','neutral']. */
    const ALL_PROBE_THEMES = ['base', 'dark', 'neutral'] as const
    const PROBE_THEMES = ALL_PROBE_THEMES.filter((t) => t !== targetTheme)
    let svg = ''
    let bindFns: ((el: HTMLElement) => void) | undefined
    const MAX_ATTEMPTS = 3
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      /* First attempt: target theme. Subsequent attempts:
         probe themes in rotation, each one a different seed. */
      const themeForAttempt =
        attempt === 0
          ? targetTheme
          : PROBE_THEMES[(attempt - 1) % PROBE_THEMES.length]
      /* Each attempt needs mermaid to use a fresh layout seed.
         attempt=0 is the target theme, which we just initialized
         above — calling initialize again here is wasted work and
         also confuses the test that counts initialize calls
         (a render pass on a clean widget would emit two
         identical initialize calls for the same theme). On
         attempt > 0 we always re-initialize because the probe
         theme is different from the one the preceding init set
         (and from each other across attempts). The lastInitKey
         short-circuit from the top-of-function init is bypassed
         by writing lastInitKey here. */
      if (attempt > 0) {
        mermaid.initialize({
          startOnLoad: false,
          theme: themeForAttempt,
          securityLevel: 'strict',
        })
        lastInitKey = `${themeForAttempt}|strict`
      }
      const id = `mermaid-${++mermaidRenderCount}-${Date.now()}-${attempt}`
      const result = await mermaid.render(id, props.code)
      const attemptSvg = typeof result === 'string' ? result : result.svg
      /* Only adopt bindFns from a CLEAN attempt. Earlier code
         overwrote bindFns on every iteration, which had two
         failure modes: (1) a clean first attempt with
         bindFns followed by a NaN second attempt would
         attach the first attempt's bindFns to the broken
         second-attempt svg; (2) a clean first attempt with
         bindFns followed by a clean second attempt without
         bindFns would clobber the good ones. Bind functions
         only when the svg we're keeping is the one bindFns
         targets. */
      if (!/translate\(NaN/.test(attemptSvg)) {
        svg = attemptSvg
        if (typeof result === 'object' && result.bindFunctions) {
          bindFns = result.bindFunctions
        }
        /* Restore the user-facing theme before we exit, so a
           subsequent render() pass on this widget (theme
           toggle, code edit) sees lastInitKey === initKey and
           skips a redundant init. */
        if (themeForAttempt !== targetTheme) {
          mermaid.initialize({
            startOnLoad: false,
            theme: targetTheme,
            securityLevel: 'strict',
          })
          lastInitKey = initKey
        }
        break
      }
    }
    if (!svg || /translate\(NaN/.test(svg)) {
      /* Restore target theme even on total failure, so the
         global state doesn't end up stuck on a probe theme. */
      if (lastInitKey !== initKey) {
        mermaid.initialize({
          startOnLoad: false,
          theme: targetTheme,
          securityLevel: 'strict',
        })
        lastInitKey = initKey
      }
      renderError.value = '图表布局异常：容器未正确布局或图表含无效字符，请稍后重试'
      /* Leave the container empty so the broken svg never
         reaches the parser. */
      containerRef.value.innerHTML = ''
      return
    }
    /* Tear down any prior svg-pan-zoom instance before we wipe
       the container. The instance holds listeners on the old
       svg element and DOM control icons inside the container;
       replacing innerHTML detaches the svg but doesn't release
       the listeners, so an explicit destroy() is required. */
    panZoomInstance?.destroy()
    panZoomInstance = null
    containerRef.value.innerHTML = svg
    /* bindFunctions wires up click handlers / tooltips for
       interactive diagrams (e.g. classDiagram clickable nodes).
       We use the bindFns from the successful attempt — the
       loop variable always reflects the last iteration. */
    if (bindFns && containerRef.value) bindFns(containerRef.value)
    /* Mermaid's svg has no native pan/zoom — drag/zoom is what
       other sites add via svg-pan-zoom. We dynamic-import the
       module so it stays out of the main bundle until a diagram
       actually renders, and we tag the svg via `dataset` so a
       stray double-render (HMR, ResizeObserver) can't bind a
       second instance to the same element. Failure to load the
       module is swallowed: a render that's visible but not
       draggable is still better than throwing here. */
    const svgEl = containerRef.value.querySelector('svg')
    if (svgEl && !svgEl.dataset.panZoomBound) {
      svgEl.dataset.panZoomBound = '1'
      void getSvgPanZoom().then((svgPanZoom) => {
        /* Two failure modes we have to filter out here:
           1. The component unmounted while the dynamic import
              was in flight — `containerRef.value` was nulled by
              Vue.
           2. A newer render() started after this querySelector
              captured `svgEl`. The container was wiped and a new
              svg inserted. `svgEl` is now detached. The
              generation guard catches this: only the most recent
              render's `.then` may bind. The previous render's
              `panZoomInstance?.destroy()` at the top of the
              newer render already ran (or no-op'd, if this very
              `.then` is the one that produced the instance —
              which is the common case on first render).
           Without this guard, the late callback would overwrite
           `panZoomInstance` with an instance bound to a detached
           svg, and the earlier one (if any) would leak. */
        if (!containerRef.value) return
        if (myGen !== renderGeneration) return
        panZoomInstance = svgPanZoom(svgEl as SVGSVGElement, {
          zoomEnabled: true,
          /* We render our own toolbar (zoom-in / zoom-out / reset /
             fullscreen) below the widget; svg-pan-zoom's built-in
             +/-/reset cluster would double up with it and the
             library's hardcoded `fill: black` would also fight the
             docus theme tokens. Keep it off. */
          controlIconsEnabled: false,
          fit: true,
          center: true,
          minZoom: 0.5,
          maxZoom: 10,
        })
      }).catch(() => { /* diagram still renders, just no drag/zoom */ })
    }
  } catch (e) {
    renderError.value = (e as Error).message
    if (containerRef.value) {
      containerRef.value.innerHTML = `<pre class="mermaid-error-pre">${(e as Error).message}</pre>`
    }
  }
}

/* ---- Toolbar actions ----
   Mirror of MarkMap.vue's toolbar: the buttons are dumb delegates
   to the svg-pan-zoom instance. Each method is a one-liner that
   guards against the (brief) window between component mount and
   the async dynamic-import resolving, where `panZoomInstance` is
   still null. The buttons just no-op in that window — by the time
   the widget is visible to the user, the instance is up. */
function zoomIn() {
  panZoomInstance?.zoomIn()
}
function zoomOut() {
  panZoomInstance?.zoomOut()
}
function resetView() {
  /* svg-pan-zoom's `reset()` is "fit + center" — same as the
     initial render state. We use it for the explicit reset button
     AND after a fullscreen toggle, since the wrapper's box size
     changes and the cached viewport stops matching. */
  panZoomInstance?.reset()
}

function toggleFullscreen() {
  if (!wrapperRef.value) return
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => { /* user denied; harmless */ })
  } else {
    void wrapperRef.value.requestFullscreen().catch(() => { /* user denied; harmless */ })
  }
}
function onFullscreenChange() {
  /* Mirror the browser's fullscreen state into our ref. We compare
     against `wrapperRef.value` rather than checking the boolean
     directly because the user might have fullscreened another
     element (a video player, etc.) and we want our icon to reflect
     "this widget is *not* the fullscreen element". */
  isFullscreen.value = document.fullscreenElement === wrapperRef.value
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
  /* Watch the document-level fullscreenchange event so the toolbar
     icon stays in sync if the user presses Esc or right-clicks
     "Exit fullscreen" from the browser chrome. */
  document.addEventListener('fullscreenchange', onFullscreenChange)
  /* If fullscreen was entered before mount finished, sync up the
     initial icon state. */
  onFullscreenChange()
})

onBeforeUnmount(() => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
  resizeObserver?.disconnect()
  resizeObserver = null
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  /* Destroy the pan/zoom instance first — it holds listeners on
     the svg and control-icon DOM nodes inside the container.
     Clearing innerHTML below detaches those nodes but doesn't
     release the listeners, so destroy() has to run before. */
  panZoomInstance?.destroy()
  panZoomInstance = null
  /* Clear the rendered svg so the DOMPurify-scrubbed nodes don't
     outlive the component (especially during HMR). */
  if (containerRef.value) containerRef.value.innerHTML = ''
  /* If WE are the fullscreen element at unmount time, exit so the
     browser doesn't keep the body locked for the next mount. */
  if (document.fullscreenElement === wrapperRef.value) {
    void document.exitFullscreen().catch(() => { /* user denied; harmless */ })
  }
})

/* HMR teardown. When this module is replaced (vite picks up an
   edit to Mermaid.vue during dev), the module-level state
   (`mermaidModule`, `panZoomModule`, `mermaidRenderCount`,
   `lastInitKey`) is reset to its initial values automatically
   because the module is re-evaluated. But the dynamic
   `import('mermaid')` and `import('svg-pan-zoom')` resolve
   against the OLD module's chunk URL — old components still
   mounted at HMR time hold references to the old mermaid
   instance, while new components get the new one. mermaid
   keeps its config in module-level state inside its own
   module, so the two instances don't see each other's
   initialize() calls. The result: a stale mermaid instance
   keeps drawing with its old theme while a freshly-mounted
   widget's render path initializes the new instance and
   draws with the new theme.

   The cheapest correct fix: blow away mermaid's internal
   state at HMR time so the next initialize() call gets a
   clean slate. mermaid doesn't expose a "reset" API, but
   `lastInitKey` (which we control) gates our own initialize
   calls, so resetting it to '' forces the next render to
   re-init. For the deeper mermaid-side cleanup we just
   null the module-level cache; the next getMermaid()
   dynamic import re-resolves through vite's module graph,
   which under HMR returns the FRESH module, not the old
   one. The trade-off is the cost of one extra dynamic
   import per widget after each HMR — acceptable in dev. */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    mermaidModule = null
    panZoomModule = null
    mermaidRenderCount = 0
    lastInitKey = ''
  })
}

/* Theme flip → re-render so the diagram re-tints. We go through
   scheduleRender so the render is gated on a non-zero size —
   a theme toggle while the widget is hidden (in a background
   tab) won't paint a broken svg. The ResizeObserver will
   re-trigger once the tab becomes visible. */
watch(theme, () => scheduleRender())

/* props.code change (e.g. the markdown source was edited) → re-
   render. */
watch(() => props.code, () => scheduleRender())

/* Fullscreen toggle → resize the svg inline + flip preserveAspectRatio
   + re-fit svg-pan-zoom.

   Why inline style instead of CSS:
   The svg is inserted into `.mermaid-svg` via innerHTML by
   mermaid.render(), so it does NOT carry Vue's [data-v-xxx]
   scope attribute. A scoped selector targeting it has to go
   through `:deep()`, and in practice `.mermaid-widget:fullscreen
   .mermaid-svg :deep(svg) { width: 100% }` doesn't always apply
   on Chromium — possibly because mermaid 11 sets an inline
   `width="…"` presentation attribute that survives the scoped
   selector, or because the `:deep()` chain drops the data-v at
   exactly the wrong specificity boundary. Either way the svg
   stays at its intrinsic dimensions while its container goes
   fullscreen — visibly "small horizontally" even though the
   svg's outer container is the viewport. Inline `style.width =
   '100%'` has specificity (1,0,0,0) — it beats every CSS selector
   AND every presentation attribute — so this is the only knob
   that's guaranteed to take effect. The CSS still sets
   `.mermaid-svg` itself to 100% × 100%, which is reliable; this
   script handles the inner svg specifically.

   preserveAspectRatio flip:
   mermaid emits the svg with `preserveAspectRatio="xMidYMid meet"`
   by default — "scale uniformly to FIT inside the box, leaving
   letterbox space on whichever axis doesn't fit". Once the svg
   IS filling the viewport, a diagram whose intrinsic aspect
   differs (e.g. 4:3 inside a 16:9 viewport) would still look
   narrow — `meet` keeps the diagram at its natural aspect and
   letterboxes the rest. We flip to `xMidYMid slice` ("scale
   uniformly to FILL, cropping the longer axis") in fullscreen
   so the diagram visually fills the viewport; the user can pan
   via svg-pan-zoom to reach any cropped edges, or zoom out to
   see the whole thing. On exit we restore mermaid's default.

   Exit-side width/height attribute cleanup:
   On exiting fullscreen we have to clear BOTH the inline style
   AND mermaid's `width="…"` / `height="…"` presentation
   attributes on the svg. If we only cleared the style
   (`svg.style.width = ''`), the attribute would reassert
   itself and the svg would jump back to its intrinsic
   dimensions — wide diagrams (a long gantt) would then
   overflow the article and trigger a horizontal scrollbar
   that wasn't there before the fullscreen session. Removing
   the attribute is what tells the browser to fall back to
   CSS sizing. We do the same on the `max-width` /
   `min-height` styles we set on entry.

   svg-pan-zoom caches the svg's bounding rect at bind time; on
   the fullscreen transition the cache goes stale. resize() reads
   the current rect and pushes it into the cache; reset() (fit +
   center) then operates against the new size. Without resize()
   the diagram would stay at the pre-fullscreen scale because
   reset() reads from the cache. Order matters: resize() FIRST,
   then reset().

   ResizeObserver doesn't reliably fire across the fullscreen
   transition in every browser (only this widget re-layouts, not
   the article), so a dedicated watcher is needed. */
watch(isFullscreen, (fs) => {
  const svg = containerRef.value?.querySelector('svg')
  if (svg) {
    if (fs) {
      svg.style.width = '100%'
      svg.style.height = '100%'
      svg.style.maxWidth = 'none'
      svg.style.minHeight = '0'
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice')
    } else {
      /* Clear inline styles first. */
      svg.style.width = ''
      svg.style.height = ''
      svg.style.maxWidth = ''
      svg.style.minHeight = ''
      /* Then remove the presentation attributes mermaid set on
         render — otherwise the attribute reasserts and the svg
         snaps back to its intrinsic dimensions. */
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.removeAttribute('preserveAspectRatio')
    }
  }
  panZoomInstance?.resize()
  panZoomInstance?.reset()
})
</script>

<template>
  <div ref="wrapperRef" class="mermaid-widget">
    <div ref="containerRef" class="mermaid-svg" />
    <div v-if="renderError" class="mermaid-error">
      图表渲染失败:{{ renderError }}
    </div>
    <!-- Toolbar: reveals on hover, mirrors MarkMap.vue's
         `.markmap-toolbar-area` pattern. The four buttons
         delegate to svg-pan-zoom via the panZoomInstance held
         in script setup. Inline SVG icons use `currentColor`
         so they pick up the article's `--text` and follow the
         theme. -->
    <div class="mermaid-toolbar-area">
      <div class="mermaid-toolbar">
        <button @click="zoomOut" title="缩小" aria-label="缩小">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button @click="zoomIn" title="放大" aria-label="放大">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
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

/* ---- Toolbar ----
   Mirror of MarkMap.vue's `.markmap-toolbar-area` /
   `.markmap-toolbar` pattern: the area is absolutely positioned
   at bottom-right, hidden by default, and reveals on
   `.mermaid-widget:hover` (or while a child has focus, so
   keyboard users can tab to a button and have it stay visible).
   We use the same `--vs-bg-1` / `--vs-border` / `--vs-text-1` /
   `--vs-hover-bg` tokens that markmap does, so the toolbar
   reads as part of the same UI family across widgets. */
.mermaid-toolbar-area {
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.mermaid-widget:hover .mermaid-toolbar-area,
.mermaid-toolbar-area:focus-within { opacity: 1; }

.mermaid-toolbar {
  display: flex;
  gap: 4px;
  background: var(--vs-bg-1);
  border: 1px solid var(--vs-border);
  border-radius: 6px;
  padding: 2px;
}
.mermaid-toolbar button {
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
.mermaid-toolbar button:hover {
  background: var(--vs-hover-bg);
}

/* ---- Fullscreen overrides ----
   The widget itself becomes the fullscreen element. The wrapper
   and `.mermaid-svg` get explicit 100% × 100% sizing here —
   reliable for those, because they DO carry Vue's [data-v-xxx]
   scope attribute and the scoped selector matches them.

   The svg element INSIDE `.mermaid-svg` is handled separately
   by JS — see the `watch(isFullscreen, ...)` handler. mermaid
   injects that svg via innerHTML, so it doesn't carry the scope
   attribute, and the scoped `:deep()` selector chain
   (`.mermaid-widget:fullscreen .mermaid-svg :deep(svg)`) doesn't
   take effect on Chromium in practice. JS sets inline
   `style.width = '100%'`, whose specificity (1,0,0,0) beats any
   selector or presentation attribute. The CSS rule below for
   the inner svg is kept as a fallback / intent-document.

   Padding goes away in fullscreen (no 12px gutters around the
   diagram) and `overflow-x: auto` becomes `overflow: hidden` so
   the diagram doesn't push a horizontal scrollbar when its
   intrinsic width is wider than the viewport. The background
   matches `--bg` so the letterbox area blends with the diagram's
   own background instead of peeking through to the article's
   `--bg-2`. */
.mermaid-widget:fullscreen {
  padding: 0;
  overflow: hidden;
  background: var(--bg);
}
.mermaid-widget:fullscreen .mermaid-svg {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.mermaid-widget:fullscreen .mermaid-svg :deep(svg) {
  /* Fallback only — see the JS path in `watch(isFullscreen, ...)`
     for the rule that actually applies on Chromium. */
  width: 100%;
  height: 100%;
  max-width: none;
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
