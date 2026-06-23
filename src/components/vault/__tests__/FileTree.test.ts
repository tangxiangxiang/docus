// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import FileTree from '../FileTree.vue'
import type { PostSummary, TreeNode } from '../../../lib/api'
import { installDialogMocks } from '../../../__test-helpers__/dialogs'

installDialogMocks()

// New convention: implicit root is `src/content/`, surfaced in the API as a
// folder named "content" with path "". Top-level children are the Zettelkasten
// folders: inbox (fleeting), literature (source notes), zettel (permanent).
const TREE: TreeNode[] = [
  {
    kind: 'folder', name: 'content', path: '', children: [
      {
        kind: 'folder', name: 'inbox', path: 'inbox', children: [
          { kind: 'file', name: 'hello', path: 'inbox/hello', title: 'Hello', mtime: 0 },
          {
            kind: 'folder', name: 'notes', path: 'inbox/notes', children: [
              { kind: 'file', name: 'draft', path: 'inbox/notes/draft', title: 'Draft', mtime: 0 },
            ],
          },
        ],
      },
      {
        kind: 'folder', name: 'literature', path: 'literature', children: [
          { kind: 'file', name: 'ahrens-2017', path: 'literature/ahrens-2017', title: 'Ahrens 2017', mtime: 0 },
        ],
      },
      {
        kind: 'folder', name: 'zettel', path: 'zettel', children: [
          { kind: 'file', name: 'zettelkasten-intro', path: 'zettel/zettelkasten-intro', title: 'Zettelkasten intro', mtime: 0 },
        ],
      },
    ],
  },
]

/** Pick the leafmost row whose .row-name element has the given text. */
function rowByLabel(rows: any[], name: string): any {
  return rows.filter((r: any) => r.find('.row-name')?.text() === name).pop()!
}

describe('FileTree', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders top-level files and folders', () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    expect(w.text()).toContain('inbox')
    expect(w.text()).toContain('literature')
    expect(w.text()).toContain('zettel')
    // 'notes' is nested inside 'inbox' which is collapsed by default
    expect(w.text()).not.toContain('notes')
  })

  it('expands a folder on click and shows nested files', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const inboxRow = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inboxRow.find('.chevron').trigger('click')
    expect(w.text()).toContain('hello')
  })

  it('emits select when a file is clicked', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const inboxRow = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inboxRow.find('.chevron').trigger('click')
    const helloRow = rowByLabel(w.findAll('.tree-row'), 'hello')
    await helloRow.find('.row-name').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['inbox/hello'])
  })

  it('highlights the active row', () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: 'inbox/hello' } })
    const inboxRow = rowByLabel(w.findAll('.tree-row'), 'inbox')
    const expanded = inboxRow.findAll('.tree-row')
    const helloRow = expanded.find((r: any) => r.find('.row-name')?.text() === 'hello')
    expect(helloRow.classes('active')).toBe(true)
  })

  it('persists expansion to localStorage', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const inboxRow = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inboxRow.find('.chevron').trigger('click')
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).toContain('inbox')
  })

  it('default-expands ancestors of the current path on mount', () => {
    mount(FileTree, { props: { tree: TREE, currentPath: 'inbox/notes/draft' } })
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).toContain('inbox')
    expect(stored).toContain('inbox/notes')
  })
})

// Posts backing the search-input tests. Title and summary are the
// fields the search input matches against (besides the filename on the
// tree node itself), so each test case targets a different field:
//   - hello  → matched by basename ("hello")
//   - draft  → matched only by summary ("rough notes")
//   - ahrens → matched only by title ("Ahrens 2017")
const POSTS: PostSummary[] = [
  { path: 'inbox/hello',         title: 'Hello',          tags: ['greeting'],         summary: 'a warm greeting',  created: '2026-01-01', updated: '2026-01-01', size: 0, mtime: 0 },
  { path: 'inbox/notes/draft',   title: 'Draft',          tags: [],                   summary: 'rough notes',      created: '2026-01-02', updated: '2026-01-02', size: 0, mtime: 0 },
  { path: 'literature/ahrens-2017', title: 'Ahrens 2017', tags: ['book'],             summary: 'on smart notes',   created: '2026-01-03', updated: '2026-01-03', size: 0, mtime: 0 },
]

