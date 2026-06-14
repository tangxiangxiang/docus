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

function installCanvasCallback(g: ForceGraphInstance) {
  /* Close over the current `colors` ref so a theme switch can
     re-install this callback and the next frame uses the new
     palette. The closure captures `colors.value` at paint time,
     not at install time — that's what we want. */
  g.nodeCanvasObject((node, ctx, globalScale) => {
    const r = node.val / globalScale
    ctx.beginPath()
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI, false)
    ctx.fillStyle = colors.value.nodeFill
    ctx.fill()
    ctx.lineWidth = 1.5 / globalScale
    ctx.strokeStyle = colors.value.nodeStroke
    ctx.stroke()
    /* Label below the dot. We use the title (not the path) so
       the visual matches the in-editor display. */
    const fontSize = 12 / globalScale
    ctx.font = `${fontSize}px Inter, "Noto Sans SC", sans-serif`
    ctx.fillStyle = colors.value.text
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(node.title, node.x ?? 0, (node.y ?? 0) + r + 2 / globalScale)
  })
}

async function mountGraph() {
  if (graph) return
  const el = containerRef.value
  if (!el) return
  /* Skip mount for an empty zettel set — force-graph renders a
     black box for a 0-node graph, which is a worse UX than a
     one-line "no notes" message. The early return is what the
     test pins in the empty-state describe block. */
  if (graphData.value.nodes.length === 0) return

  /* Dynamic import keeps force-graph + d3 out of the main
     bundle. After the first import, subsequent mounts reuse the
     cached module. */
  const mod = await import('force-graph')
  /* force-graph's default export is a kapsule factory; its
     TS types don't narrow to our minimal interface, so we cast
     through `unknown` to avoid the overlap warning vue-tsc
     raises for the direct cast. */
  const Ctor = (mod.default ?? mod) as unknown as ForceGraphCtor
  const g = new Ctor(el)
  graph = g

  g.width(el.clientWidth || 800)
   .height(el.clientHeight || 600)
   .nodeId('id')
   .nodeLabel('title')
   .nodeVal('val')
   .linkColor(colors.value.linkColor)
  installCanvasCallback(g)
  g.onNodeClick((node) => {
    /* `getOpenPostForClicks` is the same singleton
       PreviewPane / ReadingPane use for wiki-link clicks. If
       the graph is mounted before the tabs composable has
       registered an opener (e.g. in a test), the call is a
       no-op — better than crashing. */
    const open = getOpenPostForClicks()
    if (!open) return
    open(node.path)
  })
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

  /* Center the graph on first paint. force-graph's layout is
     randomized; without a zoomToFit the user lands on a corner
     of the canvas. 800ms gives the simulation enough warmup
     ticks for the layout to settle. */
  setTimeout(() => { graph?.zoomToFit(400, 50) }, 800)
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
   editor shows up here within one debounce. */
watch(graphData, (next) => {
  if (!graph) {
    /* Mount raced with the first link index fetch — the empty
       state guard in mountGraph() prevented initial setup. Try
       again now that we have data. */
    if (next.nodes.length > 0) void mountGraph()
    return
  }
  graph.graphData({
    nodes: next.nodes.slice(),
    links: next.links.slice(),
  })
}, { deep: true })

/* Theme switch — re-install the canvas callback so the new
   colors paint. force-graph doesn't watch the closure's
   internal refs; it would keep using the old palette until the
   callback is replaced. */
watch(theme, () => {
  if (graph) {
    installCanvasCallback(graph)
    graph.linkColor(colors.value.linkColor)
  }
})
</script>

<template>
  <div ref="containerRef" class="kg-wrap" :data-theme="theme">
    <div v-if="graphData.nodes.length === 0" class="kg-empty">
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
