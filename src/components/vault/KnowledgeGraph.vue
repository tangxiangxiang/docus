<script setup lang="ts">
// Knowledge-graph canvas. Renders the archive/ subtree as a
// force-directed graph using `force-graph` (canvas, not svg — the
// library targets 1k+ nodes and uses d3-force under the hood).
//
// The component is mounted by VaultView when `activePanel ===
// 'graph'`. It is the *only* place the force-graph library is
// imported; we dynamic-import so the 200KB+ bundle of d3-force +
// d3-zoom doesn't ship on the edit/preview path.
//
// Lifecycle:
//   onMounted      — dynamic import forceGraph, install instance,
//                    set initial graph data, wire click + canvas
//                    callbacks, install a ResizeObserver for the
//                    container (vault side panel / AI panel drag
//                    changes the available width).
//   onBeforeUnmount — call the kapsule `_destructor()` to stop
//                    the d3 simulation and release canvas. Just
//                    dropping the ref would leak the simulation
//                    timer (verified in the test).
//   watch graphData — re-call `graph.graphData(next)` on every
//                    link index change. The library's `onChange`
//                    handler restarts the simulation with the
//                    fresh node/link set, so a new edge added in
//                    the editor appears in the graph within ~1
//                    debounce (400ms in useLinkIndex) + 1
//                    microtask.
//   watch theme    — re-install the canvas callback so the new
//                    color palette is picked up. force-graph's
//                    `nodeCanvasObject` is a prop, not reactive;
//                    re-setting it triggers a redraw.
//
// Click semantics:
//   onNodeClick → getOpenPostForClicks()(node.path) + the
//   caller's responsibility to close the graph panel. We don't
//   import useEditorTabs here because that composable owns the
//   tab state and would create a circular import (the tabs
//   composable mounts the graph panel). The shared `setOpenPost`
//   singleton is the same plumbing the wiki-link click uses in
//   PreviewPane.

import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import { useTheme } from '../../composables/useTheme'
import { useGraphData } from '../../composables/vault/useGraphData'
import { getOpenPostForClicks } from '../../composables/vault/useEditorTabs'
import { getSelectPanelForClicks } from '../../composables/vault/useVaultLayout'

/* Minimal structural type for the force-graph instance. We don't
   import force-graph's types (the d.ts is large and ties to
   d3-force); declaring just the methods we call keeps the
   surface area small and the test mock trivial. */
interface ForceGraphInstance {
  graphData: (data: { nodes: unknown[]; links: unknown[] }) => ForceGraphInstance
  width: (n: number) => ForceGraphInstance
  height: (n: number) => ForceGraphInstance
  nodeId: (k: string) => ForceGraphInstance
  nodeLabel: (k: string) => ForceGraphInstance
  nodeVal: (k: string) => ForceGraphInstance
  nodeCanvasObject: (cb: (node: { id: string; title: string; val: number; x?: number; y?: number }, ctx: CanvasRenderingContext2D, scale: number) => void) => ForceGraphInstance
  nodePointerAreaPaint: (cb: (node: { id: string; title: string; val: number; x?: number; y?: number }, color: string, ctx: CanvasRenderingContext2D, scale: number) => void) => ForceGraphInstance
  linkColor: (c: string | ((link: { source: unknown; target: unknown }) => string | null | undefined)) => ForceGraphInstance
  /* Custom link renderer. We use this instead of `linkColor`
     because the user reported the `linkColor` setter not
     actually painting the lines on a dark canvas — likely an
     interaction with force-graph's kapsule state where
     `state.linkColor` doesn't get read on every paint. Drawing
     the line ourselves in `installLinkRenderer` makes the color
     a function of the canvas context we control, not the
     library's internal state. */
  linkCanvasObject: (cb: (link: { source: { x: number; y: number }; target: { x: number; y: number } }, ctx: CanvasRenderingContext2D, scale: number) => void) => ForceGraphInstance
  linkCanvasObjectMode: (mode: string | (() => 'replace' | 'before' | 'after')) => ForceGraphInstance
  onNodeClick: (cb: (node: { id: string; path: string }) => void) => ForceGraphInstance
  zoomToFit: (duration: number, padding: number) => ForceGraphInstance
  /* Camera controls. force-graph uses (zoom, centerAt) for the
     resting position; the setTimeout in mountGraph calls these
     once the simulation has settled (replacing the old
     zoomToFit, which made small edgeless clusters fill the
     canvas and read as "two notes far apart"). */
  zoom: (k: number) => ForceGraphInstance
  centerAt: (x: number, y: number, ms: number) => ForceGraphInstance
  /* Exposes the d3-force-3d simulation forces for fine-tuning.
     force-graph pre-registers four: 'link' (forceLink),
     'charge' (forceManyBody), 'center' (forceCenter, strength 0.1),
     and 'dagRadial' (null until DAG mode is on). We only mutate
     'charge' below — see mountGraph for why. */
  d3Force: (name: string) => unknown
  /* Hard-stop conditions for the simulation. force-graph's
     defaults are Infinity, meaning the simulation only stops
     when alpha drops below alphaMin (~5s at 60fps). We override
     these to 1.5s / 150 ticks to kill the long-tail jitter that
     would otherwise keep re-rendering the canvas after the
     positions have visually converged. */
  cooldownTime: (ms: number) => ForceGraphInstance
  cooldownTicks: (ticks: number) => ForceGraphInstance
  _destructor: () => void
}

