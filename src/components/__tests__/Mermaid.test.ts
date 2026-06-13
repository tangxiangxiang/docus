// @vitest-environment jsdom
// Tests for the Mermaid.vue component.
//
// Three axes:
//
//   1. Source-level: the component uses mermaid's built-in
//      `default` / `dark` themes (NOT a custom themeVariables
//      object). Custom themeVariables interact badly with
//      mermaid's internal layout and can produce
//      `<g transform="translate(NaN,NaN) …">` in the output —
//      see the regression in test #3. The source check pins the
//      call shape: no themeVariables, just theme name.
//
//   2. Behavior: mounting the component (with a stubbed mermaid
//      module) calls `mermaid.initialize` with the active theme
//      and `mermaid.render` with the supplied code, then injects
//      the returned svg into the container. A theme switch calls
//      render a second time with the new theme.
//
//   3. NaN regression: if mermaid returns an svg containing
//      `translate(NaN`, Mermaid.vue refuses to inject it (the
//      browser would log a parser error AND the diagram would be
//      invisible). The ResizeObserver path retries once the host
//      gets a real size.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* jsdom doesn't ship matchMedia; useTheme() reads it on first
   import. The defineProperty must run BEFORE the SUT/composable
   imports below, so we do it at the top of the file. */
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

import { createApp, h, defineComponent, nextTick } from 'vue'
import Mermaid from '../Mermaid.vue'
import { useTheme } from '../../composables/useTheme'

/* Counters that survive across the dynamic import() inside
   Mermaid.vue. We bump them from the mocked module factory. The
   vitest mock factory is evaluated at module-init time, before
   the `const …` line below would otherwise run — but we keep the
   arrays on globalThis so the factory (which hoists above the
   const) and the test code see the same instance. */
interface MermaidTestCounters {
  initializeCalls: Array<Record<string, unknown>>
  renderCalls: Array<{ id: string; code: string }>
  /* `null` = "use the default stub svg" (clean). A non-null
     string is the svg that the mocked `render` will return.
     If it's an array, the i-th render() call returns the i-th
     entry (or the last entry if the index exceeds the array
     length) — used to simulate mermaid's NaN-then-clean
     sequence for the retry test. */
  overrideSvg: string | string[] | null
  bindFunctionCalls: number
}
const g = globalThis as typeof globalThis & { __mermaidTest?: MermaidTestCounters }
g.__mermaidTest = {
  initializeCalls: [],
  renderCalls: [],
  overrideSvg: null,
  bindFunctionCalls: 0,
}

const cleanStubSvg = (id: string, code: string) =>
  `<svg data-mock-svg data-id="${id}"><text>${code}</text></svg>`

vi.mock('mermaid', () => ({
  default: {
    initialize(config: Record<string, unknown>) {
      const t = (globalThis as typeof globalThis & { __mermaidTest?: MermaidTestCounters }).__mermaidTest
      if (t) t.initializeCalls.push({ ...config })
    },
    async render(id: string, code: string) {
      const t = (globalThis as typeof globalThis & { __mermaidTest?: MermaidTestCounters }).__mermaidTest
      if (!t) return { svg: '', bindFunctions() { /* */ } }
      t.renderCalls.push({ id, code })
      const override = t.overrideSvg
      let svg: string
      if (Array.isArray(override)) {
        const i = Math.min(t.renderCalls.length - 1, override.length - 1)
        svg = override[i] ?? cleanStubSvg(id, code)
      } else {
        svg = override ?? cleanStubSvg(id, code)
      }
      return {
        svg,
        bindFunctions() {
          t.bindFunctionCalls += 1
        },
      }
    },
  },
}))

/* Stub the layout-reading getters on the .mermaid-svg container
   so Mermaid.vue's `hasNonZeroSize()` gate passes — jsdom doesn't
   implement layout and returns 0 for both. Real browsers report
   a positive number for a visible element, which is what we
   approximate here. */
function stubLayout(el: HTMLElement, width: number): void {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width })
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: 100,
    width, height: 100,
    toJSON() { return this },
  })
}

function mountStandalone(): { host: HTMLDivElement; unmount: () => void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(defineComponent({
    setup() { return () => h(Mermaid, { code: 'graph TD\n  A --> B' }) },
  }))
  app.mount(host)
  const container = host.querySelector<HTMLElement>('.mermaid-svg')
  if (container) stubLayout(container, 800)
  return { host, unmount: () => { app.unmount(); host.remove() } }
}

