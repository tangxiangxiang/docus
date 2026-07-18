// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import FileTree from '../FileTree.vue'
import type { PostSummary, TreeNode } from '../../../lib/api'
import { installDialogMocks } from '../../../__test-helpers__/dialogs'
import { useI18n } from '../../../composables/useI18n'

installDialogMocks()

beforeEach(() => {
  localStorage.clear()
  useI18n().setLocale('zh')
})

afterEach(() => {
  useI18n().setLocale('zh')
})

const TREE: TreeNode[] = [{
  kind: 'folder', name: 'content', path: '', children: [
    {
      kind: 'folder', name: 'inbox', path: 'inbox', children: [
        { kind: 'file', name: 'redis-note', path: 'inbox/backend/redis-note', title: 'Cache design', mtime: 0 },
        { kind: 'file', name: 'draft', path: 'inbox/draft', title: 'Release checklist', mtime: 0 },
      ],
    },
    {
      kind: 'folder', name: 'archive', path: 'archive', children: [
        { kind: 'file', name: 'history', path: 'archive/history', title: 'Old decisions', mtime: 0 },
      ],
    },
    {
      kind: 'folder', name: 'literature', path: 'literature', children: [
        { kind: 'file', name: 'cache-paper', path: 'literature/cache-paper', title: 'Redis internals', mtime: 0 },
      ],
    },
  ],
}]

const POSTS: PostSummary[] = [
  { path: 'inbox/draft', title: 'Release checklist', tags: ['redis'], summary: 'secret body phrase', created: '', updated: '', size: 0, mtime: 0 },
]

function rowByName(wrapper: any, name: string): any {
  return wrapper.findAll('.tree-row').find((row: any) =>
    row.find('.row-name-text')?.text() === name || row.find('.row-name')?.text() === name,
  )
}

describe('FileTree', () => {
  it('reveals a path by expanding ancestors and focusing without selecting', async () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const wrapper = mount(FileTree, {
      props: { tree: TREE, currentPath: null },
      attachTo: document.body,
    })
    expect(await wrapper.vm.revealPath('inbox/backend/redis-note')).toBe(true)
    expect(JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]'))
      .toEqual(expect.arrayContaining(['inbox', 'inbox/backend']))
    expect(document.activeElement?.getAttribute('data-tree-key')).toBe('file:inbox/backend/redis-note')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(await wrapper.vm.revealPath('missing')).toBe(false)
    wrapper.unmount()
  })

  it('renders top-level folders and expands a folder from its row', async () => {
    const wrapper = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    expect(wrapper.text()).toContain('inbox')
    expect(wrapper.text()).toContain('archive')
    expect(wrapper.text()).not.toContain('redis-note')
    await rowByName(wrapper, 'inbox').find('.row-line').trigger('click')
    expect(wrapper.text()).toContain('redis-note')
  })

  it('focuses the filter with Ctrl/Cmd+F while the tree is focused', async () => {
    const wrapper = mount(FileTree, { props: { tree: TREE, currentPath: null }, attachTo: document.body })
    await rowByName(wrapper, 'inbox').trigger('keydown', { key: 'f', ctrlKey: true })
    expect(document.activeElement).toBe(wrapper.find('.search-input').element)
    wrapper.unmount()
  })

  it('persists deliberate expansion separately from filter expansion', async () => {
    const wrapper = mount(FileTree, { props: { tree: TREE, currentPath: null } })
    await rowByName(wrapper, 'inbox').find('.chevron').trigger('click')
    expect(JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')).toContain('inbox')
  })
})