/* The force-graph default export is a kapsule "comp" — it has to
   be invoked with `new` (class-mode) to actually run the
   component's `init()`. Plain function call leaves `init`
   unrun, and no canvas ever lands in the container. Caught the
   hard way: 30s hang on first graph-panel click in dev. */
type ForceGraphCtor = new (el: HTMLElement) => ForceGraphInstance

const containerRef = ref<HTMLDivElement | null>(null)
const graphData = useGraphData()
const { theme } = useTheme()

/* Color palette follows the active theme. Computed once per
   theme change; force-graph reads these on every paint call. */
const colors = computed(() => {
  const dark = theme.value === 'dark'
  return {
    bg: dark ? '#121212' : '#F7F7F4',
    cardFill: dark ? 'rgba(28,28,26,0.92)' : 'rgba(255,255,255,0.88)',
    cardStroke: dark ? 'rgba(255,255,255,0.14)' : 'rgba(28,25,23,0.12)',
    nodeHalo: dark ? 'rgba(125,211,199,0.16)' : 'rgba(15,118,110,0.11)',
    nodeShadow: dark ? 'rgba(0,0,0,0.42)' : 'rgba(16,24,40,0.14)',
    /* Link stroke — deliberately low-alpha so the line
       recedes and the note cards read as the focal
       element. We use a function (not a string) because
       force-graph's `linkColor` setter routes through
       `accessor-fn`, which would treat the literal `'…'`
       as a property name on the link object (see
       `installLinkRenderer` for the same trap on
       `linkCanvasObjectMode`). */
    linkColorFn: () => (dark ? 'rgba(125,211,199,0.28)' : 'rgba(15,118,110,0.20)'),
    text: dark ? '#F5F5F4' : '#1C1917',
    textMuted: dark ? 'rgba(245,245,244,0.58)' : 'rgba(28,25,23,0.52)',
  }
})

let graph: ForceGraphInstance | null = null
let resizeObserver: ResizeObserver | null = null
const loadError = ref<string | null>(null)
let disposed = false
let fitTimer: number | null = null

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, width, height, radius)
    return
  }
  const r = Math.min(radius, width / 2, height / 2)
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + ellipsis
}

function cardMetrics(
  node: { title: string; val: number; x?: number; y?: number },
  ctx: CanvasRenderingContext2D,
  globalScale: number,
) {
  const x = node.x ?? 0
  const y = node.y ?? 0
  const fontSize = 11 / globalScale
  const metaFontSize = 8 / globalScale
  const padX = 10 / globalScale
  const cardMinW = 72 / globalScale
  const cardMaxW = 168 / globalScale
  const cardH = (30 + Math.min(8, Math.max(0, node.val - 8)) * 0.45) / globalScale
  const radius = 7 / globalScale
  const metaReserve = node.val > 11 ? 18 / globalScale : 0
  ctx.font = `600 ${fontSize}px Inter, "Noto Sans SC", sans-serif`
  const measuredTitleW = ctx.measureText(node.title).width
  const cardW = Math.min(cardMaxW, Math.max(cardMinW, measuredTitleW + padX * 2 + metaReserve))
  const cardX = x - cardW / 2
  const cardY = y - cardH / 2
  const title = fitText(ctx, node.title, cardW - padX * 2 - metaReserve)
  return { x, y, fontSize, metaFontSize, padX, cardW, cardH, cardX, cardY, radius, title }
}

