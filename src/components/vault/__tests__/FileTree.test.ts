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

const TREE: TreeNode[] = [
  { kind: 'file', name: 'hello', path: 'posts/hello', title: 'Hello', mtime: 0 },
  {
    kind: 'folder', name: 'notes', path: 'posts/notes', children: [
      { kind: 'file', name: 'draft', path: 'posts/notes/draft', title: 'Draft', mtime: 0 },
    ],
  },
]

describe('FileTree', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders top-level files and folders', () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    expect(w.text()).toContain('hello')
    expect(w.text()).toContain('notes')
    // 'draft' is nested inside 'notes' and should be hidden when notes is collapsed
    expect(w.text()).not.toContain('draft')
  })

  it('expands a folder on click and shows nested files', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    // Find the chevron in the 'notes' row
    const rows = w.findAll('.tree-row')
    const notesRow = rows.find((r) => r.text().includes('notes'))!
    await notesRow.find('.chevron').trigger('click')
    expect(w.text()).toContain('draft')
  })

  it('emits select when a file is clicked', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const rows = w.findAll('.tree-row')
    const helloRow = rows.find((r) => r.text().includes('hello'))!
    await helloRow.find('.row-name').trigger('click')
    expect(w.emitted('select')?.[0]).toEqual(['posts/hello'])
  })

  it('highlights the active row', () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: 'posts/hello' } })
    const active = w.findAll('.tree-row').find((r) => r.classes('active'))
    expect(active).toBeTruthy()
    expect(active!.text()).toContain('hello')
  })

  it('persists expansion to localStorage', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const rows = w.findAll('.tree-row')
    const notesRow = rows.find((r) => r.text().includes('notes'))!
    await notesRow.find('.chevron').trigger('click')
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).toContain('posts/notes')
  })

  it('default-expands ancestors of the current path on mount', () => {
    mount(FileTree, { props: { tree: TREE, currentPath: 'posts/notes/draft' } })
    const stored = JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')
    expect(stored).toContain('posts/notes')
  })
})
