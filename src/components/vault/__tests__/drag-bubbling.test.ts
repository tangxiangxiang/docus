// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from "@vue/test-utils"
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import * as api from '../../../lib/api'
import { installDialogMocks, makeDT, rowByLabel } from '../../../__test-helpers__/dialogs'

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
          { kind: 'file', name: 'markdown-syntax', path: 'inbox/markdown-syntax', title: 'Markdown Syntax', mtime: 0 },
        ],
      },
      { kind: 'folder', name: 'literature', path: 'literature', children: [] },
      { kind: 'folder', name: 'zettel', path: 'zettel', children: [] },
    ],
  },
]



describe('FileTree full drag flow (with bubbling)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('dragstart on a child file does NOT overwrite payload with the parent folder path', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const mdRow = rowByLabel(w.findAll('li.tree-row'), 'markdown-syntax')
    const dt = makeDT()
    await mdRow.trigger('dragstart', { dataTransfer: dt })
    await w.vm.$nextTick()

    // The bug: dragstart bubbled to inbox and overwrote 'inbox/markdown-syntax'
    // with 'inbox', so onMove would think the user is trying to move the
    // protected folder. The fix: stopPropagation in onDragStart.
    expect(dt.getData('text/x-docus-path')).toBe('inbox/markdown-syntax')
    w.unmount()
  })

  it('dragging a sub-folder onto a sibling folder keeps the sub-folder path', async () => {
    // Extend the tree with a sibling sub-folder so the move is observable.
    const TREE2: TreeNode[] = [
      {
        kind: 'folder', name: 'content', path: '', children: [
          {
            kind: 'folder', name: 'inbox', path: 'inbox', children: [
              {
                kind: 'folder', name: 'test', path: 'inbox/test', children: [],
              },
              {
                kind: 'folder', name: 'notes', path: 'inbox/notes', children: [],
              },
            ],
          },
          { kind: 'folder', name: 'literature', path: 'literature', children: [] },
          { kind: 'folder', name: 'zettel', path: 'zettel', children: [] },
        ],
      },
    ]
    const w = mount(FileTree, { props: { tree: TREE2, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const testRow = rowByLabel(w.findAll('li.tree-row'), 'test')
    const notesRow = rowByLabel(w.findAll('li.tree-row'), 'notes')

    const dt = makeDT()
    await testRow.trigger('dragstart', { dataTransfer: dt })
    await w.vm.$nextTick()

    // If dragstart bubbled to inbox, payload would be 'inbox' not 'inbox/test'.
    expect(dt.getData('text/x-docus-path')).toBe('inbox/test')
    void notesRow
    w.unmount()
  })

  it('end-to-end: dragging markdown-syntax onto test results in the right PATCH', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/test/markdown-syntax', title: 'markdown-syntax',
      created: '', updated: '', tags: [], size: 0, mtime: 0,
    })
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const mdRow = rowByLabel(w.findAll('li.tree-row'), 'markdown-syntax')
    const testRow = rowByLabel(w.findAll('li.tree-row'), 'test')

    const dt = makeDT()
    await mdRow.trigger('dragstart', { dataTransfer: dt })
    await w.vm.$nextTick()
    await testRow.trigger('dragenter', { dataTransfer: dt })
    await testRow.trigger('dragover', { dataTransfer: dt })
    await testRow.trigger('drop', { dataTransfer: dt })
    await mdRow.trigger('dragend', { dataTransfer: dt })
    await w.vm.$nextTick()
    await flushPromises()

    expect(patchSpy).toHaveBeenCalledWith('inbox/markdown-syntax', { targetPath: 'inbox/test/markdown-syntax' })
    w.unmount()
  })
})

