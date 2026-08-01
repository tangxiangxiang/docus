// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HistoryUnifiedDiff from '../HistoryUnifiedDiff.vue'
import type { DiffOp, FileDiff } from '../../../lib/history-api'

function equal(line: number, text = `line ${line}`): DiffOp {
  return { op: 'equal', oldLine: line, newLine: line, text }
}

function diff(ops: DiffOp[]): FileDiff {
  return {
    ops,
    stats: {
      added: ops.filter((op) => op.op === 'add').length,
      removed: ops.filter((op) => op.op === 'remove').length,
      equal: ops.filter((op) => op.op === 'equal').length,
    },
  }
}

describe('HistoryUnifiedDiff', () => {
  it('renders semantic unified rows with real old and new gutters', () => {
    const wrapper = mount(HistoryUnifiedDiff, {
      props: {
        comparisonKey: 'a',
        diff: diff([
          equal(8, 'same'),
          { op: 'remove', oldLine: 9, newLine: null, text: 'old' },
          { op: 'add', oldLine: null, newLine: 9, text: 'new' },
        ]),
      },
    })
    const rows = wrapper.findAll('.unified-diff-line')

    expect(rows.map((row) => row.classes().find((name) => name.startsWith('is-')))).toEqual([
      'is-equal', 'is-remove', 'is-add',
    ])
    expect(rows[0]!.get('.unified-diff-old').attributes('data-line')).toBe('8')
    expect(rows[0]!.get('.unified-diff-new').attributes('data-line')).toBe('8')
    expect(rows[1]!.get('.unified-diff-old').attributes('data-line')).toBe('9')
    expect(rows[1]!.get('.unified-diff-new').attributes('data-line')).toBe('')
    expect(rows[2]!.get('.unified-diff-old').attributes('data-line')).toBe('')
    expect(rows[2]!.get('.unified-diff-new').attributes('data-line')).toBe('9')
    expect(rows[1]!.get('.unified-diff-marker').attributes('data-marker')).toBe('−')
    expect(rows[2]!.get('.unified-diff-marker').attributes('data-marker')).toBe('+')
  })

  it('keeps decorative gutters out of selectable text content', () => {
    const wrapper = mount(HistoryUnifiedDiff, {
      props: { comparisonKey: 'a', diff: diff([equal(42, 'document content')]) },
    })
    const row = wrapper.get('.unified-diff-line')
    expect(row.text()).toBe('document content')
    expect(row.findAll('.unified-diff-gutter').every((gutter) => gutter.attributes('aria-hidden') === 'true')).toBe(true)
  })

  it('preserves whitespace, Markdown punctuation, and word-level emphasis', () => {
    const removedWords: DiffOp[] = [
      { op: 'remove', oldLine: 1, newLine: null, text: '  **is_a**' },
      { op: 'equal', oldLine: 1, newLine: null, text: ': Type  ' },
    ]
    const addedWords: DiffOp[] = [
      { op: 'add', oldLine: null, newLine: 1, text: '  **type**' },
      { op: 'equal', oldLine: null, newLine: 1, text: ': Type  ' },
    ]
    const wrapper = mount(HistoryUnifiedDiff, {
      props: {
        comparisonKey: 'a',
        diff: diff([
          { op: 'remove', oldLine: 1, newLine: null, text: '  **is_a**: Type  ', words: removedWords },
          { op: 'add', oldLine: null, newLine: 1, text: '  **type**: Type  ', words: addedWords },
        ]),
      },
    })

    expect(wrapper.findAll('.unified-diff-content').map((row) => row.element.textContent)).toEqual([
      '  **is_a**: Type  ',
      '  **type**: Type  ',
    ])
    expect(wrapper.findAll('.unified-diff-word-remove')).toHaveLength(1)
    expect(wrapper.findAll('.unified-diff-word-add')).toHaveLength(1)
  })

  it('expands hunks by click, Enter, and Space', async () => {
    const ops = Array.from({ length: 20 }, (_, index) => equal(index + 1))
    ops[0] = { op: 'remove', oldLine: 1, newLine: null, text: 'old' }
    ops[19] = { op: 'add', oldLine: null, newLine: 20, text: 'new' }
    const wrapper = mount(HistoryUnifiedDiff, { props: { comparisonKey: 'a', diff: diff(ops) } })
    const hunk = wrapper.get('.unified-diff-hunk')
    expect(hunk.attributes('aria-expanded')).toBe('false')
    expect(hunk.text()).toContain('Show 12 unchanged lines')

    await hunk.trigger('click')
    expect(wrapper.findAll('.unified-diff-line')).toHaveLength(20)
    expect(hunk.attributes('aria-expanded')).toBe('true')
    await hunk.trigger('keydown', { key: 'Enter' })
    expect(wrapper.findAll('.unified-diff-line')).toHaveLength(8)
    await hunk.trigger('keydown', { key: ' ' })
    expect(wrapper.findAll('.unified-diff-line')).toHaveLength(20)
  })

  it('expands multiple hunks independently and resets them for another comparison', async () => {
    const ops = Array.from({ length: 50 }, (_, index) => equal(index + 1))
    ops[2] = { op: 'remove', oldLine: 3, newLine: null, text: 'A' }
    ops[24] = { op: 'add', oldLine: null, newLine: 25, text: 'B' }
    ops[47] = { op: 'remove', oldLine: 48, newLine: null, text: 'C' }
    const wrapper = mount(HistoryUnifiedDiff, { props: { comparisonKey: 'a', diff: diff(ops) } })
    const hunks = wrapper.findAll('.unified-diff-hunk')
    expect(hunks).toHaveLength(2)

    await hunks[0]!.trigger('click')
    await hunks[1]!.trigger('click')
    expect(wrapper.findAll('.unified-diff-hunk[aria-expanded="true"]')).toHaveLength(2)
    await wrapper.setProps({ comparisonKey: 'b' })
    expect(wrapper.findAll('.unified-diff-hunk[aria-expanded="true"]')).toHaveLength(0)
  })

  it('uses one focusable vertical scroll surface and no split panes', () => {
    const wrapper = mount(HistoryUnifiedDiff, {
      props: { comparisonKey: 'a', diff: diff([equal(1, 'A very long Markdown paragraph')]) },
    })
    expect(wrapper.findAll('.unified-diff-scroll')).toHaveLength(1)
    expect(wrapper.get('.unified-diff-scroll').attributes('tabindex')).toBe('0')
    expect(wrapper.find('.diff-pane').exists()).toBe(false)
    expect(wrapper.find('.diff-table').exists()).toBe(false)
    expect(wrapper.get('.unified-diff-content').classes()).toContain('unified-diff-content')
  })
})
