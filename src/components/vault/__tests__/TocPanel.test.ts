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

function mountPanel(activeTab: RightRailTab = 'toc') {
  return mount(TocPanel, {
    props: { path: 'inbox/english/subject', posts, activeTab },
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

  it('emits tab changes for links and AI', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await wrapper.findAll('[role="tab"]')[2].trigger('click')
    expect(wrapper.emitted('update:activeTab')).toEqual([['links'], ['ai']])
  })

  it('keeps all three views mounted while showing only the active one', () => {
    const wrapper = mountPanel('ai')
    expect(wrapper.find('.toc-panel').exists()).toBe(true)
    expect(wrapper.find('.links-slot').exists()).toBe(true)
    expect(wrapper.find('.stub-ai').exists()).toBe(true)
    expect(wrapper.get('.ai-slot').isVisible()).toBe(true)
    expect(wrapper.get('.toc-panel').attributes('style')).toContain('display: none')
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
