// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HistoryUnchangedContent from '../HistoryUnchangedContent.vue'

describe('HistoryUnchangedContent', () => {
  it('renders the source once with line numbers and preserves blank lines', () => {
    const wrapper = mount(HistoryUnchangedContent, {
      props: {
        raw: '# Same document\n\nContent',
        comparisonKey: 'diff:notes\\0revision-a',
      },
    })

    expect(wrapper.findAll('.history-unchanged-line')).toHaveLength(3)
    expect(wrapper.findAll('.history-unchanged-line-number').map((node) => node.text())).toEqual(['1', '2', '3'])
    expect(wrapper.findAll('.history-unchanged-line-content').map((node) => node.text())).toEqual([
      '# Same document',
      '',
      'Content',
    ])
    expect(wrapper.get('.history-unchanged-content').attributes('tabindex')).toBe('0')
  })
})