function destroyGraph() {
  if (fitTimer !== null) {
    window.clearTimeout(fitTimer)
    fitTimer = null
  }
  resizeObserver?.disconnect()
  resizeObserver = null
  graph?._destructor()
  graph = null
}

function installCanvasCallback(g: ForceGraphInstance) {
  /* Snapshot the colors object at install time. force-graph's
     nodeCanvasObject runs at 60fps for every node during d3-force
     simulation, and the previous version dereferenced `colors.value`
     (a Vue reactive proxy) on every paint. Snapshotting once per
     install is the same closure cost (the theme watcher re-installs
     the callback on every theme change — the test pins that), but
     eliminates per-paint reactive-proxy access. For a 1k-node
     graph at 60fps that's ~60k proxy derefs/sec saved during the
     warmup window. */
  const c = colors.value
  g.nodeCanvasObject((node, ctx, globalScale) => {
    /* `y` is the card's vertical center; `cardX`/`cardY` are
       already derived from `x`/`y` inside cardMetrics, so we don't
       pull `x` out here — only `y` is referenced directly (the
       title sits one pixel above center, the val badge one below). */
    const { y, fontSize, metaFontSize, padX, cardW, cardH, cardX, cardY, radius, title } =
      cardMetrics(node, ctx, globalScale)

    ctx.beginPath()
    roundedRect(
      ctx,
      cardX - 4 / globalScale,
      cardY - 4 / globalScale,
      cardW + 8 / globalScale,
      cardH + 8 / globalScale,
      radius + 3 / globalScale,
    )
    ctx.fillStyle = c.nodeHalo
    ctx.fill()

    ctx.save()
    ctx.shadowColor = c.nodeShadow
    ctx.shadowBlur = 14 / globalScale
    ctx.shadowOffsetY = 3 / globalScale
    ctx.beginPath()
    roundedRect(ctx, cardX, cardY, cardW, cardH, radius)
    ctx.fillStyle = c.cardFill
    ctx.fill()
    ctx.restore()

    ctx.lineWidth = 1 / globalScale
    ctx.strokeStyle = c.cardStroke
    ctx.stroke()

    /* Title inside the card. We use the title (not the path) so
       the visual matches the in-editor display. */
    ctx.font = `600 ${fontSize}px Inter, "Noto Sans SC", sans-serif`
    ctx.fillStyle = c.text
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(title, cardX + padX, y - 1 / globalScale)

    if (node.val > 11) {
      ctx.font = `500 ${metaFontSize}px Inter, "Noto Sans SC", sans-serif`
      ctx.fillStyle = c.textMuted
      ctx.textAlign = 'right'
      ctx.fillText(String(node.val), cardX + cardW - 7 / globalScale, y + 1 / globalScale)
    }
  })
}

function installNodePointerArea(g: ForceGraphInstance) {
  g.nodePointerAreaPaint((node, color, ctx, globalScale) => {
    const { cardW, cardH, cardX, cardY, radius } = cardMetrics(node, ctx, globalScale)
    const inset = Math.min(4 / globalScale, cardW / 4, cardH / 4)
    ctx.fillStyle = color
    ctx.beginPath()
    roundedRect(
      ctx,
      cardX + inset,
      cardY + inset,
      cardW - inset * 2,
      cardH - inset * 2,
      Math.max(1 / globalScale, radius - inset),
    )
    ctx.fill()
  })
}

/* Custom link renderer — draws each edge as a straight
   canvas line using `colors.value.linkColor` as the stroke.
   This replaces force-graph's default `paintLinks` path so
   the color is set by us, not by the library's `linkColor`
   accessor. See the comment on the `linkColor` entry in
   the `colors` computed for why we don't trust the accessor.

   The mode is 'replace' so force-graph's default stroke pass
   is skipped; otherwise we'd double-draw each link (once
   dim, once bright) and the visual weight would be wrong.

   We snapshot `colors.value` at install time for the same
   reason as `installCanvasCallback` — force-graph holds the
   callback for the lifetime of the instance, and the theme
   watcher re-installs this function on every theme change.
   */
