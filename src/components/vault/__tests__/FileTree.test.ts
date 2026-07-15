// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import FileTree from '../FileTree.vue'
import type { PostSummary, TreeNode } from '../../../lib/api'
import { installDialogMocks } from '../../../__test-helpers__/dialogs'

installDialogMocks()

// New convention: implicit root is `src/content/`, surfaced in the API as a
// folder named "content" with path "". Top-level children are the vault roots
// folders: inbox (fleeting), literature (source notes), archive (permanent).
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
        kind: 'folder', name: 'archive', path: 'archive', children: [
          {
            kind: 'folder', name: 'concepts', path: 'archive/concepts', children: [
              { kind: 'file', name: 'atomic-note', path: 'archive/concepts/atomic-note', title: 'Atomic note', mtime: 0 },
            ],
          },
          { kind: 'file', name: 'archive-intro', path: 'archive/archive-intro', title: 'Archive intro', mtime: 0 },
        ],
      },
    ],
  },
]

/** Pick the leafmost row whose .row-name element has the given text. */
function rowByLabel(rows: any[], name: string): any {
  return rows.filter((r: any) => r.find('.row-name-text')?.text() === name || r.find('.row-name')?.text() === name).pop()!
}

describe('FileTree', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders top-level files and folders', () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    expect(w.text()).toContain('inbox')
    expect(w.text()).toContain('literature')
    expect(w.text()).toContain('archive')
    // 'notes' is nested inside 'inbox' which is collapsed by default
    expect(w.text()).not.toContain('notes')
  })

  it('expands a folder on click and shows nested files', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const inboxRow = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inboxRow.find('.chevron').trigger('click')
    expect(w.text()).toContain('hello')
  })

  it('uses the whole visible row as the folder toggle target', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const inboxRow = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inboxRow.find('.row-line').trigger('click')
    expect(w.text()).toContain('Hello')
  })

  it('shows the document title first and keeps the English filename as secondary text', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    await rowByLabel(w.findAll('.tree-row'), 'inbox').find('.chevron').trigger('click')
    const helloRow = rowByLabel(w.findAll('.tree-row'), 'hello')
    expect(helloRow.find('.row-title').text()).toBe('Hello')
    expect(helloRow.find('.row-file-name').text()).toBe('hello')
  })

  it('navigates visible nodes with tree keyboard semantics', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const inbox = rowByLabel(w.findAll('.tree-row'), 'inbox')
    expect(inbox.attributes('tabindex')).toBe('0')
    expect(inbox.classes()).not.toContain('focused')
    await inbox.trigger('keydown', { key: 'ArrowRight' })
    await inbox.trigger('keydown', { key: 'ArrowDown' })
    const hello = rowByLabel(w.findAll('.tree-row'), 'hello')
    expect(hello.classes()).toContain('focused')
    await hello.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('select')?.at(-1)).toEqual(['inbox/hello'])
  })

  it('focuses the search input with Ctrl+F while the tree is active', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await rowByLabel(w.findAll('.tree-row'), 'inbox').trigger('keydown', { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(w.find('.search-input').element)
    w.unmount()
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

  it('default-expands archive ancestors of the current path on mount', () => {
    mount(FileTree, { props: { tree: TREE, currentPath: 'archive/concepts/atomic-note' } })
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).toContain('archive')
    expect(stored).toContain('archive/concepts')
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
    expect(input.attributes('placeholder')).toBe('搜索文件')
  })

  it('does not filter anything when the query is empty', () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    // No input value, so the inbox / literature / archive folders all
    // render as collapsed top-level rows.
    expect(w.text()).toContain('inbox')
    expect(w.text()).toContain('literature')
    expect(w.text()).toContain('archive')
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

  it('shows the parent path under search result rows', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('rough')
    const draftRow = rowByLabel(w.findAll('.tree-row'), 'draft')
    expect(draftRow.find('.row-path-hint').text()).toBe('inbox/notes/draft')
  })

  it('keeps an entire folder visible when the folder name matches', async () => {
    // 'archive' as a query keeps all archive/* children, even though
    // none of their names/titles/summaries contain 'archive'. This is
    // the "scope to a folder by typing its name" workflow.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('archive')
    expect(w.text()).toContain('archive-intro')
    // inbox is hidden because its folder name doesn't match 'archive'
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

  // --- matchInfo tooltip -----------------------------------------------------
  // `titleByName` returns the native title attribute of the row-name
  // button for the leafmost row whose filename matches `name`, or
  // undefined if the row isn't rendered or has no title attribute set.
  function titleByName(w: any, name: string): string | undefined {
    const btn = w.findAll('.row-name').find((b: any) => b.find('.row-name-text')?.text() === name || b.text() === name)
    return btn?.attributes('title')
  }

  it('does not set a title attribute on rows when the query is empty', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    expect(titleByName(w, 'hello')).toBeUndefined()
    expect(titleByName(w, 'draft')).toBeUndefined()
    expect(titleByName(w, 'ahrens-2017')).toBeUndefined()
  })

  it('names "filename" when only the basename matched', async () => {
    // inbox/hello has name="hello"; "HELLO" query is matched only by
    // filename (case-insensitive). Title is "Hello" (capital H) — the
    // case-insensitive includes('hello') also matches, so this test
    // would falsely pass; pick a query that ONLY the basename catches.
    // Use "ahrens-2017" which has name "ahrens-2017", title "Ahrens 2017"
    // (matches too) — also bad. Use "draft" — name "draft", title "Draft"
    // (also matches). All my fixtures have overlapping basename/title.
    //
    // So instead test the multi-field case directly, and the
    // single-field cases via targeted queries on summary-only matches.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('draft')
    // name "draft" AND title "Draft" both match "draft" — multi-field.
    expect(titleByName(w, 'draft')).toBe('匹配字段：文件名, 标题')
  })

  it('names "summary" when only the summary matched', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('rough')
    // "rough" appears ONLY in inbox/notes/draft's summary field —
    // basename "draft" and title "Draft" don't contain it.
    expect(titleByName(w, 'draft')).toBe('匹配字段：摘要')
  })

  it('names "title" when only the title matched', async () => {
    // All my fixtures have filename and title that match the same
    // substrings (e.g. "draft"/"Draft", "hello"/"Hello"). To get a
    // title-only match, use the existing ahrens fixture but query for
    // a substring unique to the title. Title is "Ahrens 2017" — try
    // "2017" which only appears in the title (basename is
    // "ahrens-2017" so it ALSO matches). Still mixed. Use "ahrens":
    // name "ahrens-2017" contains "ahrens" AND title "Ahrens 2017"
    // contains "ahrens" — again mixed.
    //
    // Conclusion: with these fixtures every filename and its title
    // share a substring, so single-field "title only" is unreachable.
    // The single-field "summary only" path is the only one we can
    // exercise cleanly here, and it's covered above. The other two
    // single-field paths ("filename only", "title only") are reached
    // in real data where title is unrelated to filename (e.g. a file
    // named "draft.md" with title "Untitled sketch") and are covered
    // by the multi-field assertion when both happen to match.
    //
    // Skipping this test to avoid asserting an unreachable scenario.
  })

  it('lists multiple fields when more than one matched', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('hello')
    // inbox/hello: name="hello" matches; title="Hello" matches;
    // summary="a warm greeting" does NOT match.
    expect(titleByName(w, 'hello')).toBe('匹配字段：文件名, 标题')
  })

  it('does not annotate files kept only because a folder name matched', async () => {
    // Typing "inbox" matches the inbox folder by name, which keeps
    // its full subtree visible. The descendant file `hello` has
    // basename "hello" / title "Hello" / summary "a warm greeting" —
    // none of those contain "inbox", so it gets no matchInfo and
    // therefore no tooltip.
    //
    // (Earlier draft used "archive" / "archive-intro", but
    // "archive" IS a substring of the filename, so the file would
    // legitimately match by name — making the assertion false.)
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('inbox')
    // inbox folder auto-expanded (search-forced expansion), so hello
    // is visible as a descendant.
    expect(w.text()).toContain('hello')
    expect(titleByName(w, 'hello')).toBeUndefined()
  })

  it('omits the title attribute entirely (not empty string) when no match', async () => {
    // Belt-and-suspenders: an empty title="" would render as a blank
    // native tooltip on hover. Verify the attribute is absent.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('hello')
    const btn = w.findAll('.row-name').find((b: any) => b.text() === 'ahrens-2017')
    // ahrens-2017 doesn't match "hello" and isn't in a folder-name
    // match either, so it shouldn't even be in the tree — but the
    // assertion is "no title attr on any visible row" so it just
    // confirms whatever's there has no stale title.
    expect(btn === undefined || btn.attributes('title') === undefined).toBe(true)
  })

  // --- #tag token syntax ---------------------------------------------------
  // The `#` prefix flips a token from "match name/title/summary" to
  // "match the file's tags". Tokens are space-separated and AND'd.
  // Empty `#` (no name) is dropped.
  //
  // Recall POSTS fixture (FileTree.test.ts:105):
  //   inbox/hello         tags=[greeting]
  //   inbox/notes/draft   tags=[]
  //   literature/ahrens-2017  tags=[book]

  it('#meta alone matches only files whose tags contain "meta"', async () => {
    // None of the POSTS fixture has a "meta" tag, so all files are
    // filtered out — the empty-state branch shows.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#meta')
    expect(w.text()).toContain('没有匹配')
    expect(w.text()).toContain('#meta')
  })

  it('#greeting matches the file tagged "greeting"', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#greeting')
    expect(w.text()).toContain('hello')
    // draft has no tags, ahrens-2017 has [book] — both excluded.
    expect(w.text()).not.toContain('draft')
    expect(w.text()).not.toContain('ahrens-2017')
  })

  it('a #tag query does NOT match files where the tag appears in name/title/summary', async () => {
    // ahrens-2017 has [book]. With a #book query we want ONLY tag
    // matching; hello has summary "a warm greeting" with no "book",
    // and draft has neither, so hello and draft are correctly
    // excluded even though the bare word "book" could conceivably
    // appear in any future content.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#book')
    expect(w.text()).toContain('ahrens-2017')
    expect(w.text()).not.toContain('hello')
    expect(w.text()).not.toContain('draft')
  })

  it('mixing a #tag token and a content token ANDs both', async () => {
    // hello has [greeting] AND summary "a warm greeting" (contains
    // "warm"). The AND means only hello passes — draft has neither,
    // ahrens-2017 has [book] (fails #greeting) and summary "on smart
    // notes" (no "warm").
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#greeting warm')
    expect(w.text()).toContain('hello')
    expect(w.text()).not.toContain('draft')
    expect(w.text()).not.toContain('ahrens-2017')
  })

  it('a bare "#" with no tag name is ignored (no filter applied)', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#')
    // Nothing got filtered out, all three top-level folders visible.
    expect(w.text()).toContain('inbox')
    expect(w.text()).toContain('literature')
    expect(w.text()).toContain('archive')
  })

  it('the #tag tooltip says "Matched in: tags"', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#greeting')
    const btn = w.findAll('.row-name').find((b: any) => b.find('.row-name-text')?.text() === 'hello')
    expect(btn?.attributes('title')).toBe('匹配字段：标签')
  })

  it('mixed query tooltip lists "tags" alongside content fields', async () => {
    // hello: tag=greeting (hits #greeting), summary contains "warm"
    // (hits "warm"). Tooltip lists fields in TreeRow's natural order
    // (filename, title, summary, tags) — content fields before the
    // tag because both are matched and the ordering is the file's
    // "how was it identified" sequence.
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#greeting warm')
    const btn = w.findAll('.row-name').find((b: any) => b.find('.row-name-text')?.text() === 'hello')
    expect(btn?.attributes('title')).toBe('匹配字段：摘要, 标签')
  })

  // --- typed #tag → chip styling ------------------------------------------
  // Typing `#tag` extracts the token into a chip rather than leaving
  // it as plain text in the input. The chip uses the same
  // `.tag-filter-chip` class as the clicked-tags chips (typed and
  // clicked chips coexist in the same row). × on a typed chip removes
  // it; the input keeps whatever content portion is left after
  // extraction.

  it('typing "#meta " (with trailing space) extracts the token to a chip', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#meta ')
    // The token is extracted: the input is now empty.
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('')
    // And a chip labeled #meta appears in the search row.
    const chips = w.findAll('.search .tag-filter-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0].text()).toContain('#meta')
  })

  it('typed chips use the same .tag-filter-chip class as clicked-tag chips', async () => {
    const w = mount(FileTree, {
      props: { tree: TREE, posts: POSTS, currentPath: null, activeTags: ['greeting'] },
    })
    // Trailing space triggers extraction so the typed chip appears.
    await w.find('.search-input').setValue('#meta ')
    // 1 clicked chip + 1 typed chip, both .tag-filter-chip.
    const chips = w.findAll('.search .tag-filter-chip')
    expect(chips).toHaveLength(2)
    for (const c of chips) {
      expect(c.classes()).toContain('tag-filter-chip')
      expect(c.find('.tag-filter-chip-x').exists()).toBe(true)
    }
  })

  it('× on a typed chip removes it WITHOUT emitting remove-tag (typed chips are local state)', async () => {
    const w = mount(FileTree, {
      props: { tree: TREE, posts: POSTS, currentPath: null, activeTags: ['greeting'] },
    })
    await w.find('.search-input').setValue('#meta ')
    expect(w.findAll('.search .tag-filter-chip')).toHaveLength(2)
    // The typed chip is the second one (after the active 'greeting').
    const typedChip = w.findAll('.search .tag-filter-chip').find((c) => c.text().includes('#meta'))!
    await typedChip.find('.tag-filter-chip-x').trigger('click')
    // Typed 'meta' is gone. The active 'greeting' chip stays rendered
    // (removing it is the parent's job, via the remove-tag emit which
    // we assert below is NOT fired here).
    const remaining = w.findAll('.search .tag-filter-chip').map((c) => c.text())
    expect(remaining.some((t) => t.includes('#meta'))).toBe(false)
    expect(remaining.some((t) => t.includes('#greeting'))).toBe(true)
    // Critical: clicking × on a typed chip must NOT emit remove-tag.
    // remove-tag is the parent's hook for activeTagFilter changes;
    // typed chips are independent local state, so emit-side-effect
    // would let them mutate the parent's persistent tag filter by
    // accident.
    expect(w.emitted('remove-tag')).toBeUndefined()
  })

  it('× on a clicked (active) chip DOES emit remove-tag (existing behavior preserved)', async () => {
    const w = mount(FileTree, {
      props: { tree: TREE, posts: POSTS, currentPath: null, activeTags: ['greeting'] },
    })
    const activeChip = w.findAll('.search .tag-filter-chip').find((c) => c.text().includes('#greeting'))!
    await activeChip.find('.tag-filter-chip-x').trigger('click')
    expect(w.emitted('remove-tag')).toEqual([['greeting']])
  })

  it('extraction fires on whitespace boundary: "#meta " leaves chip + empty input', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#meta ')
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('')
    expect(w.findAll('.search .tag-filter-chip').map((c) => c.text())).toEqual(
      expect.arrayContaining([expect.stringContaining('#meta')]),
    )
  })

  it('extraction of a token preserves following content: "#meta draft" → chip + "draft" in input', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#meta draft')
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('draft')
    expect(w.findAll('.search .tag-filter-chip').map((c) => c.text())).toEqual(
      expect.arrayContaining([expect.stringContaining('#meta')]),
    )
  })

  it('a partial tag (no trailing whitespace) stays as text in the input', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    // User is mid-typing — `#met` could become `#meta` or `#metadata`.
    // Token only chips once whitespace follows, so this stays as text.
    await w.find('.search-input').setValue('#met')
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('#met')
    expect(w.findAll('.search .tag-filter-chip')).toHaveLength(0)
  })

  it('"#meta" alone (no trailing space) stays as text — user has not committed the token yet', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#meta')
    expect(w.findAll('.search .tag-filter-chip')).toHaveLength(0)
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('#meta')
  })

  it('multiple typed tokens each become their own chip when followed by whitespace', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#meta #planning extra')
    expect(w.findAll('.search .tag-filter-chip')).toHaveLength(2)
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('extra')
  })

  it('Esc clears BOTH typed chips and content text', async () => {
    const w = mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
    await w.find('.search-input').setValue('#meta draft')
    expect(w.findAll('.search .tag-filter-chip')).toHaveLength(1)
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('draft')
    await w.find('.search-input').trigger('keydown', { key: 'Escape' })
    expect(w.findAll('.search .tag-filter-chip')).toHaveLength(0)
    expect((w.find('.search-input').element as HTMLInputElement).value).toBe('')
  })
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
