// @vitest-environment jsdom
// Tests for KnowledgeGraph.vue.
//
// Three axes:
//   1. Wiring: mount calls force-graph's factory with the container,
//      then sets graphData / nodeId / nodeLabel / nodeVal / onNodeClick
//      / nodeCanvasObject. Unmount calls the force-graph destructor
//      (kapsule exposes it as `_destructor` — see node_modules).
//   2. Reactivity: when the link index changes, the component reads
//      the new nodes/links and calls `graph.graphData(next)` so the
//      simulation restarts with the fresh data.
//   3. Theme: a theme toggle re-renders the canvas — the test pins
//      that nodeCanvasObject is RE-INSTALLED, not just reused (some
//      color values change with the theme and need the new closure
//      to take effect).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, createApp, h, defineComponent } from 'vue'

/* jsdom doesn't ship matchMedia. useTheme() reads it ONCE at module
   init to default the theme when nothing is persisted, so we have
   to stub it on `window` before any import of the SUT pulls in
   the useTheme module. */
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

import KnowledgeGraph from '../KnowledgeGraph.vue'
import { useTheme } from '../../../composables/useTheme'
import { __resetLinkIndexForTesting, getLinkIndex } from '../../../composables/vault/useLinkIndex'
import { __resetOpenPostForClicks } from '../../../composables/vault/useEditorTabs'
import { __resetSelectPanelForClicks, setSelectPanelForClicks } from '../../../composables/vault/useVaultLayout'

/* Force-graph instance shape we expose to the test. The real
   library has dozens of methods; we capture just the ones the
   component touches so the test can assert on call shape. */
interface FakeGraph {
  _id: string
  graphData: ReturnType<typeof vi.fn>
  width: ReturnType<typeof vi.fn>
  height: ReturnType<typeof vi.fn>
  nodeId: ReturnType<typeof vi.fn>
  nodeLabel: ReturnType<typeof vi.fn>
  nodeVal: ReturnType<typeof vi.fn>
  nodeCanvasObject: ReturnType<typeof vi.fn>
  linkColor: ReturnType<typeof vi.fn>
  onNodeClick: ReturnType<typeof vi.fn>
  zoomToFit: ReturnType<typeof vi.fn>
  /* Camera controls. The component uses these to pin a fixed
     zoom + center instead of calling zoomToFit, which would
     make a 2-node edgeless cluster fill the canvas. */
  zoom: ReturnType<typeof vi.fn>
  centerAt: ReturnType<typeof vi.fn>
  /* Hard-stop conditions for the simulation. The component
     sets these to 1500ms / 150 ticks so the simulation stops
     after the layout has converged, preventing long-tail
     re-renders (which read as "flickering" on the canvas). */
  cooldownTime: ReturnType<typeof vi.fn>
  cooldownTicks: ReturnType<typeof vi.fn>
  /* d3Force is the escape hatch force-graph exposes for tweaking
     d3-force-3d forces (link, charge, center, dagRadial). The
     component uses it on the 'charge' slot to lower the default
     -30 strength — see KnowledgeGraph.mountGraph. We mock it as
     a name-keyed map so the test can assert specific forces
     were mutated. */
  _d3Forces: Map<string, { strength: ReturnType<typeof vi.fn> }>
  d3Force: ReturnType<typeof vi.fn>
  _destructor: ReturnType<typeof vi.fn>
  /* Closure of the last nodeCanvasObject arg, so theme/click tests
     can drive it without re-asserting the wiring. */
  _lastNodeCanvasObject?: (node: unknown, ctx: unknown, scale: number) => void
  _lastOnNodeClick?: (node: unknown) => void
}

let _graphId = 0
const graphs: FakeGraph[] = []

/* Mocked force-graph module. We capture each `new forceGraph()(el)`
   call into the `graphs` array, returning a fresh chainable
   FakeGraph every time. The export is a class-like construct
   (kapsule comp): invoking it with `new` runs the real init
   path in production. In the test we treat it as a function
   that returns the chainable; the `new` call still works
   because the function ignores `this` and returns the chainable. */
/* When `failNextImport` is set, the next time the mock is
   `new`-invoked it throws synchronously, simulating a corrupt
   force-graph module / failed `init()` path. The component's
   try/catch around `await import + new Ctor` should catch it and
   render the load-error empty state. We attach the throw to the
   constructor call rather than to the import itself because
   vitest's module-factory errors are reported as unhandled even
   when the consumer awaits + catches — putting the throw on the
   ctor keeps the error on a path the SUT visibly handles. */
let failNextImport: Error | null = null