function installLinkRenderer(g: ForceGraphInstance) {
  const c = colors.value
  /* Function form, NOT the string 'replace'. force-graph reads
     `linkCanvasObjectMode` through `accessor-fn` (same trap as
     `linkColor`): a string is treated as a property name on
     the link object. `link['replace']` is `undefined` for our
     link objects, so the `replace` branch was never taken —
     every link fell into the default-paint bucket and was
     rendered with force-graph's fallback `rgba(0,0,0,0.15)`.
     That's the dim grey line the user has been seeing. */
  g.linkCanvasObjectMode(() => 'replace')
  g.linkCanvasObject((link, ctx, globalScale) => {
    const start = link.source
    const end = link.target
    /* force-graph only resolves `source` / `target` from string
       ids to node objects once the simulation has placed the
       nodes. Before that (and after the simulation has been
       torn down) the link has no x/y to draw to, and we skip
       the stroke. */
    if (!start || !end || typeof start.x !== 'number' || typeof end.x !== 'number') return
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.strokeStyle = c.linkColorFn()
    /* 1.15px in canvas space, scaled down as the user zooms in.
       This matches force-graph's default linkWidth: a single
       anti-aliased line that reads as ~1px on screen at the
       resting zoom, with just enough presence to stay visible
       beneath the softer node styling. */
    ctx.lineWidth = 1.15 / globalScale
    ctx.stroke()
  })
}

/* `mountGraph` runs in two situations:
   1. onMounted — the first attempt to set up the canvas.
   2. link-index landed after mount with an empty initial
      state — the watcher below re-invokes it.
   Concurrent calls are safe: we set `graph` to a sentinel
   *before* the dynamic import so a second call hitting the
   `if (graph) return` guard short-circuits even if it lands
   while the first call is still awaiting the chunk. The
   sentinel is `true`; we replace it with the real instance
   once `new Ctor(el)` returns. */
