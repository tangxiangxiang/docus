// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useCurrentNote, __resetForTesting } from '../useCurrentNote'

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
    const { note } = await mountAtRoute('/tags')
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
