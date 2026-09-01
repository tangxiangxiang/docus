// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BillsAssetOverviewCard from '../BillsAssetOverviewCard.vue'
import type { BillsAccount } from '../../../features/bills/mockData'

const accounts: BillsAccount[] = [
  { id: 'bank', name: '招商银行', kind: '储蓄卡 · 1234', balance: 38520, accent: '#3b82f6' },
  { id: 'alipay', name: '支付宝', kind: '数字钱包', balance: 12680.26, accent: '#14b8a6' },
  { id: 'wechat', name: '微信零钱', kind: '数字钱包', balance: 6581, accent: '#8b5cf6' },
  { id: 'cash', name: '现金', kind: '现金账户', balance: 2500, accent: '#f59e0b' },
]

describe('BillsAssetOverviewCard', () => {
  it('shows the complete displayed account set and its derived balance', () => {
    const wrapper = mount(BillsAssetOverviewCard, { props: { accounts } })

    expect(wrapper.get('h2').text()).toBe('资产概要')
    expect(wrapper.get('[data-testid="bills-account-count"]').text()).toBe('4')
    expect(wrapper.get('[data-testid="bills-asset-total-balance"]').text()).toContain('¥60,281.26')
    expect(wrapper.findAll('.bills-account-row')).toHaveLength(accounts.length)
    expect(wrapper.text()).toContain('招商银行')
    expect(wrapper.text()).toContain('¥38,520.00')
    expect(wrapper.text()).toContain('微信零钱')
  })

  it('keeps account rows static instead of exposing a fake selection interaction', () => {
    const wrapper = mount(BillsAssetOverviewCard, { props: { accounts } })

    expect(wrapper.findAll('.bills-account-row button')).toHaveLength(0)
    expect(wrapper.findAll('.bills-account-row [role="button"]')).toHaveLength(0)
    expect(wrapper.findAll('.bills-account-row[tabindex]')).toHaveLength(0)
    expect(wrapper.findAll('.bills-account-row[aria-label]')).toHaveLength(0)
  })
})
