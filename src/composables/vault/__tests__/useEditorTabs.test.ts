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
import { flushPromises, mount } from '@vue/test-utils'

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
import { createVaultFileChanges, type VaultFileChanges } from '../context/fileChanges'
import { useI18n } from '../../useI18n'
import type { PostSummary, TreeNode } from '../../../lib/api'
import {
  getMarkdownModel,
  registerMarkdownModel,
  resetMarkdownModelsForTesting,
} from '../../../components/vault/monacoModelRegistry'

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
  unmount: () => void
  fileChanges: VaultFileChanges
  openPost: (p: string) => Promise<void>
  closeTab: (p: string) => Promise<boolean>
  closeMany: (paths: string[]) => Promise<boolean>
  selectTab: (p: string) => void
  doSaveNow: () => Promise<void>
  resolveExternal: (path: string, strategy: 'disk' | 'local') => Promise<void>
  pollExternalChanges: () => Promise<void>
  onEditorChange: (p: string, v: string) => void
  onKeydown: (e: KeyboardEvent) => void
  onCommandPaletteNew: (t: string) => Promise<void>
  refresh: () => Promise<void>
  applyPostSummary: (post: PostSummary) => void
  renameOpenDocuments: (mappings: ReadonlyArray<{ from: string; to: string }>) => void
  activePath: Ref<string | null>
  activeSize: Ref<number>
  posts: Ref<PostSummary[]>
  tree: Ref<TreeNode[]>
  tabs: Ref<{
    path: string
    raw: string
    originalRaw: string
    revision: number
    savedRevision: number
    saveStatus: string
    loadError: string | null
    serverMtime?: number
    externalRaw?: string | null
  }[]>
  // The selectPanel / toggleViewMode spies are captured separately
  // because the composable receives them as constructor args and
  // doesn't return them.
  selectPanel: ReturnType<typeof vi.fn>
  toggleViewMode: ReturnType<typeof vi.fn>
}

function setup(): Promise<Harness> {
  return new Promise(async (resolveOuter) => {
    let captured: Harness | null = null
    const Comp = defineComponent({
      setup() {
        const selectPanel = vi.fn()
        const toggleViewMode = vi.fn()
        const fileChanges = createVaultFileChanges()
        const api = useEditorTabs({ selectPanel, toggleViewMode, fileChanges })
        captured = { ...(api as unknown as Omit<Harness, 'selectPanel' | 'toggleViewMode' | 'fileChanges' | 'unmount'>), selectPanel, toggleViewMode, fileChanges, unmount: () => {} }
        return () => h('div')
      },
    })
    const router = makeRouter()
    router.push('/vault').catch(() => {})
    await router.isReady()
    const wrapper = mount(Comp, { global: { plugins: [router] } })
    captured!.unmount = () => { wrapper.unmount() }
    // useEditorTabs runs refresh() in onMounted; wait for it to settle.
    await nextTick()
    await flushPromises()
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => { resolve = onResolve })
  return { promise, resolve }
}

function saveResult(path: string, raw: string, size = raw.length, mtime = 2) {
  return {
    ok: true,
    raw,
    post: {
      path,
      title: path.toUpperCase(),
      created: '',
      updated: '',
      tags: [],
      summary: '',
      size,
      mtime,
    },
  }
}

function postSummary(path: string, overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    path,
    title: path.toUpperCase(),
    created: '',
    updated: '',
    tags: [],
    summary: '',
    size: 1,
    mtime: 1,
    ...overrides,
  }
}

function treeFor(...posts: PostSummary[]): TreeNode[] {
  return [{
    kind: 'folder',
    name: 'content',
    path: '',
    children: posts.map((post) => ({
      kind: 'file' as const,
      name: post.path.split('/').pop()!,
      path: post.path,
      title: post.title,
      mtime: post.mtime,
    })),
  }]
}

function findTreeFile(nodes: readonly TreeNode[], path: string): Extract<TreeNode, { kind: 'file' }> | null {
  for (const node of nodes) {
    if (node.kind === 'file' && node.path === path) return node
    if (node.kind === 'folder') {
      const found = findTreeFile(node.children, path)
      if (found) return found
    }
  }
  return null
}

// --- tests -----------------------------------------------------------------

