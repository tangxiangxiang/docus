// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BillsAssetOverviewCard from '../BillsAssetOverviewCard.vue'
import type { BillsAccount } from '../../../features/bills/mockData'
import { aggregateAssetSummary } from '../../../features/bills/aggregations'

const accounts: BillsAccount[] = [
  { id: 'bank', name: '招商银行', kind: '储蓄卡 · 1234', balance: 38520, accent: '#3b82f6' },
  { id: 'alipay', name: '支付宝', kind: '数字钱包', balance: 12680.26, accent: '#14b8a6' },
  { id: 'wechat', name: '微信零钱', kind: '数字钱包', balance: 6581, accent: '#8b5cf6' },
  { id: 'cash', name: '现金', kind: '现金账户', balance: 2500, accent: '#f59e0b' },
]

describe('BillsAssetOverviewCard', () => {
  it('shows the restored total assets, liabilities, and net assets metrics', () => {
    const wrapper = mount(BillsAssetOverviewCard, {
      props: { summary: aggregateAssetSummary(accounts, 32800), accounts },
    })

    expect(wrapper.get('h2').text()).toBe('资产概要')
    expect(wrapper.get('[data-testid="bills-account-count"]').text()).toBe('4')
    const totals = wrapper.get('[data-testid="bills-asset-totals"]')
    expect(totals.text()).toContain('总资产')
    expect(totals.text()).toContain('¥60,281.26')
    expect(totals.text()).toContain('总负债')
    expect(totals.text()).toContain('¥32,800.00')
    expect(totals.text()).toContain('净资产')
    expect(totals.text()).toContain('¥27,481.26')
    expect(wrapper.findAll('.bills-account-row')).toHaveLength(accounts.length)
    expect(wrapper.text()).toContain('招商银行')
    expect(wrapper.text()).toContain('¥38,520.00')
    expect(wrapper.text()).toContain('微信零钱')
  })

  it('keeps account rows static instead of exposing a fake selection interaction', () => {
    const wrapper = mount(BillsAssetOverviewCard, {
      props: { summary: aggregateAssetSummary(accounts, 32800), accounts },
    })

    expect(wrapper.findAll('.bills-account-row button')).toHaveLength(0)
    expect(wrapper.findAll('.bills-account-row [role="button"]')).toHaveLength(0)
    expect(wrapper.findAll('.bills-account-row[tabindex]')).toHaveLength(0)
    expect(wrapper.findAll('.bills-account-row[aria-label]')).toHaveLength(0)
  })
})
