// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BillsPeriodCard from '../BillsPeriodCard.vue'
import type { BillsPeriodSummary } from '../../../features/bills/mockData'

const period: BillsPeriodSummary = {
  id: 'month',
  title: '本月',
  dateLabel: '8月1日 – 28日',
  income: 21800,
  expense: 12486.2,
  icon: 'month',
  tone: 'amber',
}

describe('BillsPeriodCard', () => {
  it('keeps income before expense and renders a two-colour progress bar', () => {
    const wrapper = mount(BillsPeriodCard, { props: { period } })
    const values = wrapper.find('.bills-period-values')

    expect(values.text().indexOf('收入')).toBeLessThan(values.text().indexOf('支出'))
    expect(values.text().indexOf('¥21,800.00')).toBeLessThan(values.text().indexOf('¥12,486.20'))
    expect(wrapper.findAll('.bills-period-progress > span')).toHaveLength(2)
    expect(wrapper.classes()).not.toContain('is-over-budget')
  })

  it('marks an expense-heavy period with the warning accent', () => {
    const wrapper = mount(BillsPeriodCard, {
      props: { period: { ...period, income: 100, expense: 200 } },
    })

    expect(wrapper.classes()).toContain('is-over-budget')
  })
})
