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
          { kind: 'file', name: 'draft', path: 'inbox/draft', title: 'Draft', mtime: 0 },
        ],
      },
      { kind: 'folder', name: 'literature', path: 'literature', children: [] },
      { kind: 'folder', name: 'zettel', path: 'zettel', children: [] },
    ],
  },
]



describe('FileTree inline rename (Enter + blur double-fire)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('committing a rename via Enter does NOT double-emit when the input is removed (the actual cause of "rename succeeded, toast says failed")', async () => {
    // Simulate the round-trip so the move is observable without a server.
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'inbox/final', title: 'final', date: '', tags: [], size: 0, mtime: 0,
    })

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
    // The context menu has a "重命名" button.
    document.querySelector<HTMLButtonElement>('.tree-context-menu button:not(.danger)')!.click()
    await w.vm.$nextTick()

    const input = w.find('input.rename-input')
    expect(input.exists()).toBe(true)
    await input.setValue('final')

    // The user presses Enter. Vue Test Utils' keydown trigger dispatches the
    // event synchronously, but the resulting DOM removal happens on the next
    // tick — which is when the input's blur event fires (the "second
    // commitRename" that previously caused the bug).
    await input.trigger('keydown.enter')
    await w.vm.$nextTick()
    await input.trigger('blur')
    await w.vm.$nextTick()
    await flushPromises()

    // patchPost must be called exactly once, with the new name. The second
    // call (from blur-after-Enter) used to fire with oldPath, hit a 404 on
    // disk, and surface as a "rename failed" toast — even though the rename
    // had already succeeded. The fix short-circuits the second call.
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).toHaveBeenCalledWith('inbox/draft', { name: 'final' })
  })

  it('pressing Escape cancels (does not commit) a rename', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost')
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    await w.vm.$nextTick()

    const inbox = rowByLabel(w.findAll('.tree-row'), 'inbox')
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const draft = rowByLabel(w.findAll('.tree-row'), 'draft')
    await draft.trigger('contextmenu', { clientX: 10, clientY: 10 })
    await w.vm.$nextTick()
    await flushPromises()
    document.querySelector<HTMLButtonElement>('.tree-context-menu button:not(.danger)')!.click()
    await w.vm.$nextTick()

    const input = w.find('input.rename-input')
    await input.setValue('something-else')
    await input.trigger('keydown.escape')
    await w.vm.$nextTick()
    // Same unmount-triggers-blur hazard: blur would normally call
    // commitRename and emit a rename despite the user pressing Escape.
    await input.trigger('blur')
    await w.vm.$nextTick()
    await flushPromises()

    expect(patchSpy).not.toHaveBeenCalled()
  })
})