vi.mock('force-graph', () => ({
  default: function FakeForceGraph() {
    if (failNextImport) {
      const err = failNextImport
      failNextImport = null
      throw err
    }
    const g: FakeGraph = {
      _id: 'g-' + (++_graphId),
      graphData: vi.fn().mockReturnThis(),
      width: vi.fn().mockReturnThis(),
      height: vi.fn().mockReturnThis(),
      nodeId: vi.fn().mockReturnThis(),
      nodeLabel: vi.fn().mockReturnThis(),
      nodeVal: vi.fn().mockReturnThis(),
      nodeCanvasObject: vi.fn((cb: (n: unknown, c: unknown, s: number) => void) => {
        g._lastNodeCanvasObject = cb
        return g
      }),
      linkColor: vi.fn().mockReturnThis(),
      onNodeClick: vi.fn((cb: (n: unknown) => void) => {
        g._lastOnNodeClick = cb
        return g
      }),
      zoomToFit: vi.fn(),
      /* Camera controls are chainable in force-graph (return `this`).
         We expose them as mockReturnThis so a chain like
         g.zoom(k).centerAt(...) works in the implementation without
         the test having to wire up a return. */
      zoom: vi.fn().mockReturnThis(),
      centerAt: vi.fn().mockReturnThis(),
      /* cooldownTime and cooldownTicks are also chainable. The
         test asserts the exact ms/tick values to lock the
         hard-stop behavior in. */
      cooldownTime: vi.fn().mockReturnThis(),
      cooldownTicks: vi.fn().mockReturnThis(),
      /* force-graph pre-registers four forces (link, charge, center,
         dagRadial). The component only touches 'charge', but we
         seed all four with strength() spies so a future expansion
         (e.g. weakening the center force, enabling dagRadial) can
         assert against them without re-mocking. */
      _d3Forces: new Map([
        ['link', { strength: vi.fn().mockReturnThis() }],
        ['charge', { strength: vi.fn().mockReturnThis() }],
        ['center', { strength: vi.fn().mockReturnThis() }],
        ['dagRadial', { strength: vi.fn().mockReturnThis() }],
      ]),
      d3Force: vi.fn(function (this: FakeGraph, name: string) {
        return this._d3Forces.get(name)
      }),
      _destructor: vi.fn(),
    }
    graphs.push(g)
    return g
  },
}))

/* ResizeObserver stub: jsdom doesn't fire it. The component uses
   it to push container width/height into force-graph after mount.
   We capture registrations so we can fire them manually. */
const roRegistry: Array<{ cb: ResizeObserverCallback; target: Element }> = []
;(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.cb = cb }
  observe(target: Element) { roRegistry.push({ cb: this.cb, target }) }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
} as unknown as typeof ResizeObserver

function fireResizeObservers() {
  for (const r of roRegistry) r.cb([], r.target as unknown as ResizeObserver)
}
/* fireResizeObservers is exported for future tests that may need
   to drive a ResizeObserver tick; right now the wiring tests
   don't need it (graph.width / .height are mocked as chainable
   no-ops). Keep the helper accessible so the next regression
   (e.g. a real-width path test) doesn't have to redefine it. */
void fireResizeObservers

function setIndex(state: { paths: string[]; outgoing: Record<string, Array<{ target: string; kind: 'wiki' | 'md' }>> }) {
  getLinkIndex().value = {
    paths: new Set(state.paths),
    outgoing: state.outgoing,
    lastFetched: 0,
  }
}

function mountStandalone() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  /* Install a fake openPost so onNodeClick can call it. */
  let lastOpened: string | null = null
  __resetOpenPostForClicks((p: string) => { lastOpened = p })
  /* Install a fake selectPanel so onNodeClick can close the graph
     panel. Mirrors what VaultView does onMounted. */
  let lastPanel: string | null = null
  setSelectPanelForClicks((p: string) => { lastPanel = p })
  const app = createApp(defineComponent({
    setup() { return () => h(KnowledgeGraph) },
  }))
  app.mount(host)
  /* force-graph is dynamic-imported. Microtask + a few macrotask
     turns are enough to let the import resolve in vitest's jsdom
     environment. */
  return {
    host,
    lastOpened: () => lastOpened,
    lastPanel: () => lastPanel,
    unmount: () => {
      app.unmount()
      host.remove()
      __resetOpenPostForClicks(null)
      __resetSelectPanelForClicks()
    },
  }
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  __resetLinkIndexForTesting()
  __resetSelectPanelForClicks()
  useTheme().set('light')
  graphs.length = 0
  roRegistry.length = 0
  failNextImport = null
})