/* await nextTick() flushes Vue's scheduler but doesn't drain a
   microtask chain that includes a dynamic import() of a previously
   uncached module. The settle() helper gives the test a few
   macrotask turns to let the mermaid dynamic import resolve and
   the render() call land. The rAF that Mermaid.vue uses for the
   first render also needs a frame. */
async function settle(rounds = 5) {
  /* jsdom's `requestAnimationFrame` is polyfilled as
     `setTimeout(cb, 16)`. Mermaid.vue's scheduleRender queues
     a DOUBLE rAF (to let a pending theme-toggle paint settle
     before the layout-sensitive render). Total wait = 2 × 16ms
     = 32ms. 5 × 20ms = 100ms gives us comfortable headroom for
     the dynamic import + the mermaid mock to land too. */
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setTimeout(r, 20))
  }
}

beforeEach(() => {
  const t = g.__mermaidTest
  if (t) {
    t.initializeCalls.length = 0
    t.renderCalls.length = 0
    t.overrideSvg = null
    t.bindFunctionCalls = 0
  }
  /* Force a clean theme between tests — useTheme is a module
     singleton and previous tests may have flipped it to dark. */
  useTheme().set('light')
})

describe('Mermaid uses built-in themes (no custom themeVariables)', () => {
  it('does not pass themeVariables to mermaid.initialize', () => {
    /* Custom themeVariables can interact badly with mermaid's
       internal layout and produce `<g transform="translate(NaN,NaN) …">`
       in the output. We pin the call shape here: mermaid
       receives only the theme name and securityLevel, never a
       themeVariables object. Theme integration is done via CSS
       overrides on the generated svg (see style.css). */
    const src = readFileSync(
      resolve(__dirname, '..', 'Mermaid.vue'),
      'utf8',
    )
    expect(src).not.toMatch(/themeVariables\s*:/)
    expect(src).not.toMatch(/function\s+themeVars\b/)
    /* The two built-in theme names are still wired up. */
    expect(src).toContain("'dark'")
    expect(src).toContain("'default'")
  })
})

describe('Mermaid mount + render', () => {
  it('calls initialize + render on mount and writes the svg into the container', async () => {
    const { unmount, host } = mountStandalone()
    await settle()

    /* The mermaid module was imported, initialize was called once
       with theme: 'default' (test starts in light mode), and
       render was called once with the supplied code. */
    expect(g.__mermaidTest!.initializeCalls.length).toBe(1)
    expect(g.__mermaidTest!.initializeCalls[0]).toMatchObject({
      theme: 'default',
      startOnLoad: false,
      securityLevel: 'strict',
    })
    /* themeVariables must NOT be in the call — see source test. */
    expect(g.__mermaidTest!.initializeCalls[0]).not.toHaveProperty('themeVariables')
    expect(g.__mermaidTest!.renderCalls.length).toBe(1)
    expect(g.__mermaidTest!.renderCalls[0].code).toBe('graph TD\n  A --> B')

    /* The svg landed in the container. We assert on the
       data-mock-svg attribute the mock stamped on the svg. */
    const svg = host.querySelector('svg[data-mock-svg]')
    expect(svg).toBeTruthy()
    /* bindFunctions was wired so clickable diagrams get
       interactivity. */
    expect(g.__mermaidTest!.bindFunctionCalls).toBe(1)

    unmount()
  })

  it('re-renders on a theme switch (with the new theme name)', async () => {
    const { unmount } = mountStandalone()
    await settle()
    expect(g.__mermaidTest!.renderCalls.length).toBe(1)
    expect(g.__mermaidTest!.initializeCalls[0].theme).toBe('default')

    const { set } = useTheme()
    set('dark')
    await settle()

    /* A second render must have happened with the dark theme. */
    expect(g.__mermaidTest!.renderCalls.length).toBe(2)
    const lastInit = g.__mermaidTest!.initializeCalls.at(-1)
    expect(lastInit?.theme).toBe('dark')

    set('light')
    unmount()
  })

  it('skips render when the container has zero width (tab hidden / collapsed pane)', async () => {
    /* Regression test for `<g transform="translate(NaN,NaN) …">`:
       when mermaid.render() is called on a 0×0 container (a
       hidden tab, a collapsed vault split), the layout engine
       produces NaN coordinates that the browser then rejects.
       Mermaid.vue gates render() on a non-zero width and
       re-tries via ResizeObserver once the container gets one. */
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp(defineComponent({
      setup() { return () => h(Mermaid, { code: 'graph TD\n  A --> B' }) },
    }))
    app.mount(host)

    /* No layout stub — this element is "hidden" from the
       perspective of Mermaid's render gate. */
    await settle()
    expect(g.__mermaidTest!.renderCalls.length).toBe(0)

    /* Now make the container visible (simulating a tab switch /
       split open). ResizeObserver doesn't fire synchronously in
       jsdom, so we exercise the same code path by flipping the
       theme, which goes through scheduleRender and checks size. */
    const container = host.querySelector<HTMLElement>('.mermaid-svg')!
    stubLayout(container, 800)

    useTheme().set('dark')
    await settle()
    expect(g.__mermaidTest!.renderCalls.length).toBe(1)
    expect(g.__mermaidTest!.initializeCalls.at(-1)?.theme).toBe('dark')

    useTheme().set('light')
    app.unmount()
    host.remove()
  })
})

