// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from "@vue/test-utils"
import { dialogStubs, installDialogMocks, resetDialogMocks, rowByLabel } from '../../../__test-helpers__/dialogs'
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import * as api from '../../../lib/api'

installDialogMocks()

const TREE: TreeNode[] = [
  {
    kind: 'folder', name: 'content', path: '', children: [
      {
        kind: 'folder', name: 'inbox', path: 'inbox', children: [
          { kind: 'file', name: 'draft', path: 'inbox/draft', title: 'Draft', mtime: 0 },
        ],
      },
      { kind: 'folder', name: 'literature', path: 'literature', children: [] },
      { kind: 'folder', name: 'zettel', path: 'zettel', children: [] },
    ],
  },
]

async function clickRenameMenuButton() {
  const btn = [...document.querySelectorAll<HTMLButtonElement>('.tree-context-menu button')]
    .find((b) => b.textContent?.includes('重命名'))
  expect(btn).toBeDefined()
  btn!.click()
  await flushPromises()
}



describe('FileTree prompt rename', () => {
  beforeEach(() => {
    localStorage.clear()
    resetDialogMocks()
    vi.restoreAllMocks()
  })

  it('renames through the shared prompt', async () => {
    // Simulate the round-trip so the move is observable without a server.
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/final', title: 'final', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })
    dialogStubs.prompt.mockResolvedValueOnce('final')

    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    await w.vm.$nextTick()

    // Expand inbox and open the rename input on the draft file.
    const inbox = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const draft = rowByLabel(w.findAll('.tree-row'), 'draft')
    await draft.trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    await flushPromises()
    await clickRenameMenuButton()
    await flushPromises()

    expect(dialogStubs.prompt).toHaveBeenCalledWith(expect.objectContaining({
      initial: 'draft',
      actionLabel: '✧',
      actionTitle: '翻译为英文路径名',
    }))
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).toHaveBeenCalledWith('inbox/draft', { name: 'final' })
  })

  it('canceling the prompt does not rename', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost')
    dialogStubs.prompt.mockResolvedValueOnce(null)
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    await w.vm.$nextTick()

    const inbox = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const draft = rowByLabel(w.findAll('.tree-row'), 'draft')
    await draft.trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    await flushPromises()
    await clickRenameMenuButton()
    await flushPromises()

    expect(patchSpy).not.toHaveBeenCalled()
  })
})
