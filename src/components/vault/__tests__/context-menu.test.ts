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
    // The context menu is teleported to <body>, so it survives
    // w.unmount() and would leak into the next case's
    // document.querySelector('.tree-context-menu'). Wipe any leftover
    // menu before each case so the assertion always reads the menu the
    // current right-click produced, not the one from a prior case.
    document.querySelectorAll('.tree-context-menu').forEach((el) => el.remove())
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

  // Permission-split regression: protected roots (inbox / literature) keep
  // their names but their *children* are still user content. The original
  // menu gated everything on a single "readonly" boolean, so right-clicking
  // inbox/literature offered no way to add a child. These cases pin the
  // new matrix: protected root → create-in only, zettel subtree →
  // nothing, ordinary file → full menu.
  it('right-click on a protected root (inbox) shows create-in buttons but no rename/delete', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inboxRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'inbox')!

    await inboxRow.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    await flushPromises()

    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    // Create-in is now exposed on protected roots.
    expect(menu!.textContent).toContain('新建文件')
    expect(menu!.textContent).toContain('新建文件夹')
    // Name-modifying ops remain blocked — the folder name is pinned.
    expect(menu!.textContent).not.toContain('重命名')
    expect(menu!.textContent).not.toContain('删除')
    // The hint footer is the user-facing explanation.
    expect(menu!.textContent).toContain('顶层目录')
    w.unmount()
  })

  it('right-click on zettel (protected root inside the read-only subtree) hides create-in', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const zettelRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'zettel')!

    await zettelRow.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    await flushPromises()

    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    // zettel is a permanent-notes sink — even the root can't grow new
    // children, so neither create-in nor rename/delete appear.
    expect(menu!.textContent).not.toContain('新建文件')
    expect(menu!.textContent).not.toContain('新建文件夹')
    expect(menu!.textContent).not.toContain('重命名')
    expect(menu!.textContent).not.toContain('删除')
    expect(menu!.textContent).toContain('永久笔记')
    w.unmount()
  })

  it('protected root row is not draggable (draggable attribute reflects canModify)', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inboxRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'inbox')!
    // The draggable attribute is the public contract for "this row can be
    // dragged out of its parent". A protected root cannot be re-parented,
    // so the attribute should be the string "false" (Vue binds booleans
    // that way to the DOM property).
    expect(inboxRow.attributes('draggable')).toBe('false')
    w.unmount()
  })
})
