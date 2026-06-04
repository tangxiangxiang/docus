// @vitest-environment jsdom
// Tests for useEditorTabs — the most stateful composable in the vault.
//
// The composable owns:
//   - the tab list + active path,
//   - the save state machine (idle / dirty / saving / saved / error),
//   - the 800ms debounce on editor edits,
//   - the route sync (`/vault/notes/draft` → openPost),
//   - the keyboard shortcuts (Cmd-S, Cmd-W, Cmd-B, Ctrl-Tab),
//   - and the command-palette "new" flow (slugify + createPost + openPost).
//
// We stub the network (fetch), the router (vue-router with a real
// memory router), and the toast/confirm modules so the tests are
// deterministic. The debounce is exercised via vi.useFakeTimers().

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'

// Stubs for the toast / confirm composables. The real ones render a
// <ToastHost /> / <ConfirmHost /> mounted at <body>; here we just
// capture the calls so the test can assert on them.
const toastCalls: { type: string; message: string }[] = []
const confirmAnswer: Ref<boolean | null> = ref(null)
vi.mock('../../useToast', () => ({
  useToast: () => ({
    info: (m: string) => toastCalls.push({ type: 'info', message: m }),
    success: (m: string) => toastCalls.push({ type: 'success', message: m }),
    error: (m: string) => toastCalls.push({ type: 'error', message: m }),
  }),
}))
vi.mock('../../useConfirm', () => ({
  useConfirm: () => ({
    confirm: (_msg: string) => new Promise<boolean>((resolve) => {
      // Capture the resolve so the test can drive the answer.
      confirmResolve = resolve
    }),
  }),
}))
let confirmResolve: ((ok: boolean) => void) | null = null
function answerConfirm(ok: boolean) {
  confirmResolve?.(ok)
  confirmResolve = null
}

import { useEditorTabs } from '../useEditorTabs'

// --- helpers ---------------------------------------------------------------

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/vault', component: { template: '<div/>' } },
      // The composable reads `route.params.pathMatch` as a string[]; vue-
      // router's splat turns `/vault/a/b` into `['a', 'b']`.
      { path: '/vault/:pathMatch(.*)*', component: { template: '<div/>' } },
    ],
  })
}

interface Harness {
  openPost: (p: string) => Promise<void>
  closeTab: (p: string) => Promise<void>
  selectTab: (p: string) => void
  doSaveNow: () => Promise<void>
  onEditorChange: (p: string, v: string) => void
  onKeydown: (e: KeyboardEvent) => void
  onCommandPaletteNew: (t: string) => Promise<void>
  activePath: Ref<string | null>
  tabs: Ref<{ path: string; raw: string; originalRaw: string; saveStatus: string; loadError: string | null }[]>
  // The selectPanel spy is captured separately because the composable
  // receives it as a constructor arg and doesn't return it.
  selectPanel: ReturnType<typeof vi.fn>
}

function setup(): Promise<Harness> {
  return new Promise(async (resolveOuter) => {
    let captured: Harness | null = null
    const Comp = defineComponent({
      setup() {
        const selectPanel = vi.fn()
        const api = useEditorTabs({ selectPanel })
        captured = { ...(api as unknown as Omit<Harness, 'selectPanel'>), selectPanel }
        return () => h('div')
      },
    })
    const router = makeRouter()
    router.push('/vault').catch(() => {})
    await router.isReady()
    mount(Comp, { global: { plugins: [router] } })
    // useEditorTabs runs refresh() in onMounted; wait for it to settle.
    await nextTick()
    await Promise.resolve()
    resolveOuter(captured!)
  })
}