describe('useEditorTabs', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    toastCalls.length = 0
    confirmResolve = null
    confirmAnswer.value = null
    // localStorage carries persisted tab state across tests — clear it
    // so each test starts from a known-empty session. The composable
    // reads from it in onMounted (restore) and writes to it via a
    // debounced watcher (persist).
    localStorage.clear()
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
    resetMarkdownModelsForTesting()
    useI18n().setLocale('zh')
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

  it('migrates an open tab path, active route, persistence signal, and Monaco registry', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    const oldModel = { isDisposed: vi.fn(() => false), dispose: vi.fn() }
    const staleTarget = { isDisposed: vi.fn(() => false), dispose: vi.fn() }
    registerMarkdownModel('a', oldModel)
    registerMarkdownModel('b', staleTarget)

    h.renameOpenDocuments([{ from: 'a', to: 'b' }])
    await nextTick()

    expect(h.tabs.value[0].path).toBe('b')
    expect(h.activePath.value).toBe('b')
    expect(oldModel.dispose).toHaveBeenCalledOnce()
    expect(staleTarget.dispose).toHaveBeenCalledOnce()
    expect(getMarkdownModel('a')).toBeUndefined()
    expect(getMarkdownModel('b')).toBeUndefined()
    resetMarkdownModelsForTesting()
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

  it('openPost switches freely while the previous tab remains dirty', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')         // mark dirty
    await h.openPost('b')
    expect(h.tabs.value).toHaveLength(2)
    expect(h.tabs.value.find((t) => t.path === 'a')?.saveStatus).toBe('dirty')
    expect(h.activePath.value).toBe('b')
    expect(confirmResolve).toBeNull()
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

  it('closeMany closes all listed tabs in reverse-index order so the active jump is consistent', async () => {
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
    expect(h.tabs.value.map((t) => t.path)).toEqual(['a', 'b', 'c'])
    await h.closeMany(['a', 'b', 'c'])
    expect(h.tabs.value).toEqual([])
    // No active tab left → router replaced to /vault.
    expect(h.activePath.value).toBeNull()
  })

  it('closeMany shows ONE prompt for a batch with multiple dirty tabs (not N)', async () => {
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
    h.onEditorChange('a', 'A modified')
    h.onEditorChange('b', 'B modified')
    // c stays clean
    const closePromise = h.closeMany(['a', 'b', 'c'])
    await Promise.resolve()
    await Promise.resolve()
    // ONE confirm covering both dirty tabs.
    answerConfirm(true)
    await expect(closePromise).resolves.toBe(true)
    expect(h.tabs.value).toEqual([])
  })

  it('closeMany aborts entirely when the user declines the dirty prompt', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    await h.openPost('b')
    h.onEditorChange('a', 'A modified')
    const closePromise = h.closeMany(['a', 'b'])
    await Promise.resolve()
    await Promise.resolve()
    answerConfirm(false)                          // user says no
    await expect(closePromise).resolves.toBe(false)
    // BOTH tabs stay — the batch is all-or-nothing on the dirty prompt.
    expect(h.tabs.value.map((t) => t.path)).toEqual(['a', 'b'])
  })

  it('restores autosave after a single or batch dirty close is cancelled', async () => {
    vi.useFakeTimers()
    const saved: string[] = []
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': (body) => { saved.push((body as { raw: string }).raw); return saveResult('a', (body as { raw: string }).raw) },
      'PUT /api/posts/b': (body) => { saved.push((body as { raw: string }).raw); return saveResult('b', (body as { raw: string }).raw) },
    }))
    const h = await setup()
    await h.openPost('a')
    await h.openPost('b')
    h.onEditorChange('a', 'A dirty')
    const single = h.closeTab('a')
    await Promise.resolve()
    await Promise.resolve()
    answerConfirm(false)
    await expect(single).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(800)
    expect(saved).toContain('A dirty')

    h.onEditorChange('a', 'A dirty again')
    h.onEditorChange('b', 'B dirty')
    const batch = h.closeMany(['a', 'b'])
    await Promise.resolve()
    await Promise.resolve()
    answerConfirm(false)
    await expect(batch).resolves.toBe(false)
    await vi.advanceTimersByTimeAsync(800)
    expect(saved).toEqual(expect.arrayContaining(['A dirty again', 'B dirty']))
  })

  it('closeMany skips the dirty prompt when no tab in the batch is dirty', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    await h.openPost('b')
    // No edits — both clean.
    await h.closeMany(['a', 'b'])
    expect(h.tabs.value).toEqual([])
  })

  it('doSave sends PUT and flips saveStatus idle → saving → saved', async () => {
    let putBody: { raw: string } | null = null
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': (body) => {
        putBody = body as { raw: string }
        // Server echoes the post-bump raw; mock returns the same shape.
        return saveResult('a', putBody.raw)
      },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A modified')
    expect(h.tabs.value[0].saveStatus).toBe('dirty')
    await h.doSaveNow()
    expect(putBody).toEqual({ raw: 'A modified', baseRaw: 'A' })
    expect(h.tabs.value[0].saveStatus).toBe('saved')
    expect(h.tabs.value[0].originalRaw).toBe('A modified')
  })

  it('serializes saves and persists edits made while a request is in flight', async () => {
    let releaseFirst!: () => void
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve })
    const sent: string[] = []
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': async (body) => {
        const raw = (body as { raw: string }).raw
        sent.push(raw)
        if (sent.length === 1) await firstPending
        return saveResult('a', raw, sent.length === 1 ? 10 : 20, sent.length === 1 ? 10 : 20)
      },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'A1')
    const saving = h.doSaveNow()
    await Promise.resolve()
    h.onEditorChange('a', 'A2')
    releaseFirst()
    await saving
    expect(sent).toEqual(['A1', 'A2'])
    expect(h.tabs.value[0].originalRaw).toBe('A2')
    expect(h.tabs.value[0].saveStatus).toBe('saved')
    expect(h.tabs.value[0].serverMtime).toBe(20)
    expect(h.posts.value[0]).toMatchObject({ size: 20, mtime: 20 })
    expect(findTreeFile(h.tree.value, 'a')).toMatchObject({ mtime: 20 })
  })

  it('updates posts, tree, activeSize, and mtime from PUT without a full refresh', async () => {
    const oldPost = postSummary('a', { title: 'Old', size: 1, mtime: 1 })
    const savedPost = postSummary('a', { title: 'New', size: 20, mtime: 2 })
    const fetchMock = stubFetch({
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 1 }),
      'GET /api/tree': () => treeFor(oldPost),
      'GET /api/posts': () => [oldPost],
      'PUT /api/posts/a': (body) => ({
        ok: true,
        raw: (body as { raw: string }).raw,
        post: savedPost,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = await setup()
    await h.openPost('a')
    fetchMock.mockClear()

    h.onEditorChange('a', 'A with more content')
    await h.doSaveNow()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/posts/a')
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'PUT' }))
    expect(h.posts.value).toEqual([savedPost])
    expect(findTreeFile(h.tree.value, 'a')).toMatchObject({ title: 'New', mtime: 2 })
    expect(h.activeSize.value).toBe(20)
    expect(h.tabs.value[0]).toMatchObject({ title: 'New', serverMtime: 2 })
    expect(h.fileChanges.events.value.at(-1)).toMatchObject({
      path: 'a', kind: 'write', source: 'editor-save', newMtime: 2,
    })
    expect(h.fileChanges.events.value.at(-1)).not.toHaveProperty('newRaw')
  })

  it('keeps concurrent saves for different documents isolated without full GETs', async () => {
    const oldA = postSummary('a')
    const oldB = postSummary('b')
    const responseA = deferred<unknown>()
    const responseB = deferred<unknown>()
    const fetchMock = stubFetch({
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 1 }),
      'GET /api/posts/b': () => ({ path: 'b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 1 }),
      'GET /api/tree': () => treeFor(oldA, oldB),
      'GET /api/posts': () => [oldA, oldB],
      'PUT /api/posts/a': () => responseA.promise,
      'PUT /api/posts/b': () => responseB.promise,
    })
    vi.stubGlobal('fetch', fetchMock)
    const h = await setup()
    await h.openPost('a')
    await h.openPost('b')
    fetchMock.mockClear()

    h.selectTab('a')
    h.onEditorChange('a', 'A2')
    const savingA = h.doSaveNow()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    h.selectTab('b')
    h.onEditorChange('b', 'B2')
    const savingB = h.doSaveNow()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const savedB = postSummary('b', { title: 'New B', size: 22, mtime: 22 })
    const savedA = postSummary('a', { title: 'New A', size: 11, mtime: 11 })
    responseB.resolve({ ok: true, raw: 'B2', post: savedB })
    responseA.resolve({ ok: true, raw: 'A2', post: savedA })
    await Promise.all([savingA, savingB])

    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'PUT')).toBe(true)
    expect(h.posts.value).toEqual([savedA, savedB])
    expect(findTreeFile(h.tree.value, 'a')).toMatchObject({ title: 'New A', mtime: 11 })
    expect(findTreeFile(h.tree.value, 'b')).toMatchObject({ title: 'New B', mtime: 22 })
  })

  it('merges a save during refresh with unrelated returned structure', async () => {
    const h = await setup()
    const oldA = postSummary('a', { title: 'Old A', mtime: 1 })
    const newA = postSummary('a', { title: 'New A', size: 20, mtime: 2 })
    const newB = postSummary('b', { title: 'New B', mtime: 3 })
    const pendingTree = deferred<TreeNode[]>()
    const pendingPosts = deferred<PostSummary[]>()
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => url === '/api/tree' ? pendingTree.promise : pendingPosts.promise,
    })))

    const refreshing = h.refresh()
    h.applyPostSummary(newA)
    pendingTree.resolve(treeFor(oldA, newB))
    pendingPosts.resolve([oldA, newB])
    await refreshing

    expect(h.posts.value).toEqual([newA, newB])
    expect(findTreeFile(h.tree.value, 'a')).toMatchObject({ title: 'New A', mtime: 2 })
    expect(findTreeFile(h.tree.value, 'b')).toMatchObject({ title: 'New B', mtime: 3 })
  })

  it('retains a locally confirmed missing path and the newest same-path patch', async () => {
    const h = await setup()
    h.applyPostSummary(postSummary('new/path', { title: 'First', mtime: 1 }))
    const pendingTree = deferred<TreeNode[]>()
    const pendingPosts = deferred<PostSummary[]>()
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => url === '/api/tree' ? pendingTree.promise : pendingPosts.promise,
    })))

    const refreshing = h.refresh()
    const latest = postSummary('new/path', { title: 'Latest', size: 30, mtime: 3 })
    h.applyPostSummary(latest)
    pendingTree.resolve(treeFor())
    pendingPosts.resolve([])
    await refreshing

    expect(h.posts.value).toEqual([latest])
    expect(findTreeFile(h.tree.value, 'new/path')).toMatchObject({ title: 'Latest', mtime: 3 })
    const rootNode = h.tree.value.find((node) => node.kind === 'folder' && node.path === '') as Extract<TreeNode, { kind: 'folder' }>
    const newFolder = rootNode.children.find((node) => node.kind === 'folder' && node.path === 'new') as Extract<TreeNode, { kind: 'folder' }>
    expect(newFolder.children.filter((node) => node.kind === 'file' && node.path === 'new/path')).toHaveLength(1)
  })

  it('lets accepted refreshes take over patches that existed before they started', async () => {
    const h = await setup()
    const localA = postSummary('a', { title: 'Local A', size: 20, mtime: 2 })
    const serverA = postSummary('a', { title: 'Server A', size: 30, mtime: 3 })
    const laterA = postSummary('a', { title: 'Later A', size: 40, mtime: 4 })
    h.applyPostSummary(localA)

    let treeCalls = 0
    let postsCalls = 0
    const fetchMock = stubFetch({
      'GET /api/tree': () => (++treeCalls === 1 ? treeFor(serverA) : treeFor(laterA)),
      'GET /api/posts': () => (++postsCalls === 1 ? [serverA] : [laterA]),
    })
    vi.stubGlobal('fetch', fetchMock)

    await h.refresh()
    expect(h.posts.value).toEqual([serverA])
    expect(findTreeFile(h.tree.value, 'a')).toMatchObject({ title: 'Server A', mtime: 3 })

    await h.refresh()
    expect(h.posts.value).toEqual([laterA])
    expect(findTreeFile(h.tree.value, 'a')).toMatchObject({ title: 'Later A', mtime: 4 })
  })

  it('ignores an older Vault refresh that resolves after a newer one', async () => {
    const h = await setup()
    const treeA = deferred<unknown[]>()
    const postsA = deferred<unknown[]>()
    const treeB = deferred<unknown[]>()
    const postsB = deferred<unknown[]>()
    let treeCalls = 0
    let postCalls = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const payload = url === '/api/tree'
        ? (++treeCalls === 1 ? treeA.promise : treeB.promise)
        : (++postCalls === 1 ? postsA.promise : postsB.promise)
      return Promise.resolve({ ok: true, status: 200, json: () => payload })
    }))

    const older = h.refresh()
    const newer = h.refresh()
    treeB.resolve([])
    postsB.resolve([{ path: 'new.md', title: 'New', tags: [], size: 1, mtime: 2 }])
    await newer
    treeA.resolve([])
    postsA.resolve([{ path: 'old.md', title: 'Old', tags: [], size: 1, mtime: 1 }])
    await older

    expect(h.posts.value.map((post) => post.path)).toEqual(['new.md'])
  })

  it('waits for an in-flight autosave before closing the document tab', async () => {
    let releaseSave!: () => void
    const pendingSave = new Promise<void>((resolve) => { releaseSave = resolve })
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': async (body) => {
        await pendingSave
        return saveResult('a', (body as { raw: string }).raw)
      },
    }))
    const h = await setup()
    await h.openPost('a')
    await flushPromises()
    h.onEditorChange('a', 'A saved while closing')
    const saving = h.doSaveNow()
    await vi.waitFor(() => expect(h.tabs.value[0].saveStatus).toBe('saving'))

    const closing = h.closeTab('a')
    await Promise.resolve()
    expect(h.tabs.value).toHaveLength(1)

    releaseSave()
    await saving
    await expect(closing).resolves.toBe(true)
    expect(h.tabs.value).toEqual([])
    expect(confirmResolve).toBeNull()
  })

  it('blocks page unload while a tab is dirty', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'unsaved')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
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

  it('resolves an external conflict with the disk version', async () => {
    let reads = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [], 'GET /api/posts': () => [],
      'GET /api/posts/a': () => {
        reads += 1
        return { path: 'a', raw: reads === 1 ? 'A' : 'disk', content: '', frontmatter: {}, size: 4, mtime: 2 }
      },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'local')
    h.tabs.value[0].saveStatus = 'external'
    h.tabs.value[0].externalRaw = 'disk'
    await h.resolveExternal('a', 'disk')
    expect(h.tabs.value[0]).toMatchObject({ raw: 'disk', originalRaw: 'disk', saveStatus: 'idle', externalRaw: null })
  })

  it('keeps the local version after an external conflict and saves it', async () => {
    vi.useFakeTimers()
    const writes: Array<{ raw: string; baseRaw: string }> = []
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [], 'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: '', frontmatter: {}, size: 1, mtime: 1 }),
      'PUT /api/posts/a': (body) => {
        const input = body as { raw: string; baseRaw: string }
        writes.push(input)
        return saveResult('a', input.raw)
      },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'local')
    h.tabs.value[0].saveStatus = 'external'
    h.tabs.value[0].externalRaw = 'disk'
    await h.resolveExternal('a', 'local')
    await vi.advanceTimersByTimeAsync(1)
    expect(writes).toEqual([{ raw: 'local', baseRaw: 'disk' }])
    expect(h.tabs.value[0].saveStatus).toBe('saved')
  })

  it('keeps local without a redundant PUT when it already equals the disk snapshot', async () => {
    vi.useFakeTimers()
    let putCount = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [], 'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: '', frontmatter: {}, size: 1, mtime: 1 }),
      'PUT /api/posts/a': () => {
        putCount += 1
        return saveResult('a', 'disk')
      },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'disk')
    h.tabs.value[0].saveStatus = 'external'
    h.tabs.value[0].externalRaw = 'disk'

    await h.resolveExternal('a', 'local')
    await vi.advanceTimersByTimeAsync(800)

    expect(putCount).toBe(0)
    expect(h.tabs.value[0]).toMatchObject({
      raw: 'disk',
      originalRaw: 'disk',
      externalRaw: null,
      saveStatus: 'idle',
    })
    expect(h.tabs.value[0].revision).toBe(h.tabs.value[0].savedRevision)
  })

  it('marks a failed save offline and retries when connectivity returns', async () => {
    let online = false
    let attempts = 0
    vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online)
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [], 'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: '', frontmatter: {}, size: 1, mtime: 1 }),
      'PUT /api/posts/a': () => {
        attempts += 1
        if (!online) throw new Error('network unavailable')
        return saveResult('a', 'local')
      },
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'local')
    await h.doSaveNow()
    expect(h.tabs.value[0].saveStatus).toBe('offline')
    online = true
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(attempts).toBe(2)
    expect(h.tabs.value[0].saveStatus).toBe('saved')
  })

  it('reloads a clean tab when its file changes on disk', async () => {
    let reads = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [], 'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: reads++ ? 'disk' : 'A', content: '', frontmatter: {}, size: 4, mtime: reads > 1 ? 2 : 1 }),
      'POST /api/files/state': () => [{ path: 'a', exists: true, mtime: 2, size: 4 }],
    }))
    const h = await setup()
    await h.openPost('a')
    await h.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({ raw: 'disk', originalRaw: 'disk', saveStatus: 'idle', serverMtime: 2 })
  })

  it('preserves a dirty buffer and records the external disk snapshot', async () => {
    let reads = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [], 'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: reads++ ? 'disk' : 'A', content: '', frontmatter: {}, size: 4, mtime: reads > 1 ? 2 : 1 }),
      'POST /api/files/state': () => [{ path: 'a', exists: true, mtime: 2, size: 4 }],
    }))
    const h = await setup()
    await h.openPost('a')
    h.onEditorChange('a', 'local')
    await h.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({ raw: 'local', externalRaw: 'disk', saveStatus: 'external' })
  })

  it('marks an externally deleted file without discarding its buffer', async () => {
    let recovered = ''
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [], 'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: '', frontmatter: {}, size: 1, mtime: 1 }),
      'POST /api/files/state': () => [{ path: 'a', exists: false, mtime: 0, size: 0 }],
      'PUT /api/recover/a': (body) => {
        recovered = (body as { raw: string }).raw
        return { ok: true, raw: recovered, mtime: 3 }
      },
    }))
    const h = await setup()
    await h.openPost('a')
    await h.pollExternalChanges()
    expect(h.tabs.value[0]).toMatchObject({ raw: 'A', saveStatus: 'external', error: '文件已从磁盘删除' })
    await h.resolveExternal('a', 'local')
    expect(recovered).toBe('A')
    expect(h.tabs.value[0]).toMatchObject({ saveStatus: 'saved', serverMtime: 3 })
  })

  it('onEditorChange marks the tab dirty and debounces a save', async () => {
    vi.useFakeTimers()
    let putCount = 0
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/a': () => ({ path: 'a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
      'PUT /api/posts/a': () => { putCount++; return saveResult('a', 'A3') },
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
      'PUT /api/posts/a': () => { saved++; return saveResult('a', 'A modified') },
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

  it('onKeydown Cmd+E calls toggleViewMode (NavBar toggle button)', async () => {
    // Assert by spy rather than reading the layout ref because the spy
    // is the seam the production caller uses (see VaultView.vue), so a
    // regression that renames the field or wires the bit directly would
    // still surface here.
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
    }))
    const h = await setup()
    const evt = new KeyboardEvent('keydown', { key: 'e', metaKey: true, cancelable: true })
    h.onKeydown(evt)
    expect(h.toggleViewMode).toHaveBeenCalledOnce()

    // Ctrl on Windows / Linux maps to metaKey in the handler — make
    // sure the shortcut isn't gated to macOS only.
    h.toggleViewMode.mockClear()
    const ctrlEvt = new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, cancelable: true })
    h.onKeydown(ctrlEvt)
    expect(h.toggleViewMode).toHaveBeenCalledOnce()
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
        return { path: 'new-note', title: 'New Note', created: '', updated: '', tags: [], size: 0, mtime: 0 }
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

