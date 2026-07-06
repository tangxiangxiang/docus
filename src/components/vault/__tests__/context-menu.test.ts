// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from "@vue/test-utils"
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import { installDialogMocks } from '../../../__test-helpers__/dialogs'

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
        kind: 'folder', name: 'literature', path: 'literature', children: [
          { kind: 'file', name: 'ahrens', path: 'literature/ahrens', title: 'Ahrens 2017', mtime: 0 },
        ],
      },
      {
        kind: 'folder', name: 'zettel', path: 'zettel', children: [
          { kind: 'file', name: 'permanent', path: 'zettel/permanent', title: 'Permanent', mtime: 0 },
        ],
      },
      // A user-defined top-level folder that is NOT one of the three
      // protected roots. Files inside are user content but the
      // archive-to-zettel action should not appear (only inbox/ and
      // literature/ files qualify).
      {
        kind: 'folder', name: 'archive', path: 'archive', children: [
          { kind: 'file', name: 'old', path: 'archive/old', title: 'Old', mtime: 0 },
        ],
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
  // matrix: protected root → create-in, zettel folder → create folders
  // only, ordinary file → full menu.
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
    w.unmount()
  })

  it('right-click on zettel shows new-folder only, not direct note creation', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const zettelRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'zettel')!

    await zettelRow.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    await flushPromises()

    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    const labels = Array.from(menu!.querySelectorAll('button')).map((b) => b.textContent)
    expect(labels).toContain('新建文件夹')
    expect(labels).not.toContain('新建文件')
    expect(labels).not.toContain('重命名')
    expect(labels).not.toContain('删除')
    w.unmount()
  })

  it('protected root row is not draggable (draggable attribute reflects canMove)', async () => {
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

  it('zettel child rows are draggable for reclassification', async () => {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const zettelRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'zettel')!
    await zettelRow.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const permanentRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'permanent')!
    expect(permanentRow.attributes('draggable')).toBe('true')
    w.unmount()
  })
})

// Archive-to-zettel visibility. The action promotes a file directly from
// inbox/ or literature/ into zettel/ — distinct from the drag-and-drop
// "move into zettel" path that remains blocked. The menu button is gated
// by canArchive which mirrors canSplit's shape, so these cases pin that
// matrix.
describe('FileTree context menu — archive-to-zettel visibility', () => {
  beforeEach(() => {
    localStorage.clear()
    document.querySelectorAll('.tree-context-menu').forEach((el) => el.remove())
  })

  async function rightClickRow(label: string) {
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    // Expand the parent folders (inbox / literature / zettel / archive)
    // so their file rows render. The expansion click is on the chevron.
    for (const parent of ['inbox', 'literature', 'zettel', 'archive']) {
      const parentRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === parent)
      if (parentRow?.find('.chevron').exists()) {
        await parentRow.find('.chevron').trigger('click')
        await w.vm.$nextTick()
      }
    }
    const row = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === label)!
    expect(row.exists()).toBe(true)
    await row.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    await flushPromises()
    return w
  }

  it('shows 归档到 zettel for a file under inbox/', async () => {
    const w = await rightClickRow('hello')
    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).toContain('归档到 zettel')
    w.unmount()
  })

  it('shows 归档到 zettel for a file under literature/', async () => {
    const w = await rightClickRow('ahrens')
    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).toContain('归档到 zettel')
    w.unmount()
  })

  it('hides 归档到 zettel for a file inside zettel/', async () => {
    const w = await rightClickRow('permanent')
    // A zettel file can be dragged for reclassification, but it has no
    // context-menu action: no rename/delete and no archive-to-zettel.
    expect(document.querySelector('.tree-context-menu')).toBeNull()
    w.unmount()
  })

  it('hides 归档到 zettel for a file under a user-defined folder (not inbox/literature)', async () => {
    const w = await rightClickRow('old')
    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    expect(menu!.textContent).not.toContain('归档到 zettel')
    w.unmount()
  })

  it('hides 归档到 zettel when right-clicking a folder row', async () => {
    const w = await rightClickRow('inbox')
    const menu = document.querySelector('.tree-context-menu')
    expect(menu).not.toBeNull()
    // Folders see create-in / rename / delete, never the archive action.
    expect(menu!.textContent).not.toContain('归档到 zettel')
    w.unmount()
  })
})
