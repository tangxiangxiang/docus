// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BillsCategoryBreakdownCard from '../BillsCategoryBreakdownCard.vue'
import type { BillsCategoryBreakdown, BillsLedgerScope } from '../../../features/bills/mockData'

const breakdowns: Record<BillsLedgerScope, BillsCategoryBreakdown> = {
  all: {
    income: [{ id: 'salary', label: '工资', amount: 17876, color: '#0f9d8e' }, { id: 'other-income', label: '其他', amount: 3924, color: '#bfe9e3' }],
    expense: [{ id: 'living', label: '生活', amount: 5743.65, color: '#7c5ce6' }, { id: 'transport', label: '交通', amount: 3870.72, color: '#c3b6ed' }, { id: 'other-expense', label: '其他', amount: 2871.83, color: '#e3def5' }],
  },
  year: {
    income: [{ id: 'salary', label: '工资', amount: 138088, color: '#0f9d8e' }, { id: 'other-income', label: '其他', amount: 30312, color: '#bfe9e3' }],
    expense: [{ id: 'living', label: '生活', amount: 38773.68, color: '#7c5ce6' }, { id: 'transport', label: '交通', amount: 26130.09, color: '#c3b6ed' }, { id: 'other-expense', label: '其他', amount: 19386.83, color: '#e3def5' }],
  },
  month: {
    income: [{ id: 'salary', label: '工资', amount: 17876, color: '#0f9d8e' }, { id: 'other-income', label: '其他', amount: 3924, color: '#bfe9e3' }],
    expense: [{ id: 'living', label: '生活', amount: 5743.65, color: '#7c5ce6' }, { id: 'transport', label: '交通', amount: 3870.72, color: '#c3b6ed' }, { id: 'other-expense', label: '其他', amount: 2871.83, color: '#e3def5' }],
  },
}

describe('BillsCategoryBreakdownCard', () => {
  it('renders both category donuts and mathematically consistent totals', () => {
    const wrapper = mount(BillsCategoryBreakdownCard, { props: { breakdowns } })

    expect(wrapper.get('h2').text()).toBe('收支占比')
    expect(wrapper.findAll('.bills-donut')).toHaveLength(2)
    expect(wrapper.text()).toContain('工资 82%')
    expect(wrapper.text()).toContain('生活 46%')
    expect(wrapper.text()).toContain('¥21,800.00')
    expect(wrapper.text()).toContain('¥12,486.20')
    expect(wrapper.text()).toContain('¥9,313.80')
    expect(wrapper.find('select').element.value).toBe('all')
  })

  it('uses the selected ledger data source for totals and percentages', async () => {
    const wrapper = mount(BillsCategoryBreakdownCard, { props: { breakdowns } })
    await wrapper.get('select').setValue('year')

    expect(wrapper.text()).toContain('¥168,400.00')
    expect(wrapper.text()).toContain('¥84,290.60')
    expect(wrapper.text()).toContain('¥84,109.40')
    expect(wrapper.text()).toContain('工资 82%')
  })
})
