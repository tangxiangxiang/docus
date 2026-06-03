// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'

// Stub composables to isolate FileTree's behavior
vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), answer: vi.fn(), queue: { value: [] } }),
}))
vi.mock('../../../composables/usePrompt', () => ({
  usePrompt: () => ({ prompt: vi.fn().mockResolvedValue(null), answer: vi.fn(), queue: { value: [] } }),
}))
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    toasts: { value: [] },
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

// New convention: implicit root is `src/content/`, surfaced in the API as a
// folder named "content" with path "".
const TREE: TreeNode[] = [
  {
    kind: 'folder', name: 'content', path: '', children: [
      { kind: 'file', name: 'hello', path: 'hello', title: 'Hello', mtime: 0 },
      {
        kind: 'folder', name: 'notes', path: 'notes', children: [
          { kind: 'file', name: 'draft', path: 'notes/draft', title: 'Draft', mtime: 0 },
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
    expect(w.text()).toContain('hello')
    expect(w.text()).toContain('notes')
    // 'draft' is nested inside 'notes' which is collapsed by default
    expect(w.text()).not.toContain('draft')
  })

  it('expands a folder on click and shows nested files', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const notesRow = rowByLabel(w.findAll('.tree-row'), 'notes')
    await notesRow.find('.chevron').trigger('click')
    expect(w.text()).toContain('draft')
  })

  it('emits select when a file is clicked', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const helloRow = rowByLabel(w.findAll('.tree-row'), 'hello')
    await helloRow.find('.row-name').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['hello'])
  })

  it('highlights the active row', () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: 'hello' } })
    const active = rowByLabel(w.findAll('.tree-row'), 'hello')
    expect(active.classes('active')).toBe(true)
  })

  it('persists expansion to localStorage', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const notesRow = rowByLabel(w.findAll('.tree-row'), 'notes')
    await notesRow.find('.chevron').trigger('click')
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).toContain('notes')
  })

  it('default-expands ancestors of the current path on mount', () => {
    mount(FileTree, { props: { tree: TREE, currentPath: 'notes/draft' } })
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).toContain('notes')
  })
})
