// @vitest-environment jsdom
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LedgerAccountDto,
  LedgerCategoryDto,
  LedgerOverviewDto,
  LedgerSettingsDto,
  LedgerTransactionDto,
} from '../../../../shared/ledgerProtocol'
import { LedgerApiError } from '../../../features/ledger/ledgerErrors'
import { resetLedgerStoreForTesting } from '../../../features/ledger/ledgerStore'
import LedgerView from '../../../views/LedgerView.vue'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
  createLedgerTransaction: vi.fn(),
  createLedgerCategory: vi.fn(),
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

function account(id: string, name: string): LedgerAccountDto {
  return {
    id,
    name,
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
}

function category(id: string, kind: 'income' | 'expense', name: string, archivedAt: number | null = null): LedgerCategoryDto {
  return { id, kind, name, normalizedName: name.toLowerCase(), archivedAt, version: 1, createdAt: 1, updatedAt: 1 }
}

const expense = category('food', 'expense', '餐饮')
const income = category('salary', 'income', '工资')

const overview = (): LedgerOverviewDto => ({
  currency: 'CNY',
  currencyExponent: 2,
  assetTotalMinor: 2_000_000,
  liabilityTotalMinor: 0,
  netWorthMinor: 2_000_000,
  accounts: [],
  cashflow: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
  categoryBreakdown: { income: [], expense: [] },
  periods: [],
  trend: [],
  recentTransactions: [],
})

const savedTransaction = { id: 'tx-1', type: 'expense' } as unknown as LedgerTransactionDto
const wrappers: VueWrapper[] = []
let categories: LedgerCategoryDto[] = [expense, income, category('old', 'expense', '旧分类', 10)]

function setup(accounts: LedgerAccountDto[] = [account('bank-1', '招商银行'), account('wallet-1', '现金钱包')]): void {
  api.getLedgerSettings.mockResolvedValue(settings)
  api.listLedgerAccounts.mockResolvedValue(accounts)
  api.listLedgerCategories.mockImplementation(() => Promise.resolve(categories))
  api.getLedgerOverview.mockResolvedValue(overview())
  api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
}

async function openSheet(): Promise<VueWrapper> {
  const wrapper = mount(LedgerView)
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.get('[data-testid="ledger-record-button"]').trigger('click')
  await flushPromises()
  return wrapper
}

function getSheet(): InstanceType<typeof DOMWrapper> {
  const element = document.body.querySelector<HTMLElement>('.ledger-sheet')
  if (!element) throw new Error('transaction sheet is not mounted')
  return new DOMWrapper(element)
}

describe('Ledger transaction creation sheet', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    categories = [expense, income, category('old', 'expense', '旧分类', 10)]
    setup()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('opens with Expense as the default and sends CNY decimal input as minor units', async () => {
    await openSheet()
    const sheet = getSheet()

    expect(sheet.get('[role="tab"][aria-selected="true"]').text()).toBe('支出')
    expect((sheet.get('input[name="occurredAt"]').element as HTMLInputElement).value).toContain('T')
    expect(sheet.findAll('select[name="categoryId"] option').map((option) => option.text())).toEqual(['请选择分类', '餐饮'])

    await sheet.get('input[name="amount"]').setValue('38')
    await sheet.get('select[name="categoryId"]').setValue('food')
    await sheet.get('input[name="occurredAt"]').setValue('2026-09-05T12:30')
    api.createLedgerTransaction.mockResolvedValue(savedTransaction)
    await sheet.get('form').trigger('submit')
    await flushPromises()

    expect(api.createLedgerTransaction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'expense',
      amountMinor: 3800,
      accountId: 'bank-1',
      categoryId: 'food',
      payee: '',
      note: '',
      occurredAt: expect.any(Number),
    }), expect.any(String))
    expect(document.body.querySelector('.ledger-sheet')).toBeNull()
  })

  it('switches to income and transfer with only their contract fields', async () => {
    const wrapper = await openSheet()
    const sheet = getSheet()

    await sheet.findAll('[role="tab"]').find((button) => button.text() === '收入')!.trigger('click')
    expect(sheet.find('select[name="categoryId"]').exists()).toBe(true)
    expect(sheet.findAll('select[name="categoryId"] option').map((option) => option.text())).toEqual(['请选择分类', '工资'])
    await sheet.get('input[name="amount"]').setValue('12.50')
    await sheet.get('select[name="accountId"]').setValue('bank-1')
    await sheet.get('select[name="categoryId"]').setValue('salary')
    await sheet.get('input[name="occurredAt"]').setValue('2026-09-05T12:30')
    api.createLedgerTransaction.mockResolvedValue(savedTransaction)
    await sheet.get('form').trigger('submit')
    await flushPromises()

    expect(api.createLedgerTransaction).toHaveBeenCalledWith(expect.objectContaining({ type: 'income', amountMinor: 1250 }), expect.any(String))

    await wrapper.get('[data-testid="ledger-record-button"]').trigger('click')
    const transferSheet = getSheet()
    await transferSheet.findAll('[role="tab"]').find((button) => button.text() === '转账')!.trigger('click')
    expect(transferSheet.find('select[name="categoryId"]').exists()).toBe(false)
    expect(transferSheet.find('input[name="payee"]').exists()).toBe(false)
    await transferSheet.get('input[name="amount"]').setValue('5')
    await transferSheet.get('select[name="fromAccountId"]').setValue('bank-1')
    await transferSheet.get('select[name="toAccountId"]').setValue('wallet-1')
    await transferSheet.get('input[name="occurredAt"]').setValue('2026-09-05T12:30')
    api.createLedgerTransaction.mockResolvedValue({ id: 'tx-2', type: 'transfer' } as unknown as LedgerTransactionDto)
    await transferSheet.get('form').trigger('submit')
    await flushPromises()

    expect(api.createLedgerTransaction).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'transfer', amountMinor: 500, fromAccountId: 'bank-1', toAccountId: 'wallet-1',
    }), expect.any(String))
  })

  it('quick-creates a contextual category and selects the server result', async () => {
    await openSheet()
    const sheet = getSheet()
    await sheet.findAll('button').find((button) => button.text() === '新建分类')!.trigger('click')
    await sheet.get('input[name="categoryName"]').setValue('交通')
    const created = category('transport', 'expense', '交通')
    api.createLedgerCategory.mockImplementation(() => {
      categories = [...categories, created]
      return Promise.resolve(created)
    })
    await sheet.get('[data-testid="ledger-category-quick-create"] button').trigger('click')
    await flushPromises()

    expect(api.createLedgerCategory).toHaveBeenCalledWith({ kind: 'expense', name: '交通' }, expect.any(String))
    expect((sheet.get('select[name="categoryId"]').element as HTMLSelectElement).value).toBe('transport')
    expect(sheet.find('[data-testid="ledger-category-quick-create"]').exists()).toBe(false)
  })

  it('keeps the same idempotency key and readonly recovery surface after response loss', async () => {
    await openSheet()
    const sheet = getSheet()
    await sheet.get('input[name="amount"]').setValue('38')
    await sheet.get('select[name="categoryId"]').setValue('food')
    await sheet.get('input[name="occurredAt"]').setValue('2026-09-05T12:30')
    api.createLedgerTransaction.mockRejectedValueOnce(new LedgerApiError('unknown', 0, 'ledger-network-error', null, true))
    await sheet.get('form').trigger('submit')
    await flushPromises()

    expect(document.body.querySelector('[data-testid="ledger-recovery"]')).not.toBeNull()
    expect(document.body.querySelector('input[name="amount"]')).toBeNull()
    const firstKey = api.createLedgerTransaction.mock.calls[0][1]
    api.createLedgerTransaction.mockResolvedValue(savedTransaction)
    await getSheet().get('[data-testid="ledger-recovery"] button').trigger('click')
    await flushPromises()

    expect(api.createLedgerTransaction.mock.calls[1][1]).toBe(firstKey)
    expect(sessionStorage.getItem('docus.ledger.pending-create')).toBeNull()
    expect(document.body.querySelector('.ledger-sheet')).toBeNull()
  })

  it('treats a transfer to the same account as a user-correctable validation error', async () => {
    await openSheet()
    const sheet = getSheet()
    await sheet.findAll('[role="tab"]').find((button) => button.text() === '转账')!.trigger('click')
    await sheet.get('input[name="amount"]').setValue('5')
    await sheet.get('select[name="fromAccountId"]').setValue('bank-1')
    await sheet.get('select[name="toAccountId"]').setValue('bank-1')
    await sheet.get('input[name="occurredAt"]').setValue('2026-09-05T12:30')
    await sheet.get('form').trigger('submit')

    expect(sheet.text()).toContain('转出账户和转入账户必须不同')
    expect(api.createLedgerTransaction).not.toHaveBeenCalled()
  })
})
