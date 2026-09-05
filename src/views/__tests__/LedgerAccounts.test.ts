// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LedgerAccountDto,
  LedgerOverviewDto,
  LedgerSettingsDto,
} from '../../../shared/ledgerProtocol'
import { resetLedgerStoreForTesting } from '../../features/ledger/ledgerStore'
import LedgerAccountsView from '../LedgerAccountsView.vue'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
  createLedgerAccount: vi.fn(),
  restoreLedgerAccount: vi.fn(),
}))

vi.mock('../../features/ledger/api', () => api)

const settings: LedgerSettingsDto = {
  baseCurrency: 'CNY',
  currencyExponent: 2,
  timezone: 'Asia/Shanghai',
  hasCreatedAccount: true,
  version: 2,
  createdAt: 1,
  updatedAt: 2,
}

function account(id: string, archivedAt: number | null = null): LedgerAccountDto {
  return {
    id,
    name: id,
    type: 'bank',
    nature: 'asset',
    openingBalanceMinor: 100_000,
    openingDate: '2026-01-01',
    currency: 'CNY',
    currencyExponent: 2,
    note: '',
    archivedAt,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    currentBalanceMinor: 100_000,
  }
}

const overview = (): LedgerOverviewDto => ({
  context: { anchorDate: '2026-09-05', todayDate: '2026-09-05', isToday: true, scope: 'month' },
  currency: 'CNY',
  currencyExponent: 2,
  assetTotalMinor: 100_000,
  liabilityTotalMinor: 0,
  netWorthMinor: 100_000,
  accounts: [],
  cashflow: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
  categoryBreakdown: { income: [], expense: [] },
  periods: [],
  trend: [],
  recentTransactions: [],
})

const wrappers: VueWrapper[] = []

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ledger/accounts', name: 'ledger-accounts', component: LedgerAccountsView },
      { path: '/ledger', name: 'ledger', component: { template: '<div />' } },
      { path: '/ledger/accounts/:id', name: 'ledger-account', component: { template: '<div />' } },
    ],
  })
}

function setup(accounts: LedgerAccountDto[]): void {
  api.getLedgerSettings.mockResolvedValue(settings)
  api.listLedgerAccounts.mockResolvedValue(accounts)
  api.listLedgerCategories.mockResolvedValue([])
  api.getLedgerOverview.mockResolvedValue(overview())
  api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
}

describe('Ledger account management list', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('lists active and archived accounts and never exposes physical delete', async () => {
    setup([account('bank-1'), account('old-bank', 10)])
    const nextRouter = router()
    await nextRouter.push('/ledger/accounts')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountsView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)

    await flushPromises()

    expect(wrapper.get('[data-testid="ledger-active-account-list"]').text()).toContain('bank-1')
    expect(wrapper.get('[data-testid="ledger-archived-account-list"]').text()).toContain('old-bank')
    expect(wrapper.findAll('button').some((button) => button.text() === '删除')).toBe(false)
  })

  it('opens the shared account-create form and uses the real account API', async () => {
    setup([account('bank-1')])
    const nextRouter = router()
    await nextRouter.push('/ledger/accounts')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountsView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[data-testid="ledger-account-form"]').exists()).toBe(true)
    const form = wrapper.get('[data-testid="ledger-account-form"]')
    await form.get('input[name="name"]').setValue('现金账户')
    api.createLedgerAccount.mockResolvedValue(account('cash-1'))
    api.getLedgerSettings.mockResolvedValue(settings)
    api.listLedgerAccounts.mockResolvedValue([account('bank-1'), account('cash-1')])
    await form.trigger('submit')
    await flushPromises()

    expect(api.createLedgerAccount).toHaveBeenCalledWith(expect.objectContaining({ name: '现金账户' }), expect.any(String))
    expect(wrapper.find('[data-testid="ledger-account-form"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="ledger-active-account-list"]').text()).toContain('cash-1')
  })

  it('restores an archived account through its versioned lifecycle endpoint', async () => {
    setup([account('old-bank', 10)])
    const nextRouter = router()
    await nextRouter.push('/ledger/accounts')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountsView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)
    await flushPromises()

    api.restoreLedgerAccount.mockResolvedValue(account('old-bank'))
    api.listLedgerAccounts.mockResolvedValue([account('old-bank')])
    await wrapper.get('[data-testid="ledger-archived-account-list"] button').trigger('click')
    await flushPromises()

    expect(api.restoreLedgerAccount).toHaveBeenCalledWith('old-bank', 1)
  })
})