let mountInFlight = false
async function mountGraph() {
  if (disposed || graph || mountInFlight) return
  const el = containerRef.value
  if (!el) return
  /* Skip mount for an empty archive set — force-graph renders a
     black box for a 0-node graph, which is a worse UX than a
     one-line "no notes" message. The early return is what the
     test pins in the empty-state describe block. */
  if (graphData.value.nodes.length === 0) return
  mountInFlight = true
  loadError.value = null

  /* Dynamic import keeps force-graph + d3 out of the main
     bundle. After the first import, subsequent mounts reuse the
     cached module. The whole import + construct path is wrapped in
     try/catch — a failed chunk (most realistic in production) makes
     the dynamic import reject; a corrupt module (e.g. a bad
     transform) makes `new Ctor(el)` throw synchronously. Both
     surface as the same load-error UI. */
  let g: ForceGraphInstance
  try {
    const mod = await import('force-graph')
    /* force-graph's default export is a kapsule factory; its TS
       types don't narrow to our minimal interface, so we cast
       through `unknown` to avoid the overlap warning vue-tsc
       raises for the direct cast. */
    const Ctor = (mod.default ?? mod) as unknown as ForceGraphCtor
    g = new Ctor(el)
  } catch (err) {
    mountInFlight = false
    loadError.value = err instanceof Error ? err.message : String(err)
    return
  }
  if (disposed || !containerRef.value || graphData.value.nodes.length === 0) {
    mountInFlight = false
    g._destructor()
    return
  }
  graph = g
  mountInFlight = false

  g.width(el.clientWidth || 800)
   .height(el.clientHeight || 600)
   .nodeId('id')
   .nodeLabel('title')
   .nodeVal('val')
  /* Tighten the default charge + center forces so an edgeless graph
     (the common archive/ draft state where a few notes have no links
     yet) doesn't fling its nodes to opposite corners. force-graph
     pre-registers forceManyBody (strength=-30) and forceCenter
     (strength=0.1). With defaults the charge is 300x stronger than
     the center pull, so 2 isolated nodes drift to ~30px from the
     centroid in opposite directions and read as "far apart on the
     canvas".

     Three iterations got us here:
       1. 049616c charge=-10 — simulation tightened but the camera
          (zoomToFit) was still the dominant visual.
       2. 0472101 charge=-3 + center=0.3 — slightly tighter
          equilibrium, still using zoomToFit.
       3. fbd6004 charge=-1 + center=2.0 + fixed zoom=50 — first
          pass at skipping zoomToFit, but center=2.0 (20x default)
          made the spring too stiff: the simulation overshot the
          equilibrium, oscillated visibly for ~1.5s (rendered as
          "flickering"), and the Barnes-Hut quadtree even briefly
          rendered some isolated nodes twice (Barnes-Hut
          aggregates coincident subtrees during the first few
          ticks, then collapses them as the cluster separates).

     This pass (4th) keeps the camera pinned at zoom=50, but
     pulls center back to 0.3 (3x default — stiff enough to
     beat the charge in an edgeless graph, soft enough to
     converge in a few ticks without overshoot). The 2-node
     equilibrium at d=2.58 sim units → 129px on canvas, which
     still reads as a tight cluster at the user-visible scale.
     The `cooldownTime`/`cooldownTicks` calls below stop the
     simulation after 1.5s / 150 ticks regardless of alpha
     decay, so any residual jitter dies out cleanly. */
  const CHARGE_STRENGTH = -1
  const CENTER_STRENGTH = 0.3
  const FIXED_ZOOM = 50
  const FIT_THRESHOLD = 6
  const FIT_DELAY_MS = 180
  const FIT_DURATION_MS = 450
  const FIT_PADDING = 96
  const COOLDOWN_TIME_MS = 1500
  const COOLDOWN_TICKS = 150
  const charge = g.d3Force('charge') as { strength?: (n: number) => unknown } | null
  if (charge && typeof charge.strength === 'function') {
    charge.strength(CHARGE_STRENGTH)
  }
  const center = g.d3Force('center') as { strength?: (n: number) => unknown } | null
  if (center && typeof center.strength === 'function') {
    center.strength(CENTER_STRENGTH)
  }
  installCanvasCallback(g)
  installNodePointerArea(g)
  installLinkRenderer(g)
  g.onNodeClick((node) => {
    /* `getOpenPostForClicks` is the same singleton
       PreviewPane / ReadingPane use for wiki-link clicks. If
       the graph is mounted before the tabs composable has
       registered an opener (e.g. in a test), the call is a
       no-op — better than crashing. */
    const open = getOpenPostForClicks()
    if (open) open(node.path)
    /* The spec says clicking a node should close the graph
       panel and reveal the editor. Without this the user lands
       in graph mode with the editor tab open underneath, which
       is the wrong affordance. selectPanel is registered by
       VaultView onMounted; if the graph mounted first (e.g. in
       a test) the getter returns null and the panel stays
       open — same no-crash guarantee as openPost above. */
    const select = getSelectPanelForClicks()
    if (select) select('files')
  })
  /* Initial camera strategy:
     - Tiny graphs keep the fixed zoom. A 1-2 node graph has a
       microscopic bbox, so zoomToFit would blow it up until the
       cards sit at opposite edges of the canvas.
     - Larger graphs get a delayed zoomToFit. The delay gives
       d3-force a few ticks to separate initially-coincident nodes;
       fitting after that early spread avoids the "opened too
       zoomed-in, only seeing card edges" problem when the user has
       many notes.

     The user can still wheel-zoom after the first fit; this only
     chooses a sane opening frame.

     cooldownTime / cooldownTicks stop the simulation after 1.5s
     OR 150 ticks (whichever first) regardless of alpha decay.
     force-graph's defaults are Infinity for both, so the
     simulation only stops when alpha drops below alphaMin
     (~5s at 60fps). With our tight force balance the
     equilibrium is reached in ~50 ticks, but residual jitter
     can persist for another second as alpha cools. The hard
     stop at 1.5s kills the long tail — the canvas then freezes
     at the converged positions, no more re-renders. The
     150-tick guard catches the edge case where the
     simulation hasn't actually been ticking (e.g. test env
     with rAF paused): the timer alone might never elapse
     relative to simulation time. */
  g.cooldownTime(COOLDOWN_TIME_MS)
  g.cooldownTicks(COOLDOWN_TICKS)
  const initialData = {
    nodes: graphData.value.nodes.slice(),
    links: graphData.value.links.slice(),
  }
  g.graphData(initialData)
  if (initialData.nodes.length > FIT_THRESHOLD) {
    fitTimer = window.setTimeout(() => {
      fitTimer = null
      if (disposed || graph !== g) return
      g.zoomToFit(FIT_DURATION_MS, FIT_PADDING)
    }, FIT_DELAY_MS)
  } else {
    g.zoom(FIXED_ZOOM)
    g.centerAt(0, 0, 0)
  }

  /* ResizeObserver keeps the canvas sized to the container. The
     editor-area can change width as the user drags the tree
     splitter or the AI panel. jsdom doesn't fire RO, so the
     test fires it manually; in a real browser this is what
     keeps the graph from going stale. */
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (!graph || !containerRef.value) return
      graph.width(containerRef.value.clientWidth)
      graph.height(containerRef.value.clientHeight)
    })
    resizeObserver.observe(el)
  }
}

