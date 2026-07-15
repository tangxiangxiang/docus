// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CommandPalette from '../CommandPalette.vue'
import { dispose } from '../../../lib/search'
import type { PostSummary } from '../../../lib/api'

const post: PostSummary = { path: 'inbox/redis', title: 'Redis', created: '', updated: '', tags: [], summary: '', size: 0, mtime: 1 }

describe('CommandPalette Chinese copy', () => {
  beforeEach(() => { dispose(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ content: '' }) }))) })
  afterEach(() => { vi.unstubAllGlobals(); dispose(); document.body.innerHTML = '' })

  it('uses a dynamic Chinese placeholder and accessibility labels', async () => {
    const wrapper = mount(CommandPalette, { props: { posts: [post], activePath: null } })
    ;(wrapper.vm as unknown as { show: () => void }).show()
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.palette-input')!
    expect(input.placeholder).toBe('搜索 1 篇文档…')
    expect(input.getAttribute('aria-label')).toBe('搜索全部内容')
    expect(document.body.querySelector('.palette')?.getAttribute('aria-label')).toBe('全局搜索')
    wrapper.unmount()
  })

  it('shows Chinese empty, new-document, navigation, and badge copy', async () => {
    const wrapper = mount(CommandPalette, { props: { posts: [post], activePath: null } })
    ;(wrapper.vm as unknown as { show: () => void }).show()
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('.palette-input')!
    input.value = '不存在'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('没有匹配结果')
    expect(document.body.textContent).toContain('新建“不存在”')
    expect(document.body.textContent).toContain('↑↓ 切换')
    expect(document.body.textContent).toContain('↵ 打开')
    expect(document.body.textContent).toContain('Esc 关闭')

    input.value = 'Redis'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('.palette-section-title')?.textContent).toBe('文件')
    expect(document.body.querySelector('.palette-badge')?.textContent).toBe('标题')
    wrapper.unmount()
  })
})
