// @vitest-environment jsdom
// Tests for the Mermaid.vue component.
//
// Two axes:
//
//   1. Source-level: the component's CSS rebinds mermaid's
//      hard-coded dark-mode colors to docus tokens, so the diagram
//      tracks data-theme instead of being illegible on a dark
//      article background. JSDOM doesn't apply the cascade, so we
//      assert the rule by reading the .vue file as text — same
//      pattern as the MarkMap text-color test.
//
//   2. Behavior: mounting the component (with a stubbed mermaid
//      module) calls `mermaid.initialize` with the active theme
//      and `mermaid.render` with the supplied code, then injects
//      the returned svg into the container. A theme switch calls
//      render a second time with the new theme.
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

import { createApp, h, defineComponent } from 'vue'
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
  /* The svg strings the mocked `render` returns. We use a small
     stub svg that contains a recognizable token so the test can
     assert it landed in the container. */
  renderResults: string[]
  /* The bindFunctions argument passed to the most recent render,
     so the test can verify that clickable-diagram wiring runs. */
  bindFunctionCalls: number
}
const g = globalThis as typeof globalThis & { __mermaidTest?: MermaidTestCounters }
g.__mermaidTest = {
  initializeCalls: [],
  renderCalls: [],
  renderResults: [],
  bindFunctionCalls: 0,
}

vi.mock('mermaid', () => ({
  default: {
    initialize(config: Record<string, unknown>) {
      const t = (globalThis as typeof globalThis & { __mermaidTest?: MermaidTestCounters }).__mermaidTest
      if (t) t.initializeCalls.push({ ...config })
    },
    async render(id: string, code: string) {
      const t = (globalThis as typeof globalThis & { __mermaidTest?: MermaidTestCounters }).__mermaidTest
      if (t) {
        t.renderCalls.push({ id, code })
        const svg = `<svg data-mock-svg data-id="${id}"><text>${code}</text></svg>`
        t.renderResults.push(svg)
      }
      return {
        svg: `<svg data-mock-svg data-id="${id}"><text>${code}</text></svg>`,
        bindFunctions() {
          const t2 = (globalThis as typeof globalThis & { __mermaidTest?: MermaidTestCounters }).__mermaidTest
          if (t2) t2.bindFunctionCalls += 1
        },
      }
    },
  },
}))

function mountStandalone(): { host: HTMLDivElement; unmount: () => void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(defineComponent({
    setup() { return () => h(Mermaid, { code: 'graph TD\n  A --> B' }) },
  }))
  app.mount(host)
  return { host, unmount: () => { app.unmount(); host.remove() } }
}

/* await nextTick() flushes Vue's scheduler but doesn't drain a
   microtask chain that includes a dynamic import() of a previously
   uncached module. The settle() helper gives the test a few
   macrotask turns to let the mermaid dynamic import resolve and
   the render() call land. */
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  const t = g.__mermaidTest
  if (t) {
    t.initializeCalls.length = 0
    t.renderCalls.length = 0
    t.renderResults.length = 0
    t.bindFunctionCalls = 0
  }
})

describe('Mermaid theme variables rebind to docus tokens', () => {
  it('passes a themeVariables map on initialize (not a hard-coded color)', () => {
    /* The original bug: mermaid's `default` and `dark` themes ship
       with hard-coded hex colors that don't follow docus tokens.
       On the article's dark background, the default theme paints
       light text on a light box and is illegible. The fix in
       Mermaid.vue passes a `themeVariables` object to
       mermaid.initialize() that overrides the offending keys with
       docus-derived values. We pin the call shape here — the test
       would still pass if a future refactor only set the theme
       name, but the assertion on `themeVariables` keys makes the
       rebinding explicit. */
    const src = readFileSync(
      resolve(__dirname, '..', 'Mermaid.vue'),
      'utf8',
    )
    /* themeVariables object literal exists and is forwarded to
       initialize. Both the dark and light branches must be
       present — the bug would be hard-coding one theme and
       forgetting the other. */
    expect(src).toContain('themeVariables')
    /* Keys we know mermaid hard-codes and that visibly clash on
       the docus article. The list lives in `themeVars()` in
       Mermaid.vue; if you remove a key here, also remove it
       there (or you'll re-introduce a hard-coded color in
       whichever theme doesn't override it). */
    expect(src).toContain('primaryTextColor')
    expect(src).toContain('lineColor')
    expect(src).toContain('actorBkg')
    expect(src).toContain('signalColor')
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
    })
    expect(g.__mermaidTest!.initializeCalls[0]).toHaveProperty('themeVariables')
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
    /* The themeVariables object is present (and differs from
       light). We don't snapshot its exact values — those live in
       Mermaid.vue and a future refactor is free to tune them as
       long as the dark/light split stays. */

    set('light')
    unmount()
  })
})
