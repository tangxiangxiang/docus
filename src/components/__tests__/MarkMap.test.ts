// @vitest-environment jsdom
// Regression test for the light/dark theme toggle bug in MarkMap.
//
// The first version of MarkMap re-keyed the <svg> on theme change to
// force a remount. That looked correct but silently broke: the svg
// was swapped (DOM element replaced) while the markmap instance and
// its d3 listeners stayed attached to the *detached* svg. The new
// svg was empty and every theme toggle leaked a markmap instance.
//
// The fix is to keep the svg stable and explicitly drop + recreate
// the markmap instance when the theme changes. This test pins that
// behavior by mounting the real MarkMap component with stubbed
// markmap-lib / markmap-view modules and asserting that:
//
//   1. Markmap.create is called once on mount
//   2. Toggling the theme causes a fresh create() (and destroy on the
//      previous instance) — no leak, no stale svg
//   3. The destroy()-then-create() happens on the SAME svg element,
//      i.e. the DOM element is stable across the theme flip
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* jsdom doesn't ship matchMedia. useTheme() reads it ONCE at module
   init to default the theme when nothing is persisted, so we have
   to stub it on `window` before any import of the SUT pulls in
   the useTheme module. The defineProperty runs synchronously at
   the top of this file, before the next imports below. */
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
import MarkMap from '../MarkMap.vue'
import { useTheme } from '../../composables/useTheme'

/* Counters that survive across the dynamic import() calls inside
   MarkMap. We bump them from the mocked module factory. The
   vitest mock factory is evaluated at module-init time, before the
   `const createCalls = …` line below would otherwise run — but
   we keep the arrays on globalThis so the factory (which hoists
   above the const) and the test code see the same instance. */
interface MarkmapTestCounters {
  createCalls: SVGSVGElement[]
  createOptions: Array<Record<string, unknown>>
  destroyCalls: number[]
  setOptionsCalls: Array<Record<string, unknown>>
}
const g = globalThis as typeof globalThis & { __markmapTest?: MarkmapTestCounters }
g.__markmapTest = { createCalls: [], createOptions: [], destroyCalls: [], setOptionsCalls: [] }

vi.mock('markmap-lib', () => ({
  Transformer: class {
    transform() {
      return { root: { content: 'root', children: [] }, features: {} }
    }
    getUsedAssets() { return { styles: '', scripts: '' } }
  },
}))

vi.mock('markmap-view', () => ({
  Markmap: {
    create(svg: SVGSVGElement, opts?: Record<string, unknown>) {
      const t = (globalThis as typeof globalThis & { __markmapTest?: MarkmapTestCounters }).__markmapTest
      if (t) {
        t.createCalls.push(svg)
        t.createOptions.push({ ...(opts ?? {}) })
      }
      return {
        destroy() {
          const t2 = (globalThis as typeof globalThis & { __markmapTest?: MarkmapTestCounters }).__markmapTest
          if (t2) t2.destroyCalls.push(t2.createCalls.length)
        },
        fit() { /* no-op for the test */ },
        setOptions(opts: Record<string, unknown>) {
          const t2 = (globalThis as typeof globalThis & { __markmapTest?: MarkmapTestCounters }).__markmapTest
          if (t2) t2.setOptionsCalls.push({ ...opts })
        },
      }
    },
  },
  loadCSS: () => {},
  loadJS: () => {},
  deriveOptions: () => ({}),
}))

/* Captured `ResizeObserver` callback registry: MarkMap.vue installs
   a ResizeObserver on the widget wrapper to detect a tab being
   hidden (display:none collapses the wrapper to 0×0). jsdom ships
   a `ResizeObserver` that never fires on its own, so we replace
   it with a manual-fire stub for the hidden-host tests. Each
   `observe` call registers a callback; tests can then simulate a
   size change by calling `fireAll()` after flipping the
   clientWidth. The production code path is unchanged — it still
   uses the global `ResizeObserver`. */