onMounted(() => {
  disposed = false
  void mountGraph()
})

onBeforeUnmount(() => {
  disposed = true
  destroyGraph()
})

/* Push new data into force-graph on every link index change.
   The library's onChange handler restarts the simulation with
   the fresh node/link set, so a new [[wiki]] link added in the
   editor shows up here within one debounce. `graphData` is a
   ComputedRef, so deep-watching its value is a no-op — Vue
   re-evaluates the computed wholesale on dependency change. */
watch(graphData, (next) => {
  if (next.nodes.length === 0) {
    destroyGraph()
    return
  }
  if (!graph) {
    /* Mount raced with the first link index fetch — the empty
       state guard in mountGraph() prevented initial setup. Try
       again now that we have data. mountGraph's own empty
       guard handles the still-empty case. */
    void mountGraph()
    return
  }
  graph.graphData({
    nodes: next.nodes.slice(),
    links: next.links.slice(),
  })
})

/* Theme switch — re-install the canvas callbacks so the new
   colors paint. force-graph doesn't watch the closure's
   internal refs; it would keep using the old palette until the
   callbacks are replaced. Both `nodeCanvasObject` and
   `linkCanvasObject` are installed at construction time and
   capture `colors.value` by closure, so swapping in the new
   palette means swapping in new function instances. */
watch(theme, () => {
  if (graph) {
    installCanvasCallback(graph)
    installLinkRenderer(graph)
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="kg-wrap"
    :data-theme="theme"
    role="img"
    aria-label="Knowledge graph"
  >
    <div v-if="loadError" class="kg-empty" role="alert" aria-live="polite">
      图谱加载失败：{{ loadError }}
    </div>
    <div
      v-else-if="graphData.nodes.length === 0"
      class="kg-empty"
      aria-live="polite"
    >
      还没有归档笔记，先去 inbox 写一条吧。
    </div>
  </div>
</template>

<style scoped>
.kg-wrap {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 42%, var(--kg-glow), transparent 42%),
    linear-gradient(var(--kg-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--kg-grid) 1px, transparent 1px),
    var(--kg-bg);
  background-size: auto, 32px 32px, 32px 32px, auto;
  box-shadow:
    inset 0 1px 0 var(--kg-edge-hi),
    inset 0 0 0 1px var(--kg-edge),
    inset 0 -40px 80px var(--kg-vignette);
}
/* force-graph injects a wrapper div plus a canvas into the
   element we hand it. Keep both stretched so the rendering
   surface tracks the editor area exactly. */
.kg-wrap :deep(.force-graph-container),
.kg-wrap :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
.kg-wrap[data-theme='dark'] {
  --kg-bg: #121212;
  --kg-grid: rgba(255,255,255,0.035);
  --kg-glow: rgba(125,211,199,0.08);
  --kg-edge: rgba(255,255,255,0.08);
  --kg-edge-hi: rgba(255,255,255,0.06);
  --kg-vignette: rgba(0,0,0,0.32);
  --kg-empty-bg: rgba(255,255,255,0.045);
  --kg-empty-border: rgba(255,255,255,0.08);
}
.kg-wrap[data-theme='light'] {
  --kg-bg: #f7f7f4;
  --kg-grid: rgba(28,25,23,0.055);
  --kg-glow: rgba(15,118,110,0.08);
  --kg-edge: rgba(28,25,23,0.10);
  --kg-edge-hi: rgba(255,255,255,0.72);
  --kg-vignette: rgba(28,25,23,0.045);
  --kg-empty-bg: rgba(255,255,255,0.58);
  --kg-empty-border: rgba(28,25,23,0.10);
}
.kg-canvas {
  width: 100%;
  height: 100%;
}
.kg-empty {
  position: absolute;
  left: 50%;
  top: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: min(420px, calc(100% - 48px));
  min-height: 44px;
  transform: translate(-50%, -50%);
  border: 1px solid var(--kg-empty-border);
  border-radius: 8px;
  background: var(--kg-empty-bg);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  color: var(--vs-text-2);
  font-size: 0.92rem;
  line-height: 1.5;
  padding: 10px 16px;
  text-align: center;
  box-shadow: 0 12px 32px rgba(0,0,0,0.10);
}
</style>