describe('FileTree search input', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders an always-on search input in the header', () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    const input = w.find('.search-input')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toContain('搜索')
  })

  it('does not filter anything when the query is empty', () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    // No input value, so the inbox / literature / zettel folders all
    // render as collapsed top-level rows.
    expect(w.text()).toContain('inbox')
    expect(w.text()).toContain('literature')
    expect(w.text()).toContain('zettel')
  })

  it('hides the clear-× button until the query is non-empty', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    expect(w.find('.search-clear-x').exists()).toBe(false)
    await w.find('.search-input').setValue('hello')
    expect(w.find('.search-clear-x').exists()).toBe(true)
  })

  it('matches by file basename (case-insensitive)', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('HELLO')
    // hello is in inbox; the folder auto-expands so the file is visible.
    expect(w.text()).toContain('hello')
    expect(w.text()).not.toContain('ahrens')
  })

  it('matches by title even when the basename does not contain the query', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('ahrens')
    expect(w.text()).toContain('ahrens-2017')
  })

  it('matches by summary even when filename + title do not contain the query', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('rough')
    expect(w.text()).toContain('draft')
    // And 'warm' only appears in hello's summary, not in any title or basename.
    await w.find('.search-input').setValue('warm')
    expect(w.text()).toContain('hello')
  })

  it('keeps an entire folder visible when the folder name matches', async () => {
    // 'zettel' as a query keeps all zettel/* children, even though
    // none of their names/titles/summaries contain 'zettel'. This is
    // the "scope to a folder by typing its name" workflow.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('zettel')
    expect(w.text()).toContain('zettelkasten-intro')
    // inbox is hidden because its folder name doesn't match 'zettel'
    // and no descendant matches.
    expect(w.text()).not.toContain('hello')
  })

  it('clears the query via the × button', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    const input = w.find('.search-input')
    await input.setValue('hello')
    expect((input.element as HTMLInputElement).value).toBe('hello')
    await w.find('.search-clear-x').trigger('click')
    expect((input.element as HTMLInputElement).value).toBe('')
    // After clearing, the inbox folder is collapsed again (the
    // search-forced expansion is layered on top of `expanded`, but
    // it does not write to `expanded` — and since `expanded` is
    // also empty here, the folder goes back to collapsed).
    expect(w.text()).toContain('inbox')
    expect(w.text()).not.toContain('hello')
  })

  it('clears the query on Escape', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    const input = w.find('.search-input')
    await input.setValue('hello')
    await input.trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('auto-expands ancestor folders when a search is active', async () => {
    // inbox is collapsed by default (no localStorage entry). When the
    // user types a query that matches a file inside it, the folder
    // should auto-expand so the match is visible without an extra click.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    expect(w.text()).not.toContain('hello')
    await w.find('.search-input').setValue('hello')
    expect(w.text()).toContain('hello')
    // Search-forced expansion must NOT mutate the persisted set — the
    // user's collapse decision survives across searches.
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).not.toContain('inbox')
  })

  it('combines with active-tag chips via AND (tag OR, then AND with query)', async () => {
    // activeTags=['greeting']: hello passes (it has the tag); draft and
    // ahrens are filtered out by the tag filter before the query runs.
    // Then query='hello' would pass hello again — visible.
    // Then query='ahrens': hello doesn't match by name/title/summary,
    // and ahrens is already gone from the tag filter, so nothing
    // passes — the empty-state branch should mention the tag+query
    // combination.
    const w = mount(FileTree, {
      props: { tree: TREE, posts: POSTS, currentPath: null, activeTags: ['greeting'] },
    })
    await w.find('.search-input').setValue('hello')
    expect(w.text()).toContain('hello')
    expect(w.text()).not.toContain('draft')

    await w.find('.search-input').setValue('ahrens')
    expect(w.text()).toContain('没有同时匹配')
  })

  it('shows an empty state when no file matches the query', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('xyznomatch')
    expect(w.text()).toContain('没有匹配')
    expect(w.text()).toContain('xyznomatch')
  })

  it('renders active-tag chips INSIDE the search row, not as a separate bar', () => {
    const w = mount(FileTree, {
      props: { tree: TREE, posts: POSTS, currentPath: null, activeTags: ['greeting', 'book'] },
    })
    // No .tag-filter-bar wrapper exists anymore — chips are merged into
    // the search row.
    expect(w.find('.tag-filter-bar').exists()).toBe(false)
    expect(w.find('.tag-filter-clear').exists()).toBe(false)
    // The chips live inside .search, before the input. Verify by
    // checking that the search row contains them and that the input
    // also lives inside it.
    const search = w.find('.search')
    expect(search.exists()).toBe(true)
    expect(search.findAll('.tag-filter-chip')).toHaveLength(2)
    expect(search.find('.search-input').exists()).toBe(true)
    // DOM order: chips appear before the input.
    const all = search.element.children
    const chipIdx = [...all].findIndex((el) => el.classList.contains('tag-filter-chip'))
    const inputIdx = [...all].findIndex((el) => el.classList.contains('search-input'))
    expect(chipIdx).toBeGreaterThanOrEqual(0)
    expect(inputIdx).toBeGreaterThan(chipIdx)
  })

  it('emits remove-tag with the chip text when its × is clicked', async () => {
    const w = mount(FileTree, {
      props: { tree: TREE, posts: POSTS, currentPath: null, activeTags: ['greeting'] },
    })
    const chipX = w.find('.tag-filter-chip-x')
    expect(chipX.exists()).toBe(true)
    await chipX.trigger('click')
    expect(w.emitted('remove-tag')).toEqual([['greeting']])
  })

  it('does not emit clear-tag-filter (the global clear-all was removed)', async () => {
    // The "清除" button is gone — clearing all tags is now an N-click
    // operation via individual chip × buttons. Pin this behavior so a
    // future refactor doesn't reintroduce a global clear without a
    // matching UI affordance.
    const w = mount(FileTree, {
      props: { tree: TREE, posts: POSTS, currentPath: null, activeTags: ['greeting', 'book'] },
    })
    expect(w.find('.tag-filter-clear').exists()).toBe(false)
    // Triggering every chip × should not produce a clear-tag-filter
    // event — the parent never sees it.
    for (const x of w.findAll('.tag-filter-chip-x')) await x.trigger('click')
    expect(w.emitted('clear-tag-filter')).toBeUndefined()
    // remove-tag should have fired exactly once per chip.
    expect(w.emitted('remove-tag')).toEqual([['greeting'], ['book']])
  })
})
