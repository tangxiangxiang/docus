// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useCurrentNote, __resetForTesting } from '../useCurrentNote'
import {
  useEditorTabs,
  getLiveTabs,
  __setLiveTabsForTesting,
  __resetLiveTabsForTesting,
} from '../useEditorTabs'
import type { Tab } from '../../../components/vault/tabs'

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    path: 'foo.md',
    title: 'foo',
    raw: '',
    originalRaw: '',
    saveStatus: 'idle',
    error: null,
    loadError: null,
    loading: false,
    serverMtime: 0,
    ...overrides,
  }
}

let responses: { status: number; body: unknown }[] = []

beforeEach(() => {
  responses = []
  globalThis.fetch = vi.fn(async (_url: string | URL | Request) => {
    const next = responses.shift() ?? { status: 200, body: { content: '' } }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  __resetForTesting()
})

async function mountAtRoute(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/vault/:path(.*)*', name: 'vault', component: { template: '<div/>' } },
      { path: '/:catchAll(.*)', name: 'other', component: { template: '<div/>' } },
    ],
  })
  router.push(initialPath)
  await router.isReady()
  let captured: ReturnType<typeof useCurrentNote> | null = null
  const Comp = defineComponent({
    setup() {
      captured = useCurrentNote()
      return () => h('div')
    },
  })
  const wrap = mount(Comp, { global: { plugins: [router] } })
  await flushPromises()
  return { router, note: captured!, wrap }
}

describe('useCurrentNote', () => {
  it('exposes null path and empty content when the route is not the vault', async () => {
    const { note } = await mountAtRoute('/not-vault')
    expect(note.path.value).toBeNull()
    expect(note.content.value).toBe('')
  })

  it('derives path from /vault/:path and fetches the post', async () => {
    responses.push({ status: 200, body: { content: 'hello world', frontmatter: {} } })
    const { note } = await mountAtRoute('/vault/zettel/foo.md')
    expect(note.path.value).toBe('zettel/foo.md')
    expect(note.content.value).toBe('hello world')
  })

  it('updates path and refetches content when the route changes', async () => {
    responses.push({ status: 200, body: { content: 'first' } })
    responses.push({ status: 200, body: { content: 'second' } })
    const { router, note } = await mountAtRoute('/vault/zettel/a.md')
    expect(note.content.value).toBe('first')
    await router.push('/vault/zettel/b.md')
    await flushPromises()
    expect(note.path.value).toBe('zettel/b.md')
    expect(note.content.value).toBe('second')
  })

  it('clears content on a fetch error', async () => {
    responses.push({ status: 404, body: { error: 'not found' } })
    const { note } = await mountAtRoute('/vault/missing.md')
    expect(note.path.value).toBe('missing.md')
    expect(note.content.value).toBe('')
  })
})