describe('Files filter', () => {
  function mountTree() {
    return mount(FileTree, { props: { tree: TREE, posts: POSTS, currentPath: null } })
  }

  it('matches title, filename, and directory path without case sensitivity', async () => {
    const wrapper = mountTree()
    await wrapper.find('.search-input').setValue('CHECKLIST')
    expect(wrapper.text()).toContain('draft')

    await wrapper.find('.search-input').setValue('redis-note')
    expect(wrapper.text()).toContain('redis-note')

    await wrapper.find('.search-input').setValue('backend')
    expect(wrapper.text()).toContain('redis-note')
  })

  it('AND-composes multiple tokens across fields', async () => {
    const wrapper = mountTree()
    await wrapper.find('.search-input').setValue('redis cache')
    expect(wrapper.text()).toContain('redis-note')
    expect(wrapper.text()).toContain('cache-paper')

    await wrapper.find('.search-input').setValue('redis checklist')
    expect(wrapper.text()).not.toContain('draft')
    expect(wrapper.text()).not.toContain('redis-note')
    expect(wrapper.text()).not.toContain('cache-paper')
  })

  it('does not match summary or tags', async () => {
    const wrapper = mountTree()
    await wrapper.find('.search-input').setValue('secret body phrase')
    expect(wrapper.text()).not.toContain('draft')
    await wrapper.find('.search-input').setValue('redis')
    expect(wrapper.text()).not.toContain('draft')
  })

  it('keeps the complete subtree when a folder matches', async () => {
    const wrapper = mountTree()
    await wrapper.find('.search-input').setValue('archive')
    expect(wrapper.text()).toContain('history')
  })

  it('keeps matching ancestors visible and auto-expands them without persisting', async () => {
    const wrapper = mountTree()
    await wrapper.find('.search-input').setValue('redis-note')
    expect(wrapper.text()).toContain('inbox')
    expect(wrapper.text()).toContain('redis-note')
    expect(JSON.parse(localStorage.getItem('docus.vault.expandedPaths') ?? '[]')).not.toContain('inbox')
  })

  it('clears with Escape and the clear button', async () => {
    const wrapper = mountTree()
    const input = wrapper.find('.search-input')
    await input.setValue('redis')
    await input.trigger('keydown', { key: 'Escape' })
    expect((input.element as HTMLInputElement).value).toBe('')

    await input.setValue('redis')
    await wrapper.find('.search-clear-x').trigger('click')
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('preserves the filter when FileTree is unmounted during a view switch', async () => {
    const Harness = defineComponent({
      components: { FileTree },
      setup() {
        return { activePanel: ref<'files' | 'tags'>('files'), filesFilter: ref(''), tree: TREE }
      },
      template: `
        <button class="show-files" @click="activePanel = 'files'">Files</button>
        <button class="show-tags" @click="activePanel = 'tags'">Tags</button>
        <FileTree
          v-if="activePanel === 'files'"
          v-model:filter="filesFilter"
          :tree="tree"
          :current-path="null"
        />
        <div v-else class="tags-panel">Tags</div>
      `,
    })
    const wrapper = mount(Harness)
    await wrapper.find('.search-input').setValue('redis')
    await wrapper.find('.show-tags').trigger('click')
    expect(wrapper.find('.search-input').exists()).toBe(false)
    await wrapper.find('.show-files').trigger('click')
    expect((wrapper.find('.search-input').element as HTMLInputElement).value).toBe('redis')
  })

  it('reports one prioritized match field per token', async () => {
    const wrapper = mountTree()

    await wrapper.find('.search-input').setValue('cache')
    expect(rowByName(wrapper, 'redis-note').find('.row-name').attributes('title')).toContain('标题')
    expect(rowByName(wrapper, 'redis-note').find('.row-name').attributes('title')).not.toContain('文件名')

    await wrapper.find('.search-input').setValue('redis-note')
    expect(rowByName(wrapper, 'redis-note').find('.row-name').attributes('title')).toContain('文件名')
    expect(rowByName(wrapper, 'redis-note').find('.row-name').attributes('title')).not.toContain('路径')

    await wrapper.find('.search-input').setValue('backend')
    expect(rowByName(wrapper, 'redis-note').find('.row-name').attributes('title')).toContain('路径')
  })
})
