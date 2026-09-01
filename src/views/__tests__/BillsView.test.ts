// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import BillsView from '../BillsView.vue'

describe('Bills dashboard', () => {
  it('renders the dashboard sections from local mock data', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/bills', name: 'bills', component: BillsView },
        { path: '/bills/transactions', name: 'bills-transactions', component: { template: '<div />' } },
      ],
    })
    await router.push('/bills')
    await router.isReady()

    const wrapper = mount(BillsView, { global: { plugins: [router] } })

    expect(wrapper.find('[data-testid="bills-page"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="bills-summary-hero"]').text()).toContain('本月支出')
    expect(wrapper.get('[data-testid="bills-asset-overview"]').text()).toContain('净资产')
    expect(wrapper.findAll('[data-testid^="bills-period-"]')).toHaveLength(4)
    expect(wrapper.get('[data-testid="bills-trend-card"]').text()).toContain('收入与支出趋势')
    expect(wrapper.get('[data-testid="bills-recent-transactions"]').text()).toContain('星巴克咖啡')
  })
})