// --- file-change bus integration ------------------------------------------

describe('useEditorTabs — file-change bus', () => {
  beforeEach(() => {
    // The confirm mock captures the resolve into a module-level
    // variable; clear it so each test starts from a clean state.
    confirmResolve = null
  })
  afterEach(() => {
    confirmResolve = null
  })

  it('auto-refreshes a clean tab when the bus publishes a write for its path', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/bus-a': () => ({ path: 'bus-a', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('bus-a')
    expect(h.tabs.value[0].raw).toBe('A')
    h.fileChanges.publish({ path: 'bus-a', kind: 'write', newMtime: 100, newRaw: 'A from AI' })
    await flushPromises()
    expect(h.tabs.value[0].raw).toBe('A from AI')
    expect(h.tabs.value[0].serverMtime).toBe(100)
    // No confirm call should have been queued
    expect(confirmResolve).toBeNull()
  })

  it('prompts a dirty tab; 覆盖本地 refreshes, 保留本地 keeps edits', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/bus-b': () => ({ path: 'bus-b', raw: 'B', content: 'B', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('bus-b')
    h.onEditorChange('bus-b', 'B modified by user')  // dirty
    h.fileChanges.publish({ path: 'bus-b', kind: 'write', newMtime: 200, newRaw: 'B from AI' })
    await flushPromises()
    // Confirm should be pending
    await vi.waitFor(() => expect(confirmResolve).not.toBeNull())
    // User picks 保留本地 (false)
    answerConfirm(false)
    await flushPromises()
    expect(h.tabs.value[0].raw).toBe('B modified by user')
    expect(h.tabs.value[0].serverMtime).toBe(200)
    // saveStatus should NOT be reset to idle (still dirty)
    expect(h.tabs.value[0].saveStatus).toBe('dirty')

    // Second publish, user picks 覆盖 (true)
    h.fileChanges.publish({ path: 'bus-b', kind: 'write', newMtime: 201, newRaw: 'B from AI 2' })
    await flushPromises()
    await vi.waitFor(() => expect(confirmResolve).not.toBeNull())
    answerConfirm(true)
    await flushPromises()
    expect(h.tabs.value[0].raw).toBe('B from AI 2')
    expect(h.tabs.value[0].serverMtime).toBe(201)
  })

  it('drops the event while a save is in flight (saveStatus === saving)', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/bus-c': () => ({ path: 'bus-c', raw: 'C', content: 'C', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('bus-c')
    h.tabs.value[0].saveStatus = 'saving'  // simulate mid-save
    h.fileChanges.publish({ path: 'bus-c', kind: 'write', newMtime: 1, newRaw: 'irrelevant' })
    await flushPromises()
    expect(h.tabs.value[0].raw).toBe('C')  // unchanged
    expect(confirmResolve).toBeNull()
  })

  it('marks a tab with a loadError on a delete event so the user sees the file is gone', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/bus-d': () => ({ path: 'bus-d', raw: 'D', content: 'D', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('bus-d')
    h.fileChanges.publish({ path: 'bus-d', kind: 'delete' })
    await flushPromises()
    expect(h.tabs.value[0].loadError).toMatch(/已被 AI 删除/)
  })

  it('closes the old tab and opens the new one on a rename event', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/bus-old': () => ({ path: 'bus-old', raw: 'OLD', content: 'OLD', frontmatter: {}, size: 3, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('bus-old')
    expect(h.tabs.value.map((t) => t.path)).toEqual(['bus-old'])
    h.fileChanges.publish({ path: 'bus-new', kind: 'rename', oldPath: 'bus-old', newMtime: 1, newRaw: 'NEW' })
    await flushPromises()
    expect(h.tabs.value.map((t) => t.path)).toEqual(['bus-new'])
    expect(h.tabs.value[0].raw).toBe('NEW')
    expect(h.tabs.value[0].serverMtime).toBe(1)
    expect(h.activePath.value).toBe('bus-new')
    expect(toastCalls).toContainEqual({ type: 'info', message: 'AI 已将 bus-old 重命名为 bus-new' })
  })

  it('does not refresh a tab whose path does not match the event', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/bus-e': () => ({ path: 'bus-e', raw: 'E', content: 'E', frontmatter: {}, size: 1, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('bus-e')
    h.fileChanges.publish({ path: 'unrelated', kind: 'write', newMtime: 1, newRaw: 'X' })
    await flushPromises()
    expect(h.tabs.value[0].raw).toBe('E')
    expect(confirmResolve).toBeNull()
  })

  it('stops reacting to file changes after unmount', async () => {
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/posts/bus-unmount': () => ({ path: 'bus-unmount', raw: 'before', content: 'before', frontmatter: {}, size: 6, mtime: 0 }),
    }))
    const h = await setup()
    await h.openPost('bus-unmount')
    h.onEditorChange('bus-unmount', 'local edit')
    h.unmount()

    h.fileChanges.publish({ path: 'bus-unmount', kind: 'write', newRaw: 'after' })
    await flushPromises()

    expect(h.tabs.value[0].raw).toBe('local edit')
    expect(confirmResolve).toBeNull()
  })
})