interface FakeResizeObserver {
  cb: ResizeObserverCallback
  target: Element
}
const g3 = globalThis as typeof globalThis & { __resizeObserverRegistry?: FakeResizeObserver[] }
g3.__resizeObserverRegistry = []
globalThis.ResizeObserver = class {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(target: Element) {
    g3.__resizeObserverRegistry!.push({ cb: this.cb, target })
  }
  unobserve() { /* no-op for the test */ }
  disconnect() {
    g3.__resizeObserverRegistry = g3.__resizeObserverRegistry!.filter(
      (r) => r.cb !== this.cb,
    )
  }
} as unknown as typeof ResizeObserver

function fireResizeObservers() {
  for (const r of g3.__resizeObserverRegistry!) {
    r.cb([], r.target as unknown as ResizeObserver)
  }
}

// Import AFTER the mocks are registered.
// (Static imports above — vi.mock() is hoisted by vitest, so the
// mocked module factories take effect by the time the import
// statements resolve.)

function mountStandalone(): { host: HTMLDivElement; unmount: () => void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(defineComponent({
    setup() { return () => h(MarkMap, { content: '# Root\n## Branch' }) },
  }))
  app.mount(host)
  /* jsdom doesn't implement layout; clientWidth is 0 on every
     element, which would cause MarkMap's size gate to skip the
     mount. Stub a real width on the .markmap-svg child so the
     gate passes — mirrors what a real browser reports for a
     visible element. */
  const svg = host.querySelector<SVGSVGElement>('svg.markmap-svg')
  if (svg) {
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 800 })
  }
  return { host, unmount: () => { app.unmount(); host.remove() } }
}

/* `await nextTick()` flushes Vue's scheduler but doesn't necessarily
   drain a microtask chain that includes `import()` of a previously
   uncached module. We give the test a few macrotask turns to let
   the markmap-lib / markmap-view dynamic imports resolve and the
   MarkMap.create call land. */
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  const t = g.__markmapTest
  if (t) {
    t.createCalls.length = 0
    t.createOptions.length = 0
    t.destroyCalls.length = 0
    t.setOptionsCalls.length = 0
  }
})