describe('KnowledgeGraph — wiring', () => {
  it('mounts a force-graph instance into the container', async () => {
    setIndex({ paths: ['zettel/a', 'zettel/b'], outgoing: { 'zettel/a': [{ target: 'zettel/b', kind: 'wiki' }] } })
    const { unmount } = mountStandalone()
    await settle()

    expect(graphs).toHaveLength(1)
    const g = graphs[0]
    expect(g.graphData).toHaveBeenCalled()
    expect(g.nodeId).toHaveBeenCalledWith('id')
    expect(g.nodeLabel).toHaveBeenCalledWith('title')
    expect(g.nodeVal).toHaveBeenCalledWith('val')
    expect(g.nodeCanvasObject).toHaveBeenCalled()
    expect(g.onNodeClick).toHaveBeenCalled()
    unmount()
  })

  it('receives the computed graph data on mount', async () => {
    setIndex({ paths: ['zettel/a', 'zettel/b'], outgoing: { 'zettel/a': [{ target: 'zettel/b', kind: 'wiki' }] } })
    const { unmount } = mountStandalone()
    await settle()
    const call = graphs[0].graphData.mock.calls[0]?.[0] as { nodes: Array<{ id: string }>; links: Array<{ source: string; target: string }> }
    expect(call.nodes.map((n) => n.id).sort()).toEqual(['zettel/a', 'zettel/b'])
    expect(call.links).toEqual([{ source: 'zettel/a', target: 'zettel/b' }])
    unmount()
  })

  it('calls the force-graph destructor on unmount', async () => {
    setIndex({ paths: ['zettel/a'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    expect(graphs[0]._destructor).not.toHaveBeenCalled()
    unmount()
    expect(graphs[0]._destructor).toHaveBeenCalledTimes(1)
  })

  it('loosens charge and tightens center so edgeless nodes stay near the center', async () => {
    /* force-graph wires forceManyBody() (charge, default -30) and
       forceCenter() (center, default 0.1). With defaults the
       charge repels isolated nodes to opposite canvas corners.
       The component overrides charge to -1 and center to 0.3
       (3x default — strong enough to win the 2-node tug-of-war,
       soft enough that the spring doesn't overshoot the
       equilibrium and oscillate). Earlier passes tried center
       values up to 2.0 (20x default) and the user reported
       "flickering" — the Barnes-Hut quadtree even briefly
       rendered isolated nodes twice during the warmup tick
       chain. 0.3 is the sweet spot. */
    setIndex({ paths: ['zettel/a', 'zettel/b'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    expect(graphs[0].d3Force).toHaveBeenCalledWith('charge')
    expect(graphs[0].d3Force).toHaveBeenCalledWith('center')
    const charge = graphs[0]._d3Forces.get('charge')!
    const center = graphs[0]._d3Forces.get('center')!
    expect(charge.strength).toHaveBeenCalledWith(-1)
    expect(center.strength).toHaveBeenCalledWith(0.3)
    unmount()
  })

  it('pins a fixed zoom + center so 2-node edgeless clusters render as a small cluster', async () => {
    /* Even with the simulation-space equilibrium at d=2.58
       (charge=-1, center=0.3), a naive call to g.zoomToFit()
       would scale the bounding box to fill the canvas — 2 nodes
       at opposite edges of the bbox end up at opposite edges of
       the canvas, reading as "they're far apart" even though
       the simulation is converged. The component pins zoom=50
       (1 sim unit = 50px) and centers at (0, 0) so a 2-node
       cluster renders as ~129px and a 30-node cluster renders
       as ~1000px (fits 1280px canvas with padding). This is the
       regression guard: if someone swaps in a zoomToFit call
       here, 2-node edgeless graphs go back to "two dots at the
       canvas edges". */
    setIndex({ paths: ['zettel/a', 'zettel/b'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    expect(graphs[0].zoom).toHaveBeenCalledWith(50)
    expect(graphs[0].centerAt).toHaveBeenCalledWith(0, 0, 0)
    expect(graphs[0].zoomToFit).not.toHaveBeenCalled()
    unmount()
  })

  it('hard-stops the simulation so the canvas stops re-rendering once the layout converges', async () => {
    /* force-graph defaults to cooldownTime=Infinity and
       cooldownTicks=Infinity, so the simulation only stops when
       alpha decays below alphaMin (~5s at 60fps). Even after the
       positions visually converge, residual jitter can keep
       re-rendering the canvas until alpha cools — the user
       reads that as "flickering" for 1-2 seconds. The component
       pins cooldownTime=1500ms and cooldownTicks=150 so the
       simulation stops as soon as either threshold is hit,
       freezing the canvas at the converged layout. This is the
       regression guard: removing either line means the flicker
       comes back. */
    setIndex({ paths: ['zettel/a', 'zettel/b'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    expect(graphs[0].cooldownTime).toHaveBeenCalledWith(1500)
    expect(graphs[0].cooldownTicks).toHaveBeenCalledWith(150)
    unmount()
  })
})

describe('KnowledgeGraph — reactiveness', () => {
  it('re-fetches graph data and pushes it to the instance when the link index changes', async () => {
    setIndex({ paths: ['zettel/a'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    expect(graphs[0].graphData.mock.calls).toHaveLength(1)

    /* Mutate the singleton — the component's watch should re-run
       and call graphData() with the new payload. */
    setIndex({
      paths: ['zettel/a', 'zettel/b', 'zettel/c'],
      outgoing: {
        'zettel/a': [{ target: 'zettel/b', kind: 'wiki' }],
        'zettel/b': [{ target: 'zettel/c', kind: 'wiki' }],
      },
    })
    await settle()
    expect(graphs[0].graphData.mock.calls.length).toBeGreaterThanOrEqual(2)
    const last = graphs[0].graphData.mock.calls.at(-1)?.[0] as { nodes: Array<{ id: string }>; links: unknown[] }
    expect(last.nodes).toHaveLength(3)
    expect(last.links).toHaveLength(2)
    unmount()
  })
})

describe('KnowledgeGraph — node click', () => {
  it('opens the clicked node via the shared openPost singleton', async () => {
    setIndex({ paths: ['zettel/a', 'zettel/b'], outgoing: { 'zettel/a': [{ target: 'zettel/b', kind: 'wiki' }] } })
    const { unmount, lastOpened } = mountStandalone()
    await settle()

    /* Drive the onNodeClick callback directly. We don't go
       through real pointer events — the closure is the load-
       bearing part. */
    graphs[0]._lastOnNodeClick!({ id: 'zettel/a', path: 'zettel/a' })
    await nextTick()
    expect(lastOpened()).toBe('zettel/a')
    unmount()
  })

  it('does not crash if openPost is not registered yet', async () => {
    setIndex({ paths: ['zettel/a'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    __resetOpenPostForClicks(null)
    expect(() => graphs[0]._lastOnNodeClick!({ id: 'zettel/a', path: 'zettel/a' })).not.toThrow()
    unmount()
  })

  it('closes the graph panel by calling selectPanel("files") on node click', async () => {
    setIndex({ paths: ['zettel/a', 'zettel/b'], outgoing: { 'zettel/a': [{ target: 'zettel/b', kind: 'wiki' }] } })
    const { unmount, lastPanel } = mountStandalone()
    await settle()
    graphs[0]._lastOnNodeClick!({ id: 'zettel/a', path: 'zettel/a' })
    await nextTick()
    expect(lastPanel()).toBe('files')
    unmount()
  })

  it('does not crash if selectPanel is not registered yet', async () => {
    setIndex({ paths: ['zettel/a'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    __resetSelectPanelForClicks()
    expect(() => graphs[0]._lastOnNodeClick!({ id: 'zettel/a', path: 'zettel/a' })).not.toThrow()
    unmount()
  })
})

describe('KnowledgeGraph — theme switch', () => {
  it('re-installs nodeCanvasObject so the new colors take effect', async () => {
    setIndex({ paths: ['zettel/a'], outgoing: {} })
    const { unmount } = mountStandalone()
    await settle()
    const callsBefore = graphs[0].nodeCanvasObject.mock.calls.length

    useTheme().set('dark')
    await settle()
    /* The component rebuilds its canvas callback on every theme
       change so the new color computed takes effect on the next
       frame. The exact count can be 1 (single re-install) or
       more (re-install on every reactive tick) — the load-
       bearing assertion is "at least one more than before". */
    expect(graphs[0].nodeCanvasObject.mock.calls.length).toBeGreaterThan(callsBefore)
    useTheme().set('light')
    unmount()
  })
})

describe('KnowledgeGraph — empty state', () => {
  it('shows a friendly message when there are no zettel notes', async () => {
    setIndex({ paths: ['inbox/x'], outgoing: {} })
    const { unmount, host } = mountStandalone()
    await settle()
    /* The component should not have called force-graph at all if
       the zettel set is empty (force-graph is expensive to
       spin up for an empty graph). */
    expect(graphs).toHaveLength(0)
    expect(host.textContent).toMatch(/zettel|还没有|写一条/)
    unmount()
  })
})

describe('KnowledgeGraph — load error', () => {
  it('surfaces a friendly message when the force-graph import fails', async () => {
    failNextImport = new Error('mocked chunk failure')
    setIndex({ paths: ['zettel/a'], outgoing: {} })
    const { unmount, host } = mountStandalone()
    await settle()
    /* No graph was instantiated — the import threw and the
       component caught it. The user sees the error message
       instead of a blank canvas. */
    expect(graphs).toHaveLength(0)
    expect(host.textContent).toMatch(/图谱加载失败/)
    expect(host.textContent).toMatch(/mocked chunk failure/)
    unmount()
  })
})