// --- tab persistence ------------------------------------------------------
//
// On refresh the composable reads the previous session's tab set from
// localStorage and restores it. The default beforeEach fetch stub
// returns [] for tree/posts and throws for anything else, so each
// test here overrides it with per-path getPost handlers.

const PERSIST_KEY = 'docus:tabs:v1'

function stubFetchForPaths(paths: Record<string, unknown>): void {
  vi.stubGlobal('fetch', stubFetch({
    'GET /api/tree': () => [],
    'GET /api/posts': () => [],
    ...Object.fromEntries(
      Object.entries(paths).map(([p, raw]) => [
        `GET /api/posts/${p}`,
        () => ({ path: p, raw: raw as string, content: raw as string, frontmatter: { title: p }, size: 1, mtime: 0 }),
      ]),
    ),
  }))
}

describe('useEditorTabs — tab persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    // Reset toast capture here too — this nested describe doesn't
    // inherit the outer describe's beforeEach.
    toastCalls.length = 0
  })

  it('persists the tab set + active path after openPost (debounced)', async () => {
    stubFetchForPaths({ a: 'A', b: 'B' })
    const h = await setup()
    await h.openPost('a')
    await flushPromises()
    await h.openPost('b')
    await flushPromises()
    // debouncedPersist has a 100ms delay; advance and flush.
    await new Promise((r) => setTimeout(r, 150))
    const raw = localStorage.getItem(PERSIST_KEY)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw!)
    expect(data.v).toBe(1)
    expect(data.paths).toEqual(['a', 'b'])
    expect(data.active).toBe('b')
  })

  it('removes the path from persistence when a tab is closed', async () => {
    stubFetchForPaths({ a: 'A', b: 'B' })
    const h = await setup()
    await h.openPost('a')
    await flushPromises()
    await h.openPost('b')
    await flushPromises()
    await h.closeTab('a')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 150))
    const data = JSON.parse(localStorage.getItem(PERSIST_KEY)!)
    expect(data.paths).toEqual(['b'])
    expect(data.active).toBe('b')
  })

  it('writes an empty session when the last tab is closed', async () => {
    stubFetchForPaths({ a: 'A' })
    const h = await setup()
    await h.openPost('a')
    await flushPromises()
    await h.closeTab('a')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 150))
    const data = JSON.parse(localStorage.getItem(PERSIST_KEY)!)
    expect(data.paths).toEqual([])
    expect(data.active).toBeNull()
  })

  it('restores the tab set from localStorage on mount', async () => {
    stubFetchForPaths({ a: 'A', b: 'B' })
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      v: 1, paths: ['a', 'b'], active: 'a',
    }))
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.map((t) => t.path)).toEqual(['a', 'b'])
    expect(h.tabs.value[0].raw).toBe('A')
    expect(h.tabs.value[1].raw).toBe('B')
    expect(h.activePath.value).toBe('a')
  })

  it('falls back to the first restored tab when the saved active path no longer exists', async () => {
    stubFetchForPaths({ a: 'A', b: 'B' })
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      v: 1, paths: ['a', 'b'], active: 'c', // c never persisted as a tab
    }))
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.map((t) => t.path)).toEqual(['a', 'b'])
    expect(h.activePath.value).toBe('a')
  })

  it('drops paths that 404 on restore and reports them in a single toast', async () => {
    stubFetchForPaths({ a: 'A' })
    // b is NOT stubbed → fetch throws "Unexpected fetch" → treated as missing.
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      v: 1, paths: ['a', 'b'], active: 'b',
    }))
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.map((t) => t.path)).toEqual(['a'])
    expect(h.activePath.value).toBe('a')
    const toasts = toastCalls.filter((t) => t.type === 'info')
    expect(toasts.length).toBe(1)
    expect(toasts[0].message).toContain('1 个标签页对应的文件已不存在')
    expect(toasts[0].message).toContain('· b')
  })

  it('caps the restored set at TAB_HARD_LIMIT so the UI never overflows', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `f${i}`).reduce(
      (acc, p) => { acc[p] = 'X'; return acc },
      {} as Record<string, unknown>,
    )
    stubFetchForPaths(many)
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      v: 1, paths: Object.keys(many), active: 'f0',
    }))
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.length).toBe(9)
  })

  it('lists at most 3 missing paths in the toast, with an overflow count', async () => {
    // 5 missing paths; only the first 3 should appear by name.
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      v: 1, paths: ['m1', 'm2', 'm3', 'm4', 'm5'], active: 'm1',
    }))
    // No per-path handlers — all 5 will 404.
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.length).toBe(0)
    const toasts = toastCalls.filter((t) => t.type === 'info')
    expect(toasts.length).toBe(1)
    expect(toasts[0].message).toContain('5 个标签页对应的文件已不存在')
    expect(toasts[0].message).toContain('· m1')
    expect(toasts[0].message).toContain('· m2')
    expect(toasts[0].message).toContain('· m3')
    expect(toasts[0].message).not.toContain('· m4')
    expect(toasts[0].message).toContain('另有 2 个')
  })

  it('treats corrupt JSON in localStorage as empty (no crash)', async () => {
    stubFetchForPaths({ a: 'A' })
    localStorage.setItem(PERSIST_KEY, '{not valid json')
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.length).toBe(0)
    expect(h.activePath.value).toBeNull()
  })

  it('ignores entries with the wrong schema version', async () => {
    stubFetchForPaths({ a: 'A' })
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      v: 999, paths: ['a'], active: 'a', // future version → drop
    }))
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.length).toBe(0)
  })

  it('keeps restored tabs when a deep-link override opens a different path', async () => {
    stubFetchForPaths({ a: 'A', b: 'B', c: 'C' })
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      v: 1, paths: ['a', 'b'], active: 'b',
    }))
    // Stand up a router pointed at /vault/c BEFORE mounting.
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/vault', component: { template: '<div/>' } },
        { path: '/vault/:pathMatch(.*)*', component: { template: '<div/>' } },
      ],
    })
    router.push('/vault/c').catch(() => {})
    await router.isReady()
    // Use `harness` (not `h`) here — `h` shadows the module-level
    // hyperscript import and the render closure would hit a TDZ when
    // mount() fires it before this binding initializes. The standard
    // helper sidesteps this by mounting inside its own scope; an
    // inline mount doesn't, so we have to pick a non-colliding name.
    let captured: Harness | null = null
    const Comp = defineComponent({
      setup() {
        const selectPanel = vi.fn()
        const toggleViewMode = vi.fn()
        const api = useEditorTabs({ selectPanel, toggleViewMode, fileChanges: createVaultFileChanges() })
        captured = { ...(api as unknown as Omit<Harness, 'selectPanel' | 'toggleViewMode'>), selectPanel, toggleViewMode }
        return () => h('div')
      },
    })
    mount(Comp, { global: { plugins: [router] } })
    await nextTick()
    await Promise.resolve()
    await flushPromises()
    const harness = captured!
    // a + b restored from persistence, then c opened via deep-link.
    expect(harness.tabs.value.map((t) => t.path).sort()).toEqual(['a', 'b', 'c'])
    // Deep-link wins for active.
    expect(harness.activePath.value).toBe('c')
  })

  it('does nothing on mount when localStorage is empty', async () => {
    stubFetchForPaths({ a: 'A' })
    // localStorage cleared by outer beforeEach; just mount.
    const h = await setup()
    await flushPromises()
    expect(h.tabs.value.length).toBe(0)
    expect(h.activePath.value).toBeNull()
    // No missing-tab toast either.
    expect(toastCalls.filter((t) => t.type === 'info')).toEqual([])
  })
})

