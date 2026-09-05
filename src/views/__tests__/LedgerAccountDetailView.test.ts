// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LedgerAccountDto, LedgerOverviewDto, LedgerSettingsDto } from '../../../shared/ledgerProtocol'
import { resetLedgerStoreForTesting } from '../../features/ledger/ledgerStore'
import LedgerAccountDetailView from '../LedgerAccountDetailView.vue'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
  getLedgerAccount: vi.fn(),
  getLedgerAccountTransactions: vi.fn(),
  patchLedgerAccount: vi.fn(),
  archiveLedgerAccount: vi.fn(),
  restoreLedgerAccount: vi.fn(),
}))
const confirm = vi.hoisted(() => vi.fn())

vi.mock('../../features/ledger/api', () => api)
vi.mock('../../composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }))

const settings: LedgerSettingsDto = {
  baseCurrency: 'CNY',
  currencyExponent: 2,
  timezone: 'Asia/Shanghai',
  hasCreatedAccount: true,
  version: 2,
  createdAt: 1,
  updatedAt: 2,
}

function account(overrides: Partial<LedgerAccountDto> = {}): LedgerAccountDto {
  return {
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
    version: 3,
    createdAt: 1,
    updatedAt: 2,
    currentBalanceMinor: 1_000_000,
    ...overrides,
  }
}

const overview = (): LedgerOverviewDto => ({
  currency: 'CNY',
  currencyExponent: 2,
  assetTotalMinor: 1_000_000,
  liabilityTotalMinor: 0,
  netWorthMinor: 1_000_000,
  accounts: [],
  cashflow: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
  categoryBreakdown: { income: [], expense: [] },
  periods: [],
  trend: [],
  recentTransactions: [],
})

const wrappers: VueWrapper[] = []

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ledger/accounts/:id', name: 'ledger-account', component: LedgerAccountDetailView },
      { path: '/ledger/accounts', name: 'ledger-accounts', component: { template: '<div />' } },
      { path: '/ledger/transactions', name: 'ledger-transactions', component: { template: '<div />' } },
    ],
  })
}

function setup(nextAccount: LedgerAccountDto, history: unknown[] = []): void {
  api.getLedgerSettings.mockResolvedValue(settings)
  api.getLedgerAccount.mockResolvedValue(nextAccount)
  api.getLedgerAccountTransactions.mockResolvedValue({
    account: nextAccount,
    movement: { balanceIncreaseMinor: 0, balanceDecreaseMinor: 0 },
    transactions: history,
    page: { nextCursor: null },
  })
  api.listLedgerAccounts.mockResolvedValue([nextAccount])
  api.listLedgerCategories.mockResolvedValue([])
  api.getLedgerOverview.mockResolvedValue(overview())
  api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
}

describe('Ledger account detail lifecycle', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('allows financial interpretation edits only before account history exists', async () => {
    const original = account()
    setup(original)
    const nextRouter = createTestRouter()
    await nextRouter.push('/ledger/accounts/bank-1')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountDetailView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '编辑账户')!.trigger('click')
    expect(wrapper.find('select[name="nature"]').exists()).toBe(true)
    await wrapper.get('input[name="name"]').setValue('招商银行主账户')
    api.patchLedgerAccount.mockResolvedValue(account({ name: '招商银行主账户', version: 4 }))
    api.getLedgerAccount.mockResolvedValue(account({ name: '招商银行主账户', version: 4 }))
    await wrapper.get('[data-testid="ledger-account-edit-form"]').trigger('submit')
    await flushPromises()

    expect(api.patchLedgerAccount).toHaveBeenCalledWith('bank-1', expect.objectContaining({
      expectedVersion: 3,
      name: '招商银行主账户',
      openingBalanceMinor: 1_000_000,
    }))
  })

  it('sends only name and note when history makes financial fields read-only', async () => {
    const original = account()
    setup(original, [{ id: 'transaction-1', type: 'expense' }])
    const nextRouter = createTestRouter()
    await nextRouter.push('/ledger/accounts/bank-1')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountDetailView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '编辑账户')!.trigger('click')
    expect(wrapper.find('select[name="nature"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('账户已有历史记录')
    await wrapper.get('input[name="name"]').setValue('历史账户')
    api.patchLedgerAccount.mockResolvedValue(account({ name: '历史账户', version: 4 }))
    await wrapper.get('[data-testid="ledger-account-edit-form"]').trigger('submit')
    await flushPromises()

    expect(api.patchLedgerAccount).toHaveBeenCalledWith('bank-1', {
      expectedVersion: 3,
      name: '历史账户',
      note: '',
    })
  })

  it('requires zero balance before archiving and sends expectedVersion', async () => {
    const original = account({ currentBalanceMinor: 0 })
    setup(original)
    const nextRouter = createTestRouter()
    await nextRouter.push('/ledger/accounts/bank-1')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountDetailView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '归档账户')!.trigger('click')
    api.archiveLedgerAccount.mockResolvedValue(account({ currentBalanceMinor: 0, archivedAt: 20, version: 4 }))
    api.listLedgerAccounts.mockResolvedValue([account({ currentBalanceMinor: 0, archivedAt: 20, version: 4 })])
    await flushPromises()

    expect(api.archiveLedgerAccount).toHaveBeenCalledWith('bank-1', 3)
  })

  it('renders the server movement projection with asset language and a filtered-history link', async () => {
    const original = account()
    setup(original)
    api.getLedgerAccountTransactions.mockResolvedValue({
      account: original,
      movement: { balanceIncreaseMinor: 50_000, balanceDecreaseMinor: 12_000 },
      transactions: [],
      page: { nextCursor: null },
    })
    const nextRouter = createTestRouter()
    await nextRouter.push('/ledger/accounts/bank-1')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountDetailView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)
    await flushPromises()

    const movement = wrapper.get('[data-testid="ledger-account-movement"]')
    expect(movement.text()).toContain('流入')
    expect(movement.text()).toContain('流出')
    expect(movement.text()).toContain('¥500.00')
    expect(movement.text()).toContain('¥120.00')
    expect(wrapper.get('.ledger-account-history-link').attributes('href')).toBe('/ledger/transactions?accountId=bank-1')
    expect(api.getLedgerAccountTransactions).toHaveBeenCalledWith('bank-1', { includeDeleted: true, limit: 1 })
  })

  it('uses liability movement language instead of cashflow language', async () => {
    const liability = account({
      type: 'credit_card',
      nature: 'liability',
      currentBalanceMinor: 200_000,
    })
    setup(liability)
    api.getLedgerAccountTransactions.mockResolvedValue({
      account: liability,
      movement: { balanceIncreaseMinor: 80_000, balanceDecreaseMinor: 30_000 },
      transactions: [],
      page: { nextCursor: null },
    })
    const nextRouter = createTestRouter()
    await nextRouter.push('/ledger/accounts/bank-1')
    await nextRouter.isReady()
    const wrapper = mount(LedgerAccountDetailView, { global: { plugins: [nextRouter] } })
    wrappers.push(wrapper)
    await flushPromises()

    const movement = wrapper.get('[data-testid="ledger-account-movement"]')
    expect(movement.text()).toContain('新增负债')
    expect(movement.text()).toContain('减少负债')
    expect(movement.text()).not.toContain('流入')
    expect(movement.text()).not.toContain('流出')
  })
})
