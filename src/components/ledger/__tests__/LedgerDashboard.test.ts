// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LedgerAccountDto,
  LedgerAccountSummary,
  LedgerCategoryDto,
  LedgerOverviewDto,
  LedgerSettingsDto,
  LedgerTransactionDto,
} from '../../../../shared/ledgerProtocol'
import { resetLedgerStoreForTesting } from '../../../features/ledger/ledgerStore'
import LedgerView from '../../../views/LedgerView.vue'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
}))

vi.mock('../../../features/ledger/api', () => api)

const settings: LedgerSettingsDto = {
  baseCurrency: 'CNY',
  currencyExponent: 2,
  timezone: 'Asia/Shanghai',
  hasCreatedAccount: true,
  version: 2,
  createdAt: 1,
  updatedAt: 2,
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
  currentBalanceMinor: 996_200,
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

const expense: LedgerTransactionDto = {
  id: 'tx-1',
  type: 'expense',
  amountMinor: 3_800,
  accountId: 'bank-1',
  categoryId: 'food',
  occurredAt: Date.UTC(2026, 8, 5, 4, 30),
  payee: '午餐',
  note: '',
  deletedAt: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
}

const accountSummary: LedgerAccountSummary = {
  ...account,
  balanceIncreaseMinor: 0,
  balanceDecreaseMinor: 3_800,
}

const overview = (): LedgerOverviewDto => ({
  currency: 'CNY',
  currencyExponent: 2,
  assetTotalMinor: 996_200,
  liabilityTotalMinor: 0,
  netWorthMinor: 996_200,
  accounts: [accountSummary],
  cashflow: { incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
  categoryBreakdown: { income: [], expense: [{ categoryId: 'food', name: '餐饮', kind: 'expense', amountMinor: 3_800 }] },
  periods: [
    { period: 'today', startAt: Date.UTC(2026, 8, 5), endAt: Date.UTC(2026, 8, 6), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
    { period: 'week', startAt: Date.UTC(2026, 7, 31), endAt: Date.UTC(2026, 8, 7), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
    { period: 'month', startAt: Date.UTC(2026, 8, 1), endAt: Date.UTC(2026, 9, 1), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
    { period: 'year', startAt: Date.UTC(2026, 0, 1), endAt: Date.UTC(2027, 0, 1), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
  ],
  trend: [{ month: '2026-09', startAt: Date.UTC(2026, 8, 1), endAt: Date.UTC(2026, 9, 1), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 }],
  recentTransactions: [expense],
})

const wrappers: VueWrapper[] = []

function setup(): void {
  api.getLedgerSettings.mockResolvedValue(settings)
  api.listLedgerAccounts.mockResolvedValue([account])
  api.listLedgerCategories.mockResolvedValue([category])
  api.getLedgerOverview.mockResolvedValue(overview())
  api.listLedgerTransactions.mockResolvedValue({ transactions: [expense], page: { nextCursor: null } })
}

describe('Ledger live dashboard', () => {
  beforeEach(() => {
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    setup()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('renders server projections and recent real transactions without mock data', async () => {
    const wrapper = mount(LedgerView)
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="ledger-total-assets"]').text()).toContain('9,962')
    expect(wrapper.get('[data-testid="ledger-total-liabilities"]').text()).toContain('0')
    expect(wrapper.get('[data-testid="ledger-net-worth"]').text()).toContain('9,962')
    expect(wrapper.get('[data-testid="ledger-dashboard-accounts"]').text()).toContain('招商银行')
    expect(wrapper.get('[data-testid="ledger-category-breakdown"]').text()).toContain('餐饮')
    expect(wrapper.get('[data-testid="ledger-recent-transactions"]').text()).toContain('午餐')
    expect(wrapper.text()).not.toContain('billsMockData')
  })

  it('uses the server scope endpoint when the selected cashflow period changes', async () => {
    const wrapper = mount(LedgerView)
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('select[aria-label="选择收支期间"]').setValue('today')
    await flushPromises()

    expect(api.getLedgerOverview).toHaveBeenLastCalledWith('today')
    expect(wrapper.get('[data-testid="ledger-total-assets"]').text()).toContain('9,962')
    expect(wrapper.get('[data-testid="ledger-dashboard-cashflow"]').text()).toContain('38.00')
  })
})
