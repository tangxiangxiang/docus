// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from "@vue/test-utils"
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import * as api from '../../../lib/api'
import { installDialogMocks, rowByLabel } from '../../../__test-helpers__/dialogs'

installDialogMocks()

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
      {
        kind: 'folder', name: 'zettel', path: 'zettel', children: [
          { kind: 'file', name: 'permanent', path: 'zettel/permanent', title: 'Permanent', mtime: 0 },
          { kind: 'folder', name: 'concepts', path: 'zettel/concepts', children: [] },
        ],
      },
    ],
  },
]



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
      created: '',
      updated: '',
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
    await flushPromises()

    expect(patchSpy).toHaveBeenCalledWith('inbox/test/test1', { targetPath: 'inbox/test1' })
    w.unmount()
  })

  it('still blocks dropping non-zettel notes directly onto the zettel root', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/test1', title: 'test1', created: '', updated: '', tags: [], size: 0, mtime: 0,
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
    await flushPromises()

    expect(patchSpy).not.toHaveBeenCalled()
    w.unmount()
  })

  it('allows classifying an inbox note by dropping it onto a zettel subfolder', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/concepts/test1', title: 'test1', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const testFolder = rowByLabel(w.findAll('li.tree-row'), 'test')
    await testFolder.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const zettel = rowByLabel(w.findAll('li.tree-row'), 'zettel')
    await zettel.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const concepts = rowByLabel(w.findAll('li.tree-row'), 'concepts')
    await concepts.trigger('drop', {
      dataTransfer: {
        getData: (k: string) => {
          if (k === 'text/x-docus-path') return 'inbox/test/test1'
          if (k === 'text/x-docus-kind') return 'file'
          return ''
        },
      },
    })
    await w.vm.$nextTick()
    await flushPromises()

    expect(patchSpy).toHaveBeenCalledWith('inbox/test/test1', { targetPath: 'zettel/concepts/test1' })
    w.unmount()
  })

  it('allows moving an existing zettel note into a zettel subfolder', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/concepts/permanent', title: 'permanent', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    const zettel = rowByLabel(w.findAll('li.tree-row'), 'zettel')
    await zettel.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const concepts = rowByLabel(w.findAll('li.tree-row'), 'concepts')
    await concepts.trigger('drop', {
      dataTransfer: {
        getData: (k: string) => {
          if (k === 'text/x-docus-path') return 'zettel/permanent'
          if (k === 'text/x-docus-kind') return 'file'
          return ''
        },
      },
    })
    await w.vm.$nextTick()
    await flushPromises()

    expect(patchSpy).toHaveBeenCalledWith('zettel/permanent', { targetPath: 'zettel/concepts/permanent' })
    w.unmount()
  })

  it('blocks moving a zettel note out to inbox', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/permanent', title: 'permanent', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.trigger('drop', {
      dataTransfer: {
        getData: (k: string) => {
          if (k === 'text/x-docus-path') return 'zettel/permanent'
          if (k === 'text/x-docus-kind') return 'file'
          return ''
        },
      },
    })
    await w.vm.$nextTick()
    await flushPromises()

    expect(patchSpy).not.toHaveBeenCalled()
    w.unmount()
  })

  it('blocks moves of a protected root itself (cannot re-parent inbox)', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'literature/inbox', title: 'inbox', created: '', updated: '', tags: [], size: 0, mtime: 0,
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
    await flushPromises()

    expect(patchSpy).not.toHaveBeenCalled()
    void inbox
    w.unmount()
  })
})
