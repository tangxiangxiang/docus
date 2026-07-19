// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { dialogStubs, installDialogMocks, resetDialogMocks, rowByLabel } from '../../../__test-helpers__/dialogs'
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import * as api from '../../../lib/api'
import { useI18n } from '../../../composables/useI18n'

installDialogMocks()

const TREE: TreeNode[] = [
  {
    kind: 'folder', name: 'content', path: '', children: [
      {
        kind: 'folder', name: 'inbox', path: 'inbox', children: [
          {
            kind: 'folder', name: 'notes', path: 'inbox/notes', children: [
              { kind: 'file', name: 'old', path: 'inbox/notes/old', title: 'Old', mtime: 0 },
            ],
          },
        ],
      },
      { kind: 'folder', name: 'literature', path: 'literature', children: [] },
      { kind: 'folder', name: 'archive', path: 'archive', children: [] },
    ],
  },
]

async function clickMenuButton(label: string) {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.tree-context-menu button')]
    .find((b) => b.textContent?.includes(label))
  expect(btn).toBeDefined()
  btn!.click()
  await flushPromises()
}

describe('FileTree nested delete', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    localStorage.clear()
    vi.clearAllMocks()
    resetDialogMocks()
    document.querySelectorAll('.tree-context-menu').forEach((el) => el.remove())
  })

  it('deletes a third-level file as a file and shows the confirm dialog', async () => {
    const deleteSpy = vi.spyOn(api, 'deletePost').mockResolvedValue({ ok: true })
    const deleteFolderSpy = vi.spyOn(api, 'deleteFolder')

    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const notes = rowByLabel(w.findAll('li.tree-row'), 'notes')
    await notes.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const old = rowByLabel(w.findAll('li.tree-row'), 'old', 'file')
    await old.trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    await clickMenuButton('删除')

    expect(dialogStubs.confirm).toHaveBeenCalledWith(
      '删除“old”？如果存在本地未保存的恢复内容，也会被丢弃。',
    )
    expect(deleteFolderSpy).not.toHaveBeenCalled()
    expect(deleteSpy).toHaveBeenCalledWith('inbox/notes/old')
    expect(w.emitted('refresh')).toBeTruthy()
    w.unmount()
  })

  it('renames a third-level file as a file', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/notes/new',
      title: 'new',
      created: '',
      updated: '',
      tags: [],
      size: 0,
      mtime: 0,
    })
    const renameFolderSpy = vi.spyOn(api, 'renameFolder')

    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()

    const inbox = rowByLabel(w.findAll('li.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const notes = rowByLabel(w.findAll('li.tree-row'), 'notes')
    await notes.find('.chevron').trigger('click')
    await w.vm.$nextTick()

    const old = rowByLabel(w.findAll('li.tree-row'), 'old', 'file')
    dialogStubs.prompt.mockResolvedValueOnce('new')
    await old.trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    await clickMenuButton('重命名')
    await flushPromises()

    expect(renameFolderSpy).not.toHaveBeenCalled()
    expect(patchSpy).toHaveBeenCalledWith('inbox/notes/old', { name: 'new' })
    w.unmount()
  })
})
