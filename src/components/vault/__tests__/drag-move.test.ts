// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import * as api from '../../../lib/api'

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn().mockResolvedValue(true), answer: vi.fn(), queue: { value: [] } }),
}))
vi.mock('../../../composables/usePrompt', () => ({
  usePrompt: () => ({ prompt: vi.fn().mockResolvedValue(null), answer: vi.fn(), queue: { value: [] } }),
}))
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({
    toasts: { value: [] },
    info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn(),
  }),
}))

const TREE: TreeNode[] = [
  {
    kind: 'folder', name: 'content', path: '', children: [
      {
        kind: 'folder', name: 'inbox', path: 'inbox', children: [
          {
            kind: 'folder', name: 'test', path: 'inbox/test', children: [
              { kind: 'file', name: 'test1', path: 'inbox/test/test1', title: 'Test1', mtime: 0 },
            ],
          },
        ],
      },
      { kind: 'folder', name: 'literature', path: 'literature', children: [] },
      { kind: 'folder', name: 'zettel', path: 'zettel', children: [] },
    ],
  },
]

/** Walk a flat list of rendered tree rows to the one with the given label. */
function rowByLabel(rows: any[], name: string): any {
  return rows.filter((r: any) => r.find('.row-name')?.text() === name).pop()!
}

describe('FileTree drag-move (sub-documents)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('drops a sub-document onto its top-level inbox folder', async () => {
    // Simulate the round-trip so the move is observable without a server.
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/test1',
      title: 'test1',
      date: '',
      tags: [],
      size: 0,
      mtime: 0,
    })

    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    // Expand inbox -> test so the file is in the DOM and its <li> is the drag source.
    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const testFolder = rowByLabel(w.findAll('li.tree-row'), 'test')
    await testFolder.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const fileRow = rowByLabel(w.findAll('li.tree-row'), 'test1')

    // Fire a drop on the inbox row directly. This is what would happen if the
    // user dragged the file from inbox/test/ up to the inbox row in the tree.
    await inbox.trigger('drop', {
      dataTransfer: {
        getData: (k: string) => {
          if (k === 'text/x-docus-path') return 'inbox/test/test1'
          if (k === 'text/x-docus-kind') return 'file'
          return ''
        },
      },
    })
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(patchSpy).toHaveBeenCalledWith('inbox/test/test1', { targetPath: 'inbox/test1' })
    w.unmount()
  })

  it('still blocks moves into zettel (permanent notes are read-only)', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/test1', title: 'test1', date: '', tags: [], size: 0, mtime: 0,
    })
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    // Expand inbox -> test so the file is in the DOM.
    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const testFolder = rowByLabel(w.findAll('li.tree-row'), 'test')
    await testFolder.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const zettel = rowByLabel(w.findAll('li.tree-row'), 'zettel')
    await zettel.trigger('drop', {
      dataTransfer: {
        getData: (k: string) => {
          if (k === 'text/x-docus-path') return 'inbox/test/test1'
          if (k === 'text/x-docus-kind') return 'file'
          return ''
        },
      },
    })
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(patchSpy).not.toHaveBeenCalled()
    w.unmount()
  })

  it('blocks moves of a protected root itself (cannot re-parent inbox)', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'literature/inbox', title: 'inbox', date: '', tags: [], size: 0, mtime: 0,
    })
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    const literature = rowByLabel(w.findAll('li.tree-row'), 'literature')

    // Try to drag the inbox row itself onto literature.
    await literature.trigger('drop', {
      dataTransfer: {
        getData: (k: string) => {
          if (k === 'text/x-docus-path') return 'inbox'
          if (k === 'text/x-docus-kind') return 'folder'
          return ''
        },
      },
    })
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(patchSpy).not.toHaveBeenCalled()
    void inbox
    w.unmount()
  })
})
