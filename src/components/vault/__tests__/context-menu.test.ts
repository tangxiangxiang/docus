// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from "@vue/test-utils"
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import { installDialogMocks, rowByLabel, makeDT } from '../../../__test-helpers__/dialogs'

installDialogMocks()

const TREE: TreeNode[] = [
  {
    kind: 'folder', name: 'content', path: '', children: [
      {
        kind: 'folder', name: 'inbox', path: 'inbox', children: [
          { kind: 'file', name: 'hello', path: 'inbox/hello', title: 'Hello', mtime: 0 },
        ],
      },
      {
        kind: 'folder', name: 'literature', path: 'literature', children: [],
      },
      {
        kind: 'folder', name: 'zettel', path: 'zettel', children: [],
      },
    ],
  },
]

describe('FileTree context menu', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('right-click on inbox (protected root) shows a menu', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inboxRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'inbox')!
    expect(inboxRow.exists()).toBe(true)

    await inboxRow.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    await flushPromises()

    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).toContain('顶层目录')  // or similar readonly hint
    w.unmount()
  })

  it('right-click on a file inside inbox shows full menu', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inboxRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'inbox')!
    await inboxRow.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const helloRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'hello')!
    expect(helloRow.exists()).toBe(true)

    await helloRow.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    await flushPromises()

    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).toContain('重命名')
    expect(menu!.textContent).toContain('删除')
    w.unmount()
  })
})
