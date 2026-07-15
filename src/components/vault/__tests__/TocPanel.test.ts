// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TocPanel from '../TocPanel.vue'
import { tocActiveId, tocHeadings, tocScrollTo } from '../../../composables/vault/useTocState'
import type { RightRailTab } from '../../../composables/vault/useVaultLayout'

const posts = [{
  path: 'inbox/english/subject', title: '英语-主语', created: '', updated: '',
  tags: [], size: 0, mtime: 0,
}]

function mountPanel(activeTab: RightRailTab = 'toc', historyReadOnly = false) {
  return mount(TocPanel, {
    props: { path: 'inbox/english/subject', posts, activeTab, historyReadOnly },
    global: {
      stubs: {
        LinksPanel: {
          emits: ['navigate'],
          template: '<button class="stub-link" @click="$emit(\'navigate\', \'archive/target\')">引用</button>',
        },
        AiPanel: { template: '<div class="stub-ai"><input value="draft"></div>' },
      },
    },
  })
}

describe('unified document sidebar', () => {
  beforeEach(() => {
    tocHeadings.value = [
      { id: 'definition', text: '基本定义', level: 2 },
      { id: 'example', text: '例句', level: 3 },
    ]
    tocActiveId.value = 'example'
    tocScrollTo.value = vi.fn()
  })

  it('renders TOC as the controlled default view', () => {
    const wrapper = mountPanel()
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('目录')
    expect(wrapper.find('.toc-panel-item.active').text()).toBe('例句')
  })

  it('renders tabs in AI → 目录 → 引用 order', () => {
    const wrapper = mountPanel()
    const labels = wrapper.findAll('[role="tab"]').map((tab) => tab.text())
    expect(labels).toEqual(['AI', '目录', '引用'])
  })

  it('emits update:activeTab with the matching key for each tab', async () => {
    const wrapper = mountPanel()
    const tabs = wrapper.findAll('[role="tab"]')
    await tabs[0].trigger('click')
    await tabs[1].trigger('click')
    await tabs[2].trigger('click')
    expect(wrapper.emitted('update:activeTab')).toEqual([['ai'], ['toc'], ['links']])
  })

  it('reflects the controlled activeTab via aria-selected and the .active class', async () => {
    const wrapper = mountPanel('toc')
    expect(wrapper.get('[role="tab"]:nth-of-type(2)').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[role="tab"]:nth-of-type(2)').classes()).toContain('active')

    await wrapper.setProps({ activeTab: 'ai' })
    expect(wrapper.get('[role="tab"]:nth-of-type(1)').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[role="tab"]:nth-of-type(1)').classes()).toContain('active')

    await wrapper.setProps({ activeTab: 'links' })
    expect(wrapper.get('[role="tab"]:nth-of-type(3)').attributes('aria-selected')).toBe('true')
    expect(wrapper.get('[role="tab"]:nth-of-type(3)').classes()).toContain('active')
  })

  it('keeps all three views mounted while showing only the active one', () => {
    const wrapper = mountPanel('ai')
    expect(wrapper.find('.toc-panel').exists()).toBe(true)
    expect(wrapper.find('.links-slot').exists()).toBe(true)
    expect(wrapper.find('.stub-ai').exists()).toBe(true)
    expect(wrapper.get('.ai-slot').isVisible()).toBe(true)
    expect(wrapper.get('.toc-panel').attributes('style')).toContain('display: none')
  })

  it('disables and unmounts AI editing for a read-only history snapshot', () => {
    const wrapper = mountPanel('toc', true)
    const aiTab = wrapper.findAll('[role="tab"]')[0]!

    expect(aiTab.attributes('disabled')).toBeDefined()
    expect(aiTab.attributes('aria-disabled')).toBe('true')
    expect(wrapper.find('.stub-ai').exists()).toBe(false)
  })

  it('navigates headings and forwards link navigation', async () => {
    const wrapper = mountPanel()
    await wrapper.find('a[href="#definition"]').trigger('click')
    expect(tocScrollTo.value).toHaveBeenCalledWith('definition')
    await wrapper.setProps({ activeTab: 'links' })
    await wrapper.find('.stub-link').trigger('click')
    expect(wrapper.emitted('link-navigate')).toEqual([['archive/target']])
  })

  it('renders empty TOC without affecting the other tabs', () => {
    tocHeadings.value = []
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('暂无目录')
    expect(wrapper.find('.links-slot').exists()).toBe(true)
    expect(wrapper.find('.ai-slot').exists()).toBe(true)
  })
})