describe('MarkMap text color follows the active theme', () => {
  it('rebinds --markmap-text-color to a docus token (not a hard-coded color)', () => {
    /* The original bug: markmap-view ships a stylesheet that sets
       --markmap-text-color to a hard-coded #333 and only flips to
       a light color when an ancestor has .markmap-dark — which
       docus never adds (it themes via data-theme). Result: dark-gray
       text on dark-gray background in dark mode.

       The fix lives in MarkMap.vue's scoped styles: a
       .markmap-widget :deep(.markmap) rule that rebinds the
       variable to var(--vs-text-1), which is the docus token that
       already follows data-theme.

       JSDOM doesn't apply the cascade, so we can't check the
       computed style. Instead we read the component's source and
       assert the rule binds the variable to a docus token rather
       than a hard-coded color. A future refactor that hard-codes a
       color again will fail this test. */
    const src = readFileSync(
      resolve(__dirname, '..', 'MarkMap.vue'),
      'utf8',
    )
    /* The selector that targets markmap's injected content — must
       be a :deep() because markmap's <g class="markmap"> is
       runtime-injected and lacks Vue's [data-v-xxx] scope. */
    expect(src).toMatch(/\.markmap-widget\s*:deep\(\.markmap\)/)
    /* The variable is rebound — not just left at markmap's default. */
    expect(src).toContain('--markmap-text-color')
    /* ...and to a docus theme token, not a hex color. The bug was
       that the markmap stylesheet set it to '#333' literally.

       The header comment in MarkMap.vue mentions
       --markmap-text-color in prose — we want the actual CSS
       rule, which is the only line that has the variable AND a
       `var(…)` value. */
    const textColorLine = src
      .split('\n')
      .find((l) => l.includes('--markmap-text-color') && l.includes('var('))
    expect(textColorLine).toBeDefined()
    expect(textColorLine!).toContain('var(--vs-text-1)')
    expect(textColorLine!).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})

describe('MarkMap theme switch', () => {
  it('rebuilds the markmap instance on theme change, on the same svg', async () => {
    const { unmount } = mountStandalone()
    /* onMounted + the dynamic import are async — give them a few
       ticks to settle. */
    await settle()
    expect(g.__markmapTest!.createCalls.length).toBe(1)

    const svgBefore = g.__markmapTest!.createCalls[0]

    /* Flip the theme. The composable's set() updates the global ref
       synchronously, but the markmap rebuild is async (it awaits the
       import, which is cached after the first mount, so just the
       Markmap.create call matters). */
    const { set } = useTheme()
    set(useTheme().theme.value === 'dark' ? 'light' : 'dark')
    await settle()

    expect(g.__markmapTest!.createCalls.length).toBe(2)
    /* Destroy is called on the FIRST instance before the second is
       built — a leak (destroy never called) was the original symptom. */
    expect(g.__markmapTest!.destroyCalls.length).toBeGreaterThanOrEqual(1)
    /* The svg element is stable across the theme flip — that's the
       whole reason the fix removed the :key on <svg>. */
    expect(g.__markmapTest!.createCalls[1]).toBe(svgBefore)

    unmount()
  })

  it('rebuilds on a second toggle as well (no one-shot bug)', async () => {
    const { unmount } = mountStandalone()
    await settle()
    expect(g.__markmapTest!.createCalls.length).toBe(1)

    const { set, toggle } = useTheme()
    toggle()
    await settle()
    toggle()
    await settle()

    expect(g.__markmapTest!.createCalls.length).toBe(3)
    /* Each rebuild destroys the previous instance. */
    expect(g.__markmapTest!.destroyCalls.length).toBeGreaterThanOrEqual(2)
    /* Reset the global theme so other tests start from a known state. */
    set('light')
    unmount()
  })

  it('does not call Markmap.create on a host that was detached mid-mount (document switch)', async () => {
    /* Regression for the user-reported bug: when the user
       switches documents in the vault, v-html replaces the
       article body while a previous markmap's `mountMarkmap`
       is still awaiting the markmap-lib / markmap-view
       dynamic imports. The await resolves and the captured
       `svg` is now a detached DOM node. The old code went
       ahead and called Markmap.create() on the detached svg,
       kicking off a d3 force simulation on a ghost element
       and producing

         <g> attribute transform: Expected number, "translate(NaN,NaN) scale(N…"

       MarkMap.vue's fix is to bail out (svg.isConnected check)
       before Markmap.create. */

    /* Defer the dynamic import by intercepting it. The test's
       vi.mock('markmap-lib' | 'markmap-view') factories return
       synchronously, so we have no natural delay. Instead we
       mount the widget, immediately detach the host from the
       document (simulating v-html's innerHTML replacement),
       and then wait long enough for the (mocked) imports to
       resolve. The mock's create() should NOT be called. */
    const { unmount, host } = mountStandalone()
    /* The widget lives inside the test host. Detach the
       widget's host div from the document. We have to find the
       markmap-widget-host child of the test host. */
    const widgetHost = host.querySelector<HTMLElement>('.markmap-widget')
    expect(widgetHost).toBeTruthy()
    /* document.body.appendChild of host gave it a parent. We
       just remove the widget host — its svg is now detached. */
    widgetHost!.remove()

    /* The mock factories are synchronous; the await Promise.all
       still needs a microtask + macrotask to drain. settle()
       gives it 100ms of real time, which is enough for both
       rAFs (in onMounted) and the dynamic-import resolution. */
    await settle()

    /* markmap.create was never called on the detached svg. */
    expect(g.__markmapTest!.createCalls.length).toBe(0)

    unmount()
  })
})

describe('MarkMap lock toggle', () => {
  it('mounts locked by default and unlocks via setOptions on click', async () => {
    const { unmount, host } = mountStandalone()
    await settle()

    /* Default is locked: the initial Markmap.create receives
       pan: false, zoom: false. The bug would be either forgetting
       to pass these (markmap defaults to pan: true) or wiring the
       lock button to a no-op. */
    expect(g.__markmapTest!.createCalls.length).toBe(1)
    expect(g.__markmapTest!.createOptions[0]).toMatchObject({
      pan: false,
      zoom: false,
    })

    /* The toolbar lock button is rendered and starts in the
       locked state. data-locked is the hook the test uses to find
       the button — keep it in sync with the template. */
    const lockBtn = host.querySelector<HTMLButtonElement>('button.markmap-lock-btn')
    expect(lockBtn).toBeTruthy()
    expect(lockBtn!.dataset.locked).toBe('true')

    /* Click → unlock. setOptions() should be called with
       pan: true, zoom: true. We deliberately do NOT expect a
       Markmap.create rebuild — setOptions is the in-place path. */
    lockBtn!.click()
    await settle()
    expect(g.__markmapTest!.createCalls.length).toBe(1)
    expect(g.__markmapTest!.setOptionsCalls).toContainEqual({
      pan: true,
      zoom: true,
    })
    expect(lockBtn!.dataset.locked).toBe('false')

    /* Click again → re-lock. */
    lockBtn!.click()
    await settle()
    expect(g.__markmapTest!.setOptionsCalls).toContainEqual({
      pan: false,
      zoom: false,
    })
    expect(lockBtn!.dataset.locked).toBe('true')

    /* Reset the global theme so other tests start from a known state. */
    useTheme().set('light')
    unmount()
  })

  it('preserves the lock state across a theme switch (rebuild keeps pan/zoom flags)', async () => {
    const { unmount, host } = mountStandalone()
    await settle()
    expect(g.__markmapTest!.createOptions[0]).toMatchObject({
      pan: false,
      zoom: false,
    })

    /* Unlock first. */
    const lockBtn = host.querySelector<HTMLButtonElement>('button.markmap-lock-btn')!
    lockBtn.click()
    await settle()
    expect(g.__markmapTest!.setOptionsCalls).toContainEqual({ pan: true, zoom: true })

    /* Now flip the theme. mountMarkmap() rebuilds from scratch
       and must read the *current* isLocked.value when calling
       Markmap.create — i.e. the new tree should be unlocked, not
       snapped back to the initial locked state. */
    const { set } = useTheme()
    set(useTheme().theme.value === 'dark' ? 'light' : 'dark')
    await settle()
    expect(g.__markmapTest!.createCalls.length).toBe(2)
    expect(g.__markmapTest!.createOptions[1]).toMatchObject({
      pan: true,
      zoom: true,
    })

    set('light')
    unmount()
  })
})

describe('MarkMap hidden host teardown', () => {
  it('destroys the markmap instance when its wrapper collapses to 0×0 (e.g. v-show on an inactive tab)', async () => {
    /* Regression for the 30-times-reported
         <g> attribute transform: Expected number, "translate(NaN,NaN) scale(N…"
       on document switch.

       Mechanism: in the vault, every tab keeps its PreviewPane in
       the DOM (v-show on the parent container, not v-if). When the
       user switches away from the markmap tab, the active
       the parent container flips to `display: none` and the widget wrapper
       collapses to 0×0. markmap's own internal ResizeObserver
       notices the foreignObject collapse and re-runs renderData()
       → fit(); fit() on a 0×0 svg produces
       `translate(NaN,NaN) scale(NaN)` and d3-zoom's transition
       writes that string on every animation frame for its
       duration — ~30 frames, one console warning per frame.

       The fix is to observe the *wrapper* in MarkMap.vue and
       teardown the markmap instance the moment the wrapper
       becomes 0×0. The next time it gets a real size (the tab is
       reactivated), scheduleMount rebuilds the instance. */
    const { unmount, host } = mountStandalone()
    await settle()
    expect(g.__markmapTest!.createCalls.length).toBe(1)
    expect(g.__markmapTest!.destroyCalls.length).toBe(0)

    /* Simulate the v-show flip: the wrapper goes to 0×0. In a real
       browser this also collapses clientWidth on the svg; we
       stub that explicitly because jsdom's layout is 0. */
    const svg = host.querySelector<SVGSVGElement>('svg.markmap-svg')!
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 0 })
    fireResizeObservers()
    await settle()

    /* The markmap instance was destroyed — the in-flight fit()
       transition is dropped with it, so the 30 transform-NaN
       warnings stop. */
    expect(g.__markmapTest!.destroyCalls.length).toBeGreaterThanOrEqual(1)

    /* Simulate the user switching back to the markmap tab:
       v-show flips to true, layout re-flows, clientWidth > 0. */
    Object.defineProperty(svg, 'clientWidth', { configurable: true, value: 800 })
    fireResizeObservers()
    await settle()

    /* A fresh markmap instance was created to replace the
       destroyed one. The user sees the diagram again, this time
       with the host's real dimensions. */
    expect(g.__markmapTest!.createCalls.length).toBe(2)

    unmount()
  })
})
