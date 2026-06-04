// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
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