describe('useCurrentNote — live tab integration', () => {
  beforeEach(() => {
    __setLiveTabsForTesting(shallowRef<Tab[]>([]))
  })

  afterEach(() => {
    __resetLiveTabsForTesting()
  })

  it('uses tab.raw when a live tab exists for the route path', async () => {
    const live = getLiveTabs()!
    live.value = [makeTab({ path: 'foo.md', raw: 'live content' })]
    const { note } = await mountAtRoute('/vault/foo.md')
    expect(note.path.value).toBe('foo.md')
    expect(note.content.value).toBe('live content')
  })

  it('falls back to getPost when no live tab exists for the route path', async () => {
    responses.push({ status: 200, body: { content: 'from-server', frontmatter: {} } })
    const { note } = await mountAtRoute('/vault/missing.md')
    expect(note.path.value).toBe('missing.md')
    expect(note.content.value).toBe('from-server')
  })

  it('updates content when the live tab.raw mutates (typing)', async () => {
    const live = getLiveTabs()!
    live.value = [makeTab({ path: 'foo.md', raw: 'a' })]
    const { note } = await mountAtRoute('/vault/foo.md')
    expect(note.content.value).toBe('a')

    // Simulate a keystroke: useEditorTabs would call onEditorChange →
    // tabs.value = [{ ...prev, raw: 'ab' }] → mirror watch propagates.
    live.value = [makeTab({ path: 'foo.md', raw: 'ab' })]
    await flushPromises()
    expect(note.content.value).toBe('ab')
  })

  // This is the regression test for the bug where the AI panel kept
  // seeing stale editor content. The previous test above passes
  // "for the wrong reason" — it reassigns live.value wholesale, which
  // shallowRef fires on even without the mirror being deep. The
  // production path is different: useEditorTabs's onEditorChange does
  // `tab.raw = val` IN PLACE on the reactive proxy, and the mirror
  // watch in useEditorTabs has to fire to push the change to
  // getLiveTabs(). So we mount useEditorTabs for real (which sets up
  // the mirror) and drive onEditorChange.
  it('updates content when useEditorTabs mutates tab.raw in place (real mirror path)', async () => {
    // Mount useEditorTabs so the mirror watch is set up. Then mount
    // useCurrentNote in a sibling component so it picks up the
    // module-level _liveTabs ref.
    // refresh() in onMounted fires getTree() and listPosts() in
    // parallel — two responses consumed up front.
    responses.push({ status: 200, body: { tree: [], posts: [] } })
    responses.push({ status: 200, body: { tree: [], posts: [] } })
    // The third response is for the explicit openPost('foo.md') call
    // below, which fetches via getPost.
    responses.push({
      status: 200,
      body: {
        path: 'foo.md', raw: 'a', content: 'a',
        frontmatter: { title: 'foo' }, size: 1, mtime: 0,
      },
    })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/vault/:path(.*)*', name: 'vault', component: { template: '<div/>' } },
        { path: '/:catchAll(.*)', name: 'other', component: { template: '<div/>' } },
      ],
    })
    router.push('/vault')
    await router.isReady()

    let editorApi: ReturnType<typeof useEditorTabs> | null = null
    let noteApi: ReturnType<typeof useCurrentNote> | null = null

    const Parent = defineComponent({
      setup() {
        // NOTE: both composables live in the same setup so they share
        // the same app instance and the module-level mirror ref.
        editorApi = useEditorTabs({ selectPanel: () => {} })
        noteApi = useCurrentNote()
        return () => h('div')
      },
    })
    const wrap = mount(Parent, { global: { plugins: [router] } })
    await flushPromises()

    // Open a tab — this goes through useEditorTabs's real openPost
    // (which calls getPost and assigns tab.raw).
    await editorApi!.openPost('foo.md')
    await flushPromises()
    expect(noteApi!.content.value).toBe('a')

    // The real production path: user types a character. onEditorChange
    // does `tab.raw = 'ab'` in place. The mirror watch in
    // useEditorTabs must propagate this to the module-level
    // getLiveTabs() ref. useCurrentNote's watch on that ref then
    // re-resolves and updates content.
    editorApi!.onEditorChange('foo.md', 'ab')
    await flushPromises()
    expect(noteApi!.content.value).toBe('ab')

    editorApi!.onEditorChange('foo.md', 'abc')
    await flushPromises()
    expect(noteApi!.content.value).toBe('abc')

    wrap.unmount()
  })
})

// --- file-change bus integration ------------------------------------------

import {
  publishFileChange,
  __resetFileChangeBusForTesting,
} from '../useFileChangeBus'

