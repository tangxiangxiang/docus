<script setup lang="ts">
// Knowledge-graph canvas. Renders the zettel/ subtree as a
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
  linkColor: (c: string) => ForceGraphInstance
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
    bg: dark ? '#0A0E1A' : '#FAFAFA',
    nodeFill: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
    nodeStroke: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)',
    linkColor: dark ? 'rgba(140,180,255,0.35)' : 'rgba(70,100,180,0.30)',
    text: dark ? '#E2E8F0' : '#1F2937',
  }
})

let graph: ForceGraphInstance | null = null
let resizeObserver: ResizeObserver | null = null
const loadError = ref<string | null>(null)

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
    const r = node.val / globalScale
    ctx.beginPath()
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI, false)
    ctx.fillStyle = c.nodeFill
    ctx.fill()
    ctx.lineWidth = 1.5 / globalScale
    ctx.strokeStyle = c.nodeStroke
    ctx.stroke()
    /* Label below the dot. We use the title (not the path) so
       the visual matches the in-editor display. */
    const fontSize = 12 / globalScale
    ctx.font = `${fontSize}px Inter, "Noto Sans SC", sans-serif`
    ctx.fillStyle = c.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(node.title, node.x ?? 0, (node.y ?? 0) + r + 2 / globalScale)
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
  if (graph || mountInFlight) return
  const el = containerRef.value
  if (!el) return
  /* Skip mount for an empty zettel set — force-graph renders a
     black box for a 0-node graph, which is a worse UX than a
     one-line "no notes" message. The early return is what the
     test pins in the empty-state describe block. */
  if (graphData.value.nodes.length === 0) return
  mountInFlight = true

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
  graph = g
  mountInFlight = false

  g.width(el.clientWidth || 800)
   .height(el.clientHeight || 600)
   .nodeId('id')
   .nodeLabel('title')
   .nodeVal('val')
   .linkColor(colors.value.linkColor)
  /* Tighten the default charge + center forces so an edgeless graph
     (the common zettel/ draft state where a few notes have no links
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
  /* Pin a fixed camera instead of calling force-graph's zoomToFit.
     zoomToFit scales the simulation's bounding box to fill the
     canvas, which for a 2-node edgeless graph (bbox ~1 sim unit
     across) zooms the camera in so far that the two nodes end
     up at the canvas edges — the user reads that as "they're far
     apart" even though the simulation itself is converged at a
     tight d=1.0. FIXED_ZOOM (1 sim unit = 50 canvas pixels)
     gives a 2-node cluster of ~50px and a 30-node cluster of
     ~1000px (fits 1280 with padding). The user can still wheel-
     zoom in/out to inspect; the fixed zoom is just the resting
     position. Camera is set synchronously — the simulation runs
     via rAF, so by the first paint nodes have already moved off
     their initial (0,0) coincidence point.

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
  g.zoom(FIXED_ZOOM)
  g.centerAt(0, 0, 0)
  g.cooldownTime(COOLDOWN_TIME_MS)
  g.cooldownTicks(COOLDOWN_TICKS)
  g.graphData({
    nodes: graphData.value.nodes.slice(),
    links: graphData.value.links.slice(),
  })

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
  void mountGraph()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  /* kapsule exposes the destructor as `_destructor` (see
     node_modules/force-graph/dist/force-graph.mjs — the linkKapsule
     helper calls it during teardown). Calling it stops the d3
     simulation timer and releases the canvas — the test pins
     this. */
  graph?._destructor()
  graph = null
})

/* Push new data into force-graph on every link index change.
   The library's onChange handler restarts the simulation with
   the fresh node/link set, so a new [[wiki]] link added in the
   editor shows up here within one debounce. `graphData` is a
   ComputedRef, so deep-watching its value is a no-op — Vue
   re-evaluates the computed wholesale on dependency change. */
watch(graphData, (next) => {
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

/* Theme switch — re-install the canvas callback so the new
   colors paint. force-graph doesn't watch the closure's
   internal refs; it would keep using the old palette until the
   callback is replaced. linkColor is stored as a string on the
   library's state, so it must also be re-set. */
watch(theme, () => {
  if (graph) {
    installCanvasCallback(graph)
    graph.linkColor(colors.value.linkColor)
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
      还没有 zettel 笔记，先去 inbox 写一条吧。
    </div>
  </div>
</template>

<style scoped>
.kg-wrap {
  width: 100%;
  height: 100%;
  position: relative;
  background: var(--vs-bg-1);
}
/* force-graph injects a <canvas> as a direct child of the
   element we hand it. The ref lives on .kg-wrap, so the canvas
   lands here. */
.kg-wrap > canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
.kg-wrap[data-theme='dark'] {
  background: #0A0E1A;
}
.kg-wrap[data-theme='light'] {
  background: #FAFAFA;
}
.kg-canvas {
  width: 100%;
  height: 100%;
}
.kg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--vs-text-2);
  font-size: 0.95em;
  /* Pad the message so it doesn't touch the panel edge. */
  padding: 0 2rem;
  text-align: center;
}
</style>