function stubFetch(handlers: Record<string, (body?: unknown) => unknown | Promise<unknown>>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${url.split('?')[0]}`
    const handler = handlers[key]
    if (!handler) {
      throw new Error(`Unexpected fetch: ${key}`)
    }
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    const result = await handler(body)
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => result,
    }
  })
}

// --- tests -----------------------------------------------------------------

describe('useEditorTabs', () => {
  beforeEach(() => {
    toastCalls.length = 0
    confirmResolve = null
    confirmAnswer.value = null
    // The composable's onMounted calls refresh() → fetch('/api/tree') +
    // fetch('/api/posts'). Tests that need a richer API stub override
    // fetch *after* this default. We can't put a "no-op" stub in afterEach
    // because the real fetch is what crashes here — the default has to be
    // a real stub that returns the minimal shapes the composable reads.
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts with no tabs and no active path', async () => {
    const h = await setup()
    expect(h.tabs.value).toEqual([])
    expect(h.activePath.value).toBeNull()
  })

  it('openPost creates a tab, loads content, and sets active path', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/inbox/hello': () => ({
        path: 'inbox/hello',
        raw: '# Hello',
        content: '# Hello',
        frontmatter: { title: 'Hello' },
        size: 7,
        mtime: 0,
      }),
    }))
    const h = await setup()
    await h.openPost('inbox/hello')
    expect(h.tabs.value).toHaveLength(1)
    expect(h.tabs.value[0].path).toBe('inbox/hello')
    expect(h.tabs.value[0].raw).toBe('# Hello')
    expect(h.tabs.value[0].originalRaw).toBe('# Hello')
    expect(h.tabs.value[0].loadError).toBeNull()
    expect(h.activePath.value).toBe('inbox/hello')
  })

  it('openPost reuses an existing tab rather than re-fetching', async () => {
    let getPostCalls = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/inbox/hello': () => {
        getPostCalls++
        return { path: 'inbox/hello', raw: '# Hello', content: '# Hello', frontmatter: {}, size: 7, mtime: 0 }
      },
    }))
    const h = await setup()
    await h.openPost('inbox/hello')
    await h.openPost('inbox/hello')
    expect(getPostCalls).toBe(1)
    expect(h.tabs.value).toHaveLength(1)
  })

  it('openPost sets loadError when getPost fails and keeps the tab', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/inbox/missing': () => {
        throw new Error('HTTP 404')
      },
    }))
    const h = await setup()
    await h.openPost('inbox/missing')
    expect(h.tabs.value).toHaveLength(1)
    expect(h.tabs.value[0].loadError).toContain('HTTP 404')
  })

  it('openPost asks for confirmation when switching from a dirty tab', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')         // mark dirty
    // Start opening 'b'; the confirm() call will return a pending promise.
    const openB = h.openPost('b')
    // Drain microtasks so confirm() is reached.
    await Promise.resolve()
    await Promise.resolve()
    // 'b' is NOT in the tabs yet — openPost awaits the confirm.
    expect(h.tabs.value.find((t) => t.path === 'b')).toBeUndefined()
    answerConfirm(false)                          // user says no
    await openB
    // 'b' is still not open, 'a' is still active and dirty.
    expect(h.tabs.value).toHaveLength(1)
    expect(h.activePath.value).toBe('a')
  })

  it('closeTab removes a tab and switches to the next sibling', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    await h.openPost('b')
    expect(h.tabs.value.map((t) => t.path)).toEqual(['a', 'b'])
    await h.closeTab('a')
    // 'a' removed; 'b' becomes active (it's the next one).
    expect(h.tabs.value.map((t) => t.path)).toEqual(['b'])
    expect(h.activePath.value).toBe('b')
  })

  it('closeTab asks for confirmation when closing a dirty tab', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')
    const closeA = h.closeTab('a')
    await Promise.resolve()
    await Promise.resolve()
    // Still in tabs because confirm is pending.
    expect(h.tabs.value).toHaveLength(1)
    answerConfirm(true)
    await closeA
    expect(h.tabs.value).toHaveLength(0)
  })

  it('doSave sends PUT and flips saveStatus idle → saving → saved', async () => {
    let putBody: { raw: string } | null = null
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': (body) => {
        putBody = body as { raw: string }
        return { path: 'a', title: 'A', date: '', tags: [], size: 1, mtime: 0 }
      },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')
    expect(h.tabs.value[0].saveStatus).toBe('dirty')
    await h.doSaveNow()
    expect(putBody).toEqual({ raw: 'A modified' })
    expect(h.tabs.value[0].saveStatus).toBe('saved')
    expect(h.tabs.value[0].originalRaw).toBe('A modified')
  })

  it('doSave is a no-op when the tab content matches originalRaw', async () => {
    const fetchSpy = stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': () => { throw new Error('should not PUT') },
    })
    vi.stubGlobal('fetch', fetchSpy)
    const h = await setup()
    await h.openPost('a')
    await h.doSaveNow()
    expect(h.tabs.value[0].saveStatus).toBe('idle')
  })

  it('doSave flips to error on HTTP failure and pushes a toast', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': () => { throw new Error('HTTP 500') },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')
    await h.doSaveNow()
    expect(h.tabs.value[0].saveStatus).toBe('error')
    expect(toastCalls).toEqual([{ type: 'error', message: expect.stringContaining('保存失败') }])
  })

  it('onEditorChange marks the tab dirty and debounces a save', async () => {
    vi.useFakeTimers()
    let putCount = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': () => { putCount++; return { path: 'a', title: 'A', date: '', tags: [], size: 1, mtime: 0 } },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A1')
    h.onEditorChange('a', 'A2')
    h.onEditorChange('a', 'A3')
    expect(h.tabs.value[0].saveStatus).toBe('dirty')
    // 800ms debounce — not yet saved.
    expect(putCount).toBe(0)
    await vi.advanceTimersByTimeAsync(850)
    // The debounce fired exactly once despite three rapid edits.
    expect(putCount).toBe(1)
    expect(h.tabs.value[0].originalRaw).toBe('A3')
  })

  it('onEditorChange reverts status to idle when content matches originalRaw', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')
    expect(h.tabs.value[0].saveStatus).toBe('dirty')
    h.onEditorChange('a', 'A')                       // back to original
    expect(h.tabs.value[0].saveStatus).toBe('idle')
  })

  it('selectTab is a no-op for the active tab and for unknown paths', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    const before = h.activePath.value
    h.selectTab('a')                                  // active — no-op
    expect(h.activePath.value).toBe(before)
    h.selectTab('does-not-exist')                     // unknown — no-op
    expect(h.activePath.value).toBe(before)
  })

  it('onKeydown Cmd-S triggers doSaveNow', async () => {
    let saved = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': () => { saved++; return { path: 'a', title: 'A', date: '', tags: [], size: 1, mtime: 0 } },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')
    const evt = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    h.onKeydown(evt)
    // doSaveNow awaits; give it a tick.
    await Promise.resolve()
    await Promise.resolve()
    expect(saved).toBe(1)
    expect(evt.defaultPrevented).toBe(true)
  })

  it('onKeydown Cmd-W closes the active tab', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    const evt = new KeyboardEvent('keydown', { key: 'w', metaKey: true, cancelable: true })
    h.onKeydown(evt)
    await Promise.resolve()
    await Promise.resolve()
    expect(h.tabs.value).toHaveLength(0)
  })

  it('onKeydown Cmd-B calls selectPanel with files', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
    }))
    const h = await setup()
    const evt = new KeyboardEvent('keydown', { key: 'b', metaKey: true, cancelable: true })
    h.onKeydown(evt)
    expect(h.selectPanel).toHaveBeenCalledWith('files')
  })

  it('onKeydown Ctrl-Tab cycles through open tabs', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/c': () => ({ path: 'c', raw: 'C', content: 'C', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    await h.openPost('b')
    await h.openPost('c')
    expect(h.activePath.value).toBe('c')
    h.onKeydown(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, cancelable: true }))
    expect(h.activePath.value).toBe('a')             // wrapped forward
    h.onKeydown(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, cancelable: true }))
    expect(h.activePath.value).toBe('c')             // wrapped backward
  })

  it('onCommandPaletteNew creates the post and opens it', async () => {
    // No active path → the new file lands at the root. Slugify of
    // "New Note" → "new-note". The composable then opens it.
    let created: { path: string; title?: string } | null = null
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/new-note': () => ({ path: 'new-note', raw: '', content: '', frontmatter: {}, size: 0, mtime: 0 }),
      'POST /api/posts': (body) => {
        created = body as { path: string; title?: string }
        return { path: 'new-note', title: 'New Note', date: '', tags: [], size: 0, mtime: 0 }
      },
    }))
    const h = await setup()
    await h.onCommandPaletteNew('New Note')
    expect(created).toEqual({ path: 'new-note', title: 'New Note' })
    expect(h.tabs.value.map((t) => t.path)).toContain('new-note')
    expect(h.activePath.value).toBe('new-note')
    expect(toastCalls).toContainEqual({ type: 'success', message: expect.stringContaining('已创建') })
  })

  it('onCommandPaletteNew with empty title is a no-op', async () => {
    const fetchSpy = stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'POST /api/posts': () => { throw new Error('should not POST') },
    })
    vi.stubGlobal('fetch', fetchSpy)
    const h = await setup()
    await h.onCommandPaletteNew('   ')
    expect(h.tabs.value).toHaveLength(0)
  })
})