describe('Mermaid NaN-detection fallback', () => {
  it('refuses to inject an svg containing translate(NaN and shows a friendly error', async () => {
    /* Defense-in-depth: if the size gate ever fails to catch a
       0×0 host (e.g. a parent with a CSS transform that
       collapses layout), mermaid's output can contain
       `<g transform="translate(NaN,NaN) …">`. The browser logs

         <g> attribute transform: Expected number, "translate(NaN,NaN) scale(N…"

       and the diagram is invisible. Mermaid.vue scans the
       returned string, refuses to inject it, and surfaces a
       friendly error in its place. Mermaid.vue also retries up
       to 3 times (with a fresh id each attempt, so the module-
       level cache is fresh) before giving up — the retry
       handles the rare case where mermaid's d3 simulation
       gets a bad initial RNG seed. */
    g.__mermaidTest!.overrideSvg =
      '<svg data-mock-svg><g class="node" transform="translate(NaN,NaN) scale(1)"><rect/></g></svg>'

    const { unmount, host } = mountStandalone()
    await settle()

    /* All 3 retry attempts landed; none produced a clean svg. */
    expect(g.__mermaidTest!.renderCalls.length).toBe(3)
    const container = host.querySelector<HTMLElement>('.mermaid-svg')!
    expect(container.querySelector('svg[data-mock-svg]')).toBeNull()
    expect(container.innerHTML).toBe('')
    /* The friendly error is shown. */
    const errorEl = host.querySelector<HTMLElement>('.mermaid-error')
    expect(errorEl).toBeTruthy()
    expect(errorEl!.textContent).toMatch(/布局异常/)

    /* bindFunctions was NOT called — there is no svg to bind to. */
    expect(g.__mermaidTest!.bindFunctionCalls).toBe(0)

    unmount()
  })

  it('uses the first clean svg when the retry succeeds after a NaN attempt', async () => {
    /* Retry path: first mermaid.render() returns NaN, second
       returns clean. Mermaid.vue's retry loop should break on
       the clean svg and inject it — no error shown, no
       further attempts. */
    g.__mermaidTest!.overrideSvg = [
      '<svg data-mock-svg data-broken><g transform="translate(NaN,NaN) scale(1)"></g></svg>',
      cleanStubSvg('retry', 'graph TD\n  A --> B'),
    ]

    const { unmount, host } = mountStandalone()
    await settle()

    /* Exactly 2 attempts — the loop broke on the clean one. */
    expect(g.__mermaidTest!.renderCalls.length).toBe(2)
    const svgEl = host.querySelector('svg[data-mock-svg]')
    expect(svgEl).toBeTruthy()
    expect(svgEl!.getAttribute('data-broken')).toBeNull()
    /* No error message — the retry succeeded. */
    const errorEl = host.querySelector<HTMLElement>('.mermaid-error')
    expect(errorEl).toBeFalsy()
    /* bindFunctions ran once for the successful svg. */
    expect(g.__mermaidTest!.bindFunctionCalls).toBe(1)

    unmount()
  })
})