// --- tab persistence: vault isolation -------------------------------------
//
// When the server reports a vault id, the tab persistence key is
// scoped by it (`docus:tabs:v1:<vaultId>`). Multiple vaults sharing
// the same browser shouldn't see each other's tabs. When the server
// doesn't report an id, the bare key is used — no regression.

import { __setVaultIdForTesting } from '../useEditorTabs'

describe('useEditorTabs — vault-scoped persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uses the bare key when no vault id is reported', async () => {
    __setVaultIdForTesting(null)
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/health': () => ({ ok: true /* no vaultId */ }),
    }))
    const h = await setup()
    await flushPromises()
    await h.openPost('inbox/a')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 150))
    expect(localStorage.getItem('docus:tabs:v1')).toBeTruthy()
    expect(localStorage.getItem('docus:tabs:v1:vault-1234')).toBeNull()
  })

  it('scopes the persistence key by vault id from /api/health', async () => {
    __setVaultIdForTesting('vault-1234')
    vi.stubGlobal('fetch', stubFetch({
      'GET /api/tree': () => [],
      'GET /api/posts': () => [],
      'GET /api/health': () => ({ ok: true, vaultId: 'vault-1234' }),
    }))
    const h = await setup()
    await flushPromises()
    await h.openPost('inbox/a')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 150))
    expect(localStorage.getItem('docus:tabs:v1:vault-1234')).toBeTruthy()
    expect(localStorage.getItem('docus:tabs:v1')).toBeNull()
  })
})
