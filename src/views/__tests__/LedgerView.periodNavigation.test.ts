// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type {
  LedgerAccountDto,
  LedgerCategoryDto,
  LedgerOverviewDto,
  LedgerOverviewScope,
  LedgerSettingsDto,
} from '../../../shared/ledgerProtocol'
import { LedgerApiError } from '../../features/ledger/ledgerErrors'
import { resetLedgerStoreForTesting } from '../../features/ledger/ledgerStore'
import LedgerView from '../LedgerView.vue'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
}))

vi.mock('../../features/ledger/api', () => api)

const settings: LedgerSettingsDto = {
  baseCurrency: 'CNY',
  currencyExponent: 2,
  timezone: 'Asia/Shanghai',
  hasCreatedAccount: true,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
}

const account: LedgerAccountDto = {
  id: 'bank-1',
  name: '招商银行',
  type: 'bank',
  nature: 'asset',
  openingBalanceMinor: 1_000_000,
  openingDate: '2026-01-01',
  currency: 'CNY',
  currencyExponent: 2,
  note: '',
  archivedAt: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  currentBalanceMinor: 1_000_000,
}

const category: LedgerCategoryDto = {
  id: 'food',
  kind: 'expense',
  name: '餐饮',
  normalizedName: '餐饮',
  archivedAt: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
}

function overviewFor(input: { scope: LedgerOverviewScope; anchorDate: string | undefined }): LedgerOverviewDto {
  const anchorDate = input.anchorDate ?? '2026-09-05'
  return {
    context: {
      anchorDate,
      todayDate: '2026-09-05',
      isToday: anchorDate === '2026-09-05',
      scope: input.scope,
    },
    currency: 'CNY',
    currencyExponent: 2,
    assetTotalMinor: 1_000_000,
    liabilityTotalMinor: 0,
    netWorthMinor: 1_000_000,
    accounts: [{
      ...account,
      balanceIncreaseMinor: 0,
      balanceDecreaseMinor: 0,
    }],
    cashflow: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
    categoryBreakdown: { income: [], expense: [] },
    periods: [
      { period: 'today', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
      { period: 'week', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
      { period: 'month', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
      { period: 'year', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
    ],
    trend: [],
    recentTransactions: [],
  }
}

const wrappers: VueWrapper[] = []

function setupApi(): void {
  api.getLedgerSettings.mockResolvedValue(settings)
  api.listLedgerAccounts.mockResolvedValue([account])
  api.listLedgerCategories.mockResolvedValue([category])
  api.getLedgerOverview.mockImplementation((input: { scope: LedgerOverviewScope; anchorDate: string | undefined }) => Promise.resolve(overviewFor(input)))
  api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
}

async function mountAt(path: string): Promise<{ router: ReturnType<typeof createRouter>; wrapper: VueWrapper }> {
  const placeholder = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ledger', name: 'ledger', component: LedgerView },
      { path: '/ledger/transactions', name: 'ledger-transactions', component: placeholder },
      { path: '/ledger/accounts', name: 'ledger-accounts', component: placeholder },
      { path: '/ledger/accounts/:id', name: 'ledger-account', component: placeholder },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(LedgerView, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return { router, wrapper }
}

describe('Ledger historical period route coordination', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    setupApi()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('loads an anchored route, exposes the requested date, and keeps current snapshot wording', async () => {
    const { router, wrapper } = await mountAt('/ledger?date=2026-08-20')

    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-08-20')
    expect(api.getLedgerOverview).toHaveBeenCalledWith({ scope: 'month', anchorDate: '2026-08-20' })
    expect((wrapper.get('[data-testid="ledger-period-date"]').element as HTMLInputElement).value).toBe('2026-08-20')
    expect(wrapper.find('[data-testid="ledger-return-today"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('当前资产与账户余额保持实时')
    expect(wrapper.text()).toContain('截至选择日期的最近 5 笔记录')
  })

  it('uses browser history for date changes and clears only the anchor when returning today', async () => {
    const { router, wrapper } = await mountAt('/ledger?date=2026-08-20')
    api.getLedgerOverview.mockClear()

    await wrapper.get('[data-testid="ledger-period-date"]').setValue('2026-08-19')
    await flushPromises()
    await flushPromises()
    expect(router.currentRoute.value.query.date).toBe('2026-08-19')
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: '2026-08-19' })

    await wrapper.get('[data-testid="ledger-return-today"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(router.currentRoute.value.query.date).toBeUndefined()
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: undefined })
    expect(wrapper.find('[data-testid="ledger-return-today"]').exists()).toBe(false)
  })

  it('canonicalizes invalid and explicit-today dates without sending an invalid anchor', async () => {
    const invalid = await mountAt('/ledger?date=2026-02-30')
    expect(invalid.router.currentRoute.value.fullPath).toBe('/ledger')
    expect(api.getLedgerOverview).not.toHaveBeenCalledWith({ scope: 'month', anchorDate: '2026-02-30' })

    invalid.wrapper.unmount()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    setupApi()
    const today = await mountAt('/ledger?date=2026-09-05')
    expect(today.router.currentRoute.value.fullPath).toBe('/ledger')
    expect(api.getLedgerOverview).toHaveBeenCalledWith({ scope: 'month', anchorDate: '2026-09-05' })
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: undefined })
  })

  it('lets Server future-date validation canonicalize the route and recover to the current dashboard', async () => {
    const future = new LedgerApiError(
      'future anchor',
      400,
      'ledger-validation-failed',
      { field: 'anchorDate' },
    )
    api.getLedgerOverview.mockRejectedValueOnce(future)
    const { router, wrapper } = await mountAt('/ledger?date=2026-09-06')

    expect(router.currentRoute.value.fullPath).toBe('/ledger')
    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-bootstrap-error"]').exists()).toBe(false)
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: undefined })
  })
})