describe('useCurrentNote — file-change bus', () => {
  beforeEach(() => {
    __resetForTesting()
    __setLiveTabsForTesting(shallowRef<Tab[]>([]))
    __resetFileChangeBusForTesting()
  })
  afterEach(() => {
    __resetForTesting()
    __resetFileChangeBusForTesting()
  })

  it('mirrors an AI write to the active note into content', async () => {
    responses.push({
      status: 200,
      body: { path: 'a.md', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 },
    })
    const { note } = await mountAtRoute('/vault/a.md')
    expect(note.content.value).toBe('A')
    publishFileChange({ path: 'a.md', kind: 'write', newMtime: 1, newRaw: 'A from AI' })
    await flushPromises()
    expect(note.content.value).toBe('A from AI')
  })

  it('ignores file changes for paths that are not the active note', async () => {
    responses.push({
      status: 200,
      body: { path: 'a.md', raw: 'A', content: 'A', frontmatter: {}, size: 1, mtime: 0 },
    })
    const { note } = await mountAtRoute('/vault/a.md')
    expect(note.content.value).toBe('A')
    publishFileChange({ path: 'b.md', kind: 'write', newMtime: 1, newRaw: 'B' })
    await flushPromises()
    expect(note.content.value).toBe('A')
  })
})

// Regression: the production router (src/router/index.ts) declares TWO
// vault routes — 'vault' for the /vault index and 'vault-doc' for
// /vault/:pathMatch(.*)* — using the `pathMatch` splat param. The
// composable was originally written assuming a single 'vault' route
// with a `path` param (which is what the rest of this test file uses),
// and silently returned null path and empty content whenever a
// document was open. The AI panel then sent currentNotePath: '' and
// the server dropped the note context entirely. This block pins the
// production router shape so the next refactor can't quietly break
// it again.
describe('useCurrentNote — production router config', () => {
  beforeEach(() => {
    __setLiveTabsForTesting(shallowRef<Tab[]>([]))
  })

  afterEach(() => {
    __resetLiveTabsForTesting()
  })

  function makeProdRouter() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/vault', name: 'vault', component: { template: '<div/>' } },
        {
          path: '/vault/:pathMatch(.*)*',
          name: 'vault-doc',
          component: { template: '<div/>' },
        },
      ],
    })
  }

  async function mountOn(router: ReturnType<typeof makeProdRouter>) {
    let note: ReturnType<typeof useCurrentNote> | null = null
    const Comp = defineComponent({
      setup() {
        note = useCurrentNote()
        return () => h('div')
      },
    })
    const wrap = mount(Comp, { global: { plugins: [router] } })
    await flushPromises()
    return { note: note!, wrap }
  }

  it('reads path and content from /vault/:pathMatch (vault-doc route)', async () => {
    const live = getLiveTabs()!
    live.value = [makeTab({ path: 'foo.md', raw: 'live content' })]

    const router = makeProdRouter()
    await router.push('/vault/foo.md')
    await router.isReady()

    const { note, wrap } = await mountOn(router)
    expect(note.path.value).toBe('foo.md')
    expect(note.content.value).toBe('live content')

    wrap.unmount()
  })

  it('clears path and content when navigating to /vault (no path)', async () => {
    const live = getLiveTabs()!
    live.value = [makeTab({ path: 'foo.md', raw: 'live content' })]

    const router = makeProdRouter()
    await router.push('/vault/foo.md')
    await router.isReady()
    const { note, wrap } = await mountOn(router)
    expect(note.path.value).toBe('foo.md')

    await router.push('/vault')
    await flushPromises()
    expect(note.path.value).toBeNull()
    expect(note.content.value).toBe('')

    wrap.unmount()
  })

  it('re-resolves when navigating from one doc to another on the prod router', async () => {
    const live = getLiveTabs()!
    live.value = [
      makeTab({ path: 'a.md', raw: 'aaa' }),
      makeTab({ path: 'b.md', raw: 'bbb' }),
    ]

    const router = makeProdRouter()
    await router.push('/vault/a.md')
    await router.isReady()
    const { note, wrap } = await mountOn(router)
    expect(note.content.value).toBe('aaa')

    await router.push('/vault/b.md')
    await flushPromises()
    expect(note.path.value).toBe('b.md')
    expect(note.content.value).toBe('bbb')

    wrap.unmount()
  })
})
