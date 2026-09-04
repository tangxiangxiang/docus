// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerApiError } from '../../../features/ledger/ledgerErrors'
import { resetLedgerStoreForTesting } from '../../../features/ledger/ledgerStore'
import type {
  LedgerAccountDto,
  LedgerOverviewDto,
  LedgerSettingsDto,
} from '../../../../shared/ledgerProtocol'
import LedgerView from '../../../views/LedgerView.vue'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
  createLedgerSettings: vi.fn(),
  createLedgerAccount: vi.fn(),
}))

vi.mock('../../../features/ledger/api', () => api)

const settings = (hasCreatedAccount: boolean): LedgerSettingsDto => ({
  baseCurrency: 'CNY',
  currencyExponent: 2,
  timezone: 'Asia/Shanghai',
  hasCreatedAccount,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
})

const account = (id: string, archivedAt: number | null = null): LedgerAccountDto => ({
  id,
  name: id,
  type: 'bank',
  nature: 'asset',
  openingBalanceMinor: 0,
  openingDate: '2026-01-01',
  currency: 'CNY',
  currencyExponent: 2,
  note: '',
  archivedAt,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  currentBalanceMinor: 0,
})

const overview = (): LedgerOverviewDto => ({
  currency: 'CNY',
  currencyExponent: 2,
  assetTotalMinor: 0,
  liabilityTotalMinor: 0,
  netWorthMinor: 0,
  accounts: [],
  cashflow: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
  categoryBreakdown: { income: [], expense: [] },
  periods: [],
  trend: [],
  recentTransactions: [],
})

function setupLoadedState(
  nextSettings: LedgerSettingsDto,
  nextAccounts: LedgerAccountDto[] = [],
): void {
  api.getLedgerSettings.mockResolvedValue(nextSettings)
  api.listLedgerAccounts.mockResolvedValue(nextAccounts)
  api.listLedgerCategories.mockResolvedValue([])
  api.getLedgerOverview.mockResolvedValue(overview())
  api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
}

describe('Ledger initialization and first-account onboarding', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
  })

  it('shows an explicit settings step when the Ledger is uninitialized', async () => {
    api.getLedgerSettings.mockRejectedValue(new LedgerApiError('missing', 404, 'ledger-not-found'))
    const wrapper = mount(LedgerView)

    await flushPromises()

    expect(wrapper.find('[data-testid="ledger-settings-form"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-account-form"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('基础货币决定金额的表达方式')
  })

  it('requires an explicit currency and timezone confirmation before moving to the account step', async () => {
    api.getLedgerSettings
      .mockRejectedValueOnce(new LedgerApiError('missing', 404, 'ledger-not-found'))
      .mockResolvedValue(settings(false))
    api.listLedgerAccounts.mockResolvedValue([])
    api.listLedgerCategories.mockResolvedValue([])
    api.getLedgerOverview.mockResolvedValue(overview())
    api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
    const wrapper = mount(LedgerView)
    await flushPromises()

    const settingsForm = wrapper.get('[data-testid="ledger-settings-form"]')
    await settingsForm.get('select[name="baseCurrency"]').setValue('CNY')
    await settingsForm.get('input[name="timezone"]').setValue('Asia/Shanghai')

    api.getLedgerSettings.mockResolvedValue(settings(false))
    api.createLedgerSettings.mockResolvedValue(settings(false))
    await settingsForm.trigger('submit')
    await flushPromises()

    expect(api.createLedgerSettings).toHaveBeenCalledWith(
      { baseCurrency: 'CNY', timezone: 'Asia/Shanghai' },
      expect.any(String),
    )
    expect(wrapper.find('[data-testid="ledger-account-form"]').exists()).toBe(true)
  })

  it('creates the first account using display decimal input and inherited Ledger currency', async () => {
    setupLoadedState(settings(false))
    const wrapper = mount(LedgerView)
    await flushPromises()

    const form = wrapper.get('[data-testid="ledger-account-form"]')
    await form.get('input[name="name"]').setValue('招商银行')
    await form.get('input[name="openingBalance"]').setValue('10000.00')
    await form.get('input[name="openingDate"]').setValue('2026-09-05')

    api.createLedgerAccount.mockResolvedValue(account('bank-1'))
    api.getLedgerSettings.mockResolvedValue(settings(true))
    api.listLedgerAccounts.mockResolvedValue([account('bank-1')])
    await form.trigger('submit')
    await flushPromises()

    expect(api.createLedgerAccount).toHaveBeenCalledWith({
      name: '招商银行',
      type: 'bank',
      nature: 'asset',
      openingBalanceMinor: 1_000_000,
      openingDate: '2026-09-05',
      currency: 'CNY',
      note: '',
    }, expect.any(String))
    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
  })

  it('does not present a normal zero dashboard when initialized without an active account', async () => {
    setupLoadedState(settings(true), [account('archived-bank', 5)])
    const wrapper = mount(LedgerView)

    await flushPromises()

    expect(wrapper.find('[data-testid="ledger-no-active-account"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-ready-placeholder"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('恢复账户')
    expect(wrapper.text()).toContain('创建新账户')
  })

  it('keeps initialized settings locked after the account marker is true', async () => {
    setupLoadedState(settings(true), [account('bank-1')])
    const wrapper = mount(LedgerView)

    await flushPromises()

    expect(wrapper.find('[data-testid="ledger-settings-form"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
  })
})
