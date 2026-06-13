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
  _destructor: ReturnType<typeof vi.fn>
  /* Closure of the last nodeCanvasObject arg, so theme/click tests
     can drive it without re-asserting the wiring. */
  _lastNodeCanvasObject?: (node: unknown, ctx: unknown, scale: number) => void
  _lastOnNodeClick?: (node: unknown) => void
}

let _graphId = 0
const graphs: FakeGraph[] = []

/* Mocked force-graph module. We capture each `forceGraph()(el)`
   call into the `graphs` array, returning a fresh chainable
   FakeGraph every time. */
vi.mock('force-graph', () => ({
  default: () => {
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
    unmount: () => { app.unmount(); host.remove(); __resetOpenPostForClicks(null) },
  }
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  __resetLinkIndexForTesting()
  useTheme().set('light')
  graphs.length = 0
  roRegistry.length = 0
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
