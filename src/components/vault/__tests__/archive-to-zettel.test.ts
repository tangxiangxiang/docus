// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from "@vue/test-utils"
import FileTree from '../FileTree.vue'
import type { TreeNode } from '../../../lib/api'
import * as api from '../../../lib/api'
import { installDialogMocks, resetDialogMocks } from '../../../__test-helpers__/dialogs'

installDialogMocks()

// Per-test toast spies. We can't rely on dialogStubs.toast — its
// vi.mock factory targets a specific module path, and the install-time
// helper doesn't actually intercept the live useToast() the way some
// other suites assume. No existing test in this folder asserts on
// toast.success/error (verified by grep), so we set up a local spy here
// that this file fully controls.
const toastSpy = {
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}

vi.mock('../../../composables/useToast', () => ({
  useToast: () => toastSpy,
}))

const TREE: TreeNode[] = [
  {
    kind: 'folder', name: 'content', path: '', children: [
      {
        kind: 'folder', name: 'inbox', path: 'inbox', children: [
          { kind: 'file', name: 'foo', path: 'inbox/foo', title: 'Foo', mtime: 0 },
        ],
      },
      { kind: 'folder', name: 'literature', path: 'literature', children: [] },
      { kind: 'folder', name: 'zettel', path: 'zettel', children: [] },
    ],
  },
]

describe('FileTree archive-to-zettel', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    resetDialogMocks()
    toastSpy.info.mockClear()
    toastSpy.success.mockClear()
    toastSpy.error.mockClear()
    document.querySelectorAll('.tree-context-menu').forEach((el) => el.remove())
  })

  it('moves an inbox file to zettel/<name> via patchPost and toasts success', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo', title: 'foo', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })

    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const vm = w.vm as any
    await vm.onArchiveToZettel('inbox/foo')
    await flushPromises()

    expect(patchSpy).toHaveBeenCalledWith('inbox/foo', { targetPath: 'zettel/foo' })
    expect(toastSpy.success).toHaveBeenCalledWith('已归档到 zettel')
    expect(w.emitted('refresh')).toBeTruthy()
    // currentPath is null in this case, so no select emit.
    expect(w.emitted('select')).toBeFalsy()
    w.unmount()
  })

  it('emits select(targetPath) when currentPath equals the archived file', async () => {
    vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo', title: 'foo', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })

    const w = mount(FileTree, { props: { tree: TREE, currentPath: 'inbox/foo' } })
    const vm = w.vm as any
    await vm.onArchiveToZettel('inbox/foo')
    await flushPromises()

    expect(w.emitted('refresh')).toBeTruthy()
    expect(w.emitted('select')!.at(-1)).toEqual(['zettel/foo'])
    w.unmount()
  })

  it('does not emit select when currentPath differs from the archived file', async () => {
    vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo', title: 'foo', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })

    const w = mount(FileTree, { props: { tree: TREE, currentPath: 'inbox/other' } })
    const vm = w.vm as any
    await vm.onArchiveToZettel('inbox/foo')
    await flushPromises()

    expect(w.emitted('refresh')).toBeTruthy()
    expect(w.emitted('select')).toBeFalsy()
    w.unmount()
  })

  it('surfaces a failed archive as a toast.error', async () => {
    vi.spyOn(api, 'patchPost').mockRejectedValue(new Error('boom'))

    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const vm = w.vm as any
    await vm.onArchiveToZettel('inbox/foo')
    await flushPromises()

    expect(toastSpy.error).toHaveBeenCalledWith('归档失败: boom')
    expect(toastSpy.success).not.toHaveBeenCalled()
    w.unmount()
  })

  it('does not call patchPost when the source path is already in zettel (defensive)', async () => {
    // Belt-and-suspenders: TreeRow's canArchive gate already prevents the
    // menu from rendering for zettel/* files, so onArchiveToZettel should
    // never be invoked with such a path in practice. If something ever
    // bypasses the gate, the handler must still short-circuit rather
    // than round-trip to PATCH with targetPath === src.
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo', title: 'foo', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })
    const w = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    const vm = w.vm as any
    await vm.onArchiveToZettel('zettel/foo')

    expect(patchSpy).not.toHaveBeenCalled()
    expect(toastSpy.success).not.toHaveBeenCalled()
    w.unmount()
  })

  it('drives the menu click end-to-end and lands on patchPost', async () => {
    // Verifies the TreeRow menu wiring: right-click → 归档到 zettel button
    // → emit('archive-to-zettel') → FileTree handler → patchPost. Done
    // through the DOM (Teleport + real click) so a future Vue version
    // or template refactor that breaks the @click binding will fail here
    // rather than in the unit-only tests above.
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo', title: 'foo', created: '', updated: '', tags: [], size: 0, mtime: 0,
    })

    const w = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await w.vm.$nextTick()
    const inbox = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'inbox')!
    await inbox.find('.chevron').trigger('click')
    await w.vm.$nextTick()
    const fooRow = w.findAll('li.tree-row').find((r: any) => r.find('.row-name')?.text() === 'foo')!
    await fooRow.trigger('contextmenu', { clientX: 100, clientY: 100 })
    await w.vm.$nextTick()
    await flushPromises()

    const menu = document.querySelector('.tree-context-menu')!
    expect(menu).not.toBeNull()
    const buttons = [...menu.querySelectorAll('button')]
    const archive = buttons.find((b) => b.textContent?.includes('归档到 zettel'))
    expect(archive).toBeDefined()
    archive!.click()
    await flushPromises()

    expect(patchSpy).toHaveBeenCalledWith('inbox/foo', { targetPath: 'zettel/foo' })
    expect(toastSpy.success).toHaveBeenCalledWith('已归档到 zettel')
    w.unmount()
  })
})