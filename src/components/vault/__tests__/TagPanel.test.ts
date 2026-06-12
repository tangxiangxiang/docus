// @vitest-environment jsdom
// Tests for the redesigned TagPanel: filter input, multi-select chips,
// and the result list. The component is a pure presentation layer —
// the active-tags set lives in useTagFilter; here we just verify the
// panel reflects the props it receives and emits the right events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TagPanel from '../TagPanel.vue'
import type { PostSummary } from '../../../lib/api'

const POSTS: PostSummary[] = [
  { path: 'inbox/markdown-syntax',     title: 'Markdown syntax',     created: '', updated: '', tags: ['markdown', 'reference'], size: 100, mtime: 0 },
  { path: 'inbox/typescript-utility-types', title: 'TS utility types', created: '', updated: '', tags: ['typescript', 'reference'], size: 100, mtime: 0 },
  { path: 'zettel/derivation',         title: 'Derivation',          created: '', updated: '', tags: ['math'],                    size: 100, mtime: 0 },
  { path: 'inbox/notes/draft',         title: 'Draft',               created: '', updated: '', tags: ['reference', 'draft'],      size: 100, mtime: 0 },
]

function mountPanel(props: { activeTags?: string[]; path?: string | null; posts?: PostSummary[] } = {}) {
  return mount(TagPanel, {
    props: {
      posts: props.posts ?? POSTS,
      activeTags: props.activeTags ?? [],
      path: props.path ?? null,
    },
  })
}

describe('TagPanel', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('lists all tags with their post counts when nothing is active', () => {
    const w = mountPanel()
    // reference 3, markdown 1, typescript 1, math 1, draft 1
    const items = w.findAll('.tag-entry')
    expect(items.length).toBe(5)
    expect(items[0].text()).toContain('reference')
    expect(items[0].text()).toContain('3')
  })

  it('emits select with the chosen tag when a chip is clicked', async () => {
    const w = mountPanel()
    const target = w.findAll('.tag-entry').find((b) => b.text().includes('markdown'))!
    await target.trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['markdown'])
  })

  it('marks active chips with .active and aria-pressed', () => {
    const w = mountPanel({ activeTags: ['markdown', 'typescript'] })
    const items = w.findAll('.tag-entry')
    const markdown = items.find((b) => b.text().includes('markdown'))!
    const reference = items.find((b) => b.text().includes('reference'))!
    expect(markdown.classes()).toContain('active')
    expect(markdown.attributes('aria-pressed')).toBe('true')
    expect(reference.classes()).not.toContain('active')
    expect(reference.attributes('aria-pressed')).toBe('false')
  })

  it('floats active tags to the top of the list', () => {
    const w = mountPanel({ activeTags: ['math'] })
    const items = w.findAll('.tag-entry')
    // math has count 1; reference has count 3. With the active float,
    // math should appear before reference.
    expect(items[0].text()).toContain('math')
  })

  it('filters the visible tag list by the search input', async () => {
    const w = mountPanel()
    await w.get('.tag-filter-input').setValue('ref')
    const items = w.findAll('.tag-entry')
    expect(items.length).toBe(1)
    expect(items[0].text()).toContain('reference')
  })

  it('shows "没有匹配的 tag" when the filter has no hits', async () => {
    const w = mountPanel()
    await w.get('.tag-filter-input').setValue('zzz')
    expect(w.find('.tag-entry').exists()).toBe(false)
    expect(w.text()).toContain('没有匹配的 tag')
  })

  it('the trailing × clears the filter input', async () => {
    const w = mountPanel()
    const input = w.get('.tag-filter-input')
    await input.setValue('ref')
    expect((input.element as HTMLInputElement).value).toBe('ref')
    await w.get('.tag-filter-clear-x').trigger('click')
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('Escape in the filter input clears it', async () => {
    const w = mountPanel()
    const input = w.get('.tag-filter-input')
    await input.setValue('ref')
    await input.trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('hides the results section when no tags are active', () => {
    const w = mountPanel()
    expect(w.find('.results').exists()).toBe(false)
  })

  it('renders the OR-joined active tag header in results', () => {
    const w = mountPanel({ activeTags: ['reference', 'typescript'] })
    const header = w.find('.results-title')
    expect(header.exists()).toBe(true)
    expect(header.text()).toContain('#reference')
    expect(header.text()).toContain('#typescript')
    expect(header.text()).toContain('∪')
  })

  it('lists posts that match ANY of the active tags (OR semantics)', () => {
    const w = mountPanel({ activeTags: ['reference', 'math'] })
    // reference: 3 posts (markdown-syntax, typescript-utility-types, draft)
    // math:      1 post  (derivation)
    // OR:        4 unique posts
    const items = w.findAll('.result-entry')
    expect(items.length).toBe(4)
    const titles = items.map((b) => b.text())
    expect(titles.some((t) => t.includes('Markdown syntax'))).toBe(true)
    expect(titles.some((t) => t.includes('Derivation'))).toBe(true)
  })

  it('emits open with the post path when a result is clicked', async () => {
    const w = mountPanel({ activeTags: ['reference'] })
    const first = w.find('.result-entry')
    await first.trigger('click')
    expect(w.emitted('open')?.[0]).toEqual([POSTS[0].path])
  })

  it('trims the leading scope (inbox/literature/zettel) from the displayed path', () => {
    const w = mountPanel({ activeTags: ['reference'] })
    const paths = w.findAll('.result-path').map((s) => s.text())
    // 'inbox/markdown-syntax' -> 'markdown-syntax'
    expect(paths.some((p) => p === 'markdown-syntax')).toBe(true)
    // 'inbox/notes/draft' -> 'notes / draft'
    expect(paths.some((p) => p === 'notes / draft')).toBe(true)
  })
})
