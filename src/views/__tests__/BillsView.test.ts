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
    expect(wrapper.find('.bills-page-header').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bills-summary-hero"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bills-asset-overview"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="bills-account-count"]').text()).toBe('7')
    expect(wrapper.findAll('[data-account-type="liability"]')).toHaveLength(3)
    expect(wrapper.get('[data-testid="bills-asset-totals"]').text()).toContain('总负债')
    expect(wrapper.find('[data-testid="bills-category-breakdown"]').exists()).toBe(true)
    expect(wrapper.get('.bills-top-grid').element.firstElementChild?.querySelector('[data-testid="bills-asset-overview"]')).not.toBeNull()
    expect(wrapper.get('.bills-top-grid').element.lastElementChild?.getAttribute('data-testid')).toBe('bills-category-breakdown')
    expect(wrapper.findAll('[data-testid^="bills-period-"]')).toHaveLength(4)
    expect(wrapper.findAll('.bills-period-menu')).toHaveLength(0)
    expect(wrapper.get('[data-testid="bills-trend-card"]').text()).toContain('收支趋势')
    expect(wrapper.get('[data-testid="bills-recent-transactions"]').text()).toContain('星巴克咖啡')
    expect(wrapper.find('.bills-tabs').exists()).toBe(false)
    expect(wrapper.find('.bills-secondary-button').exists()).toBe(false)
    expect(wrapper.find('.bills-mock-note').exists()).toBe(false)
  })
})
