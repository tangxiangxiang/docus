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
import { instantFromLocalDateTime } from '../../../features/ledger/time'
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

const archivedAccount: LedgerAccountDto = {
  ...account,
  id: 'cash-1',
  name: '现金账户',
  type: 'cash',
  archivedAt: 3,
  version: 2,
  updatedAt: 3,
  currentBalanceMinor: 0,
}

const secondArchivedAccount: LedgerAccountDto = {
  ...archivedAccount,
  id: 'wallet-1',
  name: '旧钱包',
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

const archivedExpense: LedgerTransactionDto = {
  ...expense,
  id: 'tx-archived-expense',
  accountId: archivedAccount.id,
  payee: '',
}

const transferActiveToArchived: LedgerTransactionDto = {
  ...expense,
  id: 'tx-transfer-active-archived',
  type: 'transfer',
  amountMinor: 10_000,
  fromAccountId: account.id,
  toAccountId: archivedAccount.id,
}

const transferArchivedToActive: LedgerTransactionDto = {
  ...transferActiveToArchived,
  id: 'tx-transfer-archived-active',
  fromAccountId: archivedAccount.id,
  toAccountId: account.id,
}

const transferArchivedToArchived: LedgerTransactionDto = {
  ...transferActiveToArchived,
  id: 'tx-transfer-archived-archived',
  fromAccountId: archivedAccount.id,
  toAccountId: secondArchivedAccount.id,
}

const archivedAdjustment: LedgerTransactionDto = {
  ...expense,
  id: 'tx-archived-adjustment',
  type: 'adjustment',
  amountMinor: 0,
  accountId: archivedAccount.id,
  adjustmentCalculatedBalanceMinor: 0,
  adjustmentTargetBalanceMinor: 0,
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
    { period: 'today', startAt: instantFromLocalDateTime('2026-09-05T00:00', 'Asia/Shanghai'), endAt: instantFromLocalDateTime('2026-09-06T00:00', 'Asia/Shanghai'), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
    { period: 'week', startAt: instantFromLocalDateTime('2026-08-31T00:00', 'Asia/Shanghai'), endAt: instantFromLocalDateTime('2026-09-07T00:00', 'Asia/Shanghai'), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
    { period: 'month', startAt: instantFromLocalDateTime('2026-09-01T00:00', 'Asia/Shanghai'), endAt: instantFromLocalDateTime('2026-10-01T00:00', 'Asia/Shanghai'), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
    { period: 'year', startAt: instantFromLocalDateTime('2026-01-01T00:00', 'Asia/Shanghai'), endAt: instantFromLocalDateTime('2027-01-01T00:00', 'Asia/Shanghai'), incomeMinor: 0, expenseMinor: 3_800, balanceMinor: -3_800 },
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
    expect(wrapper.get('[data-testid="ledger-category-breakdown"]').text()).toContain('这段期间还没有收入分类。')
    expect(wrapper.get('[data-testid="ledger-recent-transactions"]').text()).toContain('午餐')
    expect(wrapper.get('[data-testid="ledger-period-today"]').text()).toContain('2026年9月5日')
    expect(wrapper.get('[data-testid="ledger-period-week"]').text()).toContain('2026年8月31日 – 9月6日')
    expect(wrapper.get('[data-testid="ledger-period-month"]').text()).toContain('2026年9月')
    expect(wrapper.get('[data-testid="ledger-period-year"]').text()).toContain('2026年')
    for (const period of ['today', 'week', 'month', 'year']) {
      expect(wrapper.get(`[data-testid="ledger-period-${period}"]`).text()).not.toMatch(/00:00|23:59/)
    }
    expect(wrapper.get('[data-testid="ledger-period-month"]').text()).toContain('收支结余')
    expect(wrapper.get('[data-testid="ledger-period-month"]').text()).toContain('-¥38.00')
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

  it('supports the all-time scope without changing server-owned balances or fixed periods', async () => {
    const wrapper = mount(LedgerView)
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.get('select[aria-label="选择收支期间"]').setValue('all')
    await flushPromises()

    expect(api.getLedgerOverview).toHaveBeenLastCalledWith('all')
    expect(wrapper.get('[data-testid="ledger-total-assets"]').text()).toContain('9,962')
    expect(wrapper.get('[data-testid="ledger-total-liabilities"]').text()).toContain('0')
    expect(wrapper.get('[data-testid="ledger-period-month"]').text()).toContain('-¥38.00')
  })

  it('shows presentation-only category shares and groups accounts by nature', async () => {
    const liability: LedgerAccountSummary = {
      ...account,
      id: 'card-1',
      name: '信用卡',
      type: 'credit_card',
      nature: 'liability',
      currentBalanceMinor: 10_000,
      balanceIncreaseMinor: 10_000,
      balanceDecreaseMinor: 0,
    }
    api.getLedgerOverview.mockResolvedValue({
      ...overview(),
      accounts: [accountSummary, liability],
      categoryBreakdown: {
        income: [],
        expense: [
          { categoryId: 'food', name: '餐饮', kind: 'expense', amountMinor: 3_800 },
          { categoryId: 'transport', name: '交通', kind: 'expense', amountMinor: 6_200 },
        ],
      },
    })
    const wrapper = mount(LedgerView)
    wrappers.push(wrapper)
    await flushPromises()

    const breakdown = wrapper.get('[data-testid="ledger-category-breakdown"]').text()
    expect(breakdown).toContain('餐饮')
    expect(breakdown).toContain('38%')
    expect(breakdown).toContain('交通')
    expect(breakdown).toContain('62%')
    const accounts = wrapper.get('[data-testid="ledger-dashboard-accounts"]').text()
    expect(accounts).toContain('资产账户')
    expect(accounts).toContain('负债账户')
    expect(accounts).toContain('招商银行')
    expect(accounts).toContain('信用卡')
  })

  it('keeps category name and share on the left while placing the amount on the right', async () => {
    api.getLedgerOverview.mockResolvedValue({
      ...overview(),
      categoryBreakdown: {
        income: [
          { categoryId: 'salary', name: '工资', kind: 'income', amountMinor: 500_000 },
          { categoryId: 'side-job', name: '兼职', kind: 'income', amountMinor: 10_000 },
        ],
        expense: [
          { categoryId: 'food', name: '餐饮', kind: 'expense', amountMinor: 5_290 },
        ],
      },
    })
    const wrapper = mount(LedgerView)
    wrappers.push(wrapper)
    await flushPromises()

    const incomeRows = wrapper.get('[data-testid="ledger-category-breakdown"]').findAll('.ledger-breakdown-row')
    expect(incomeRows[0].get('.ledger-breakdown-label').text()).toBe('工资 · 98%')
    expect(incomeRows[0].get('.ledger-breakdown-amount').text()).toBe('¥5,000.00')
    expect(incomeRows[0].get('.ledger-breakdown-amount').text()).not.toContain('98%')
    expect(incomeRows[1].get('.ledger-breakdown-label').text()).toBe('兼职 · 2%')
    expect(incomeRows[1].get('.ledger-breakdown-amount').text()).toBe('¥100.00')
    expect(incomeRows[1].get('.ledger-breakdown-amount').text()).not.toContain('2%')

    const expenseRows = wrapper.get('[data-testid="ledger-category-breakdown"]').findAll('.ledger-breakdown-row')
    expect(expenseRows[2].get('.ledger-breakdown-label').text()).toBe('餐饮 · 100%')
    expect(expenseRows[2].get('.ledger-breakdown-amount').text()).toBe('¥52.90')
    expect(expenseRows[2].get('.ledger-breakdown-amount').text()).not.toContain('100%')
  })

  it('resolves recent transaction account labels from active and archived accounts', async () => {
    api.listLedgerAccounts.mockResolvedValue([account, archivedAccount, secondArchivedAccount])
    api.getLedgerOverview.mockResolvedValue({
      ...overview(),
      accounts: [accountSummary],
      recentTransactions: [
        archivedExpense,
        transferActiveToArchived,
        transferArchivedToActive,
        transferArchivedToArchived,
        archivedAdjustment,
      ],
    })

    const wrapper = mount(LedgerView)
    wrappers.push(wrapper)
    await flushPromises()

    const recent = wrapper.get('[data-testid="ledger-recent-transactions"]')
    const rows = recent.findAll('.ledger-recent-row')
    expect(rows).toHaveLength(5)
    expect(rows[0].text()).toContain('餐饮 · 现金账户（已归档）')
    expect(rows[1].text()).toContain('招商银行 → 现金账户（已归档）')
    expect(rows[2].text()).toContain('现金账户（已归档） → 招商银行')
    expect(rows[3].text()).toContain('现金账户（已归档） → 旧钱包（已归档）')
    expect(rows[4].text()).toContain('现金账户（已归档）')

    // Archived accounts remain available for historical labels, but do not
    // re-enter the Dashboard's active account projection.
    expect(wrapper.get('[data-testid="ledger-dashboard-assets"]').text()).not.toContain('现金账户')
  })
})
