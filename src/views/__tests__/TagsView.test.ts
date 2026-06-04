// @vitest-environment jsdom
// Regression for: /tags and /tags/:tag both used to read from a build-time
// glob (src/posts/index.ts -> import.meta.glob under content/posts), but
// real content lives under src/content/{inbox,literature,zettel}, not
// `posts/`. The glob returned an empty array, so the tag aggregation was
// always empty and the user saw "No tags yet." on /tags and "No posts with
// this tag." on /tags/:tag, even though the vault TagPanel — which uses
// /api/posts — showed the correct counts.
//
// The fix: both views now fetch /api/posts on mount. These tests stub fetch
// and verify the rendered list mirrors what the API returned.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import TagsView from '../TagsView.vue'
import TagDetailView from '../TagDetailView.vue'
import type { PostSummary } from '../../lib/api'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tags/:tag', component: { template: '<div/>' } },
      { path: '/tags', component: { template: '<div/>' } },
    ],
  })
}

const SAMPLE_POSTS: PostSummary[] = [
  {
    path: 'inbox/markdown-syntax',
    title: 'Markdown syntax',
    date: '',
    tags: ['markdown', 'reference'],
    size: 100,
    mtime: 0,
  },
  {
    path: 'inbox/typescript-utility-types',
    title: 'TS utility types',
    date: '',
    tags: ['typescript', 'reference'],
    size: 100,
    mtime: 0,
  },
  {
    path: 'zettel/derivation',
    title: 'Derivation',
    date: '',
    tags: ['math'],
    size: 100,
    mtime: 0,
  },
]

function stubFetchPosts(posts: PostSummary[]) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => posts,
  })) as unknown as typeof fetch
}

function stubFetchError(message: string) {
  return vi.fn(async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    json: async () => ({ error: message }),
  })) as unknown as typeof fetch
}

describe('TagsView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('aggregates tags across all posts from /api/posts', async () => {
    vi.stubGlobal('fetch', stubFetchPosts(SAMPLE_POSTS))
    const router = makeRouter()
    router.push('/tags')
    await router.isReady()

    const wrapper = mount(TagsView, { global: { plugins: [router] } })
    await flushPromises()

    // Sorted by count desc: reference (2), markdown (1), typescript (1), math (1)
    const items = wrapper.findAll('.tag-list li')
    expect(items.length).toBe(4)
    // reference is the only tag with count 2, so it sorts first
    expect(items[0].text()).toContain('#reference')
    expect(items[0].text()).toContain('(2)')

    // Deep-link to the tag detail page
    expect(items[0].find('a').attributes('href')).toBe('/tags/reference')
  })

  it('shows "No tags yet." when the API returns an empty list', async () => {
    vi.stubGlobal('fetch', stubFetchPosts([]))
    const router = makeRouter()
    router.push('/tags')
    await router.isReady()

    const wrapper = mount(TagsView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.find('.empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('No tags yet')
    expect(wrapper.find('.tag-list').exists()).toBe(false)
  })

  it('surfaces the API error when /api/posts fails', async () => {
    vi.stubGlobal('fetch', stubFetchError('boom'))
    const router = makeRouter()
    router.push('/tags')
    await router.isReady()

    const wrapper = mount(TagsView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load: boom')
  })
})

describe('TagDetailView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists only posts that include the active tag', async () => {
    vi.stubGlobal('fetch', stubFetchPosts(SAMPLE_POSTS))
    const router = makeRouter()
    router.push('/tags/reference')
    await router.isReady()

    const wrapper = mount(TagDetailView, { global: { plugins: [router] } })
    await flushPromises()

    const items = wrapper.findAll('.post-list li')
    expect(items.length).toBe(2)
    expect(items[0].text()).toContain('Markdown syntax')
    expect(items[1].text()).toContain('TS utility types')
    // Each result links into the vault at the post's path
    expect(items[0].find('a').attributes('href')).toBe('/vault/inbox/markdown-syntax')
  })

  it('shows "No posts with this tag." when nothing matches', async () => {
    vi.stubGlobal('fetch', stubFetchPosts(SAMPLE_POSTS))
    const router = makeRouter()
    router.push('/tags/nonexistent')
    await router.isReady()

    const wrapper = mount(TagDetailView, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.text()).toContain('No posts with this tag')
  })
})
