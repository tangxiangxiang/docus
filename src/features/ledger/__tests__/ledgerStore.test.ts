// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LedgerAccountDto,
  LedgerOverviewDto,
  LedgerSettingsDto,
} from '../../../../shared/ledgerProtocol'
import { LedgerApiError } from '../ledgerErrors'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
  createLedgerSettings: vi.fn(),
  createLedgerAccount: vi.fn(),
  createLedgerCategory: vi.fn(),
  createLedgerTransaction: vi.fn(),
  getLedgerAccount: vi.fn(),
  getLedgerTransaction: vi.fn(),
  getLedgerAccountTransactions: vi.fn(),
  patchLedgerSettings: vi.fn(),
  patchLedgerAccount: vi.fn(),
  archiveLedgerAccount: vi.fn(),
  restoreLedgerAccount: vi.fn(),
  deleteLedgerAccount: vi.fn(),
  patchLedgerCategory: vi.fn(),
  archiveLedgerCategory: vi.fn(),
  restoreLedgerCategory: vi.fn(),
  deleteLedgerCategory: vi.fn(),
  patchLedgerTransaction: vi.fn(),
  deleteLedgerTransaction: vi.fn(),
}))

vi.mock('../api', () => api)

import { resetLedgerStoreForTesting, useLedgerStore } from '../ledgerStore'

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

describe('Ledger feature-local state', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    api.listLedgerCategories.mockResolvedValue([])
    api.getLedgerOverview.mockResolvedValue(overview())
    api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
  })

  it('uses hasCreatedAccount, not account-list length, for lifecycle states', async () => {
    api.getLedgerSettings.mockResolvedValueOnce(settings(false)).mockResolvedValueOnce(settings(true))
    api.listLedgerAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const store = useLedgerStore()

    await store.bootstrap()
    expect(store.workspaceState.value).toBe('FIRST_ACCOUNT_REQUIRED')

    await store.bootstrap()
    expect(store.workspaceState.value).toBe('NO_ACTIVE_ACCOUNT')
  })

  it('keeps a network-uncertain create intent durable with the same key', async () => {
    api.getLedgerSettings.mockResolvedValue(settings(true))
    api.listLedgerAccounts.mockResolvedValue([account('account-1')])
    const uncertain = new LedgerApiError('unknown', 0, 'ledger-network-error', null, true)
    api.createLedgerTransaction.mockRejectedValue(uncertain)
    const store = useLedgerStore()
    await store.bootstrap()

    const payload = {
      type: 'expense' as const,
      amountMinor: 3800,
      accountId: 'account-1',
      categoryId: 'category-1',
      occurredAt: 1_700_000_000_000,
      payee: '',
      note: '',
    }
    await expect(store.createTransaction(payload)).rejects.toMatchObject({ transportOutcomeUnknown: true })
    expect(store.mutationState.value).toBe('UNCERTAIN')
    expect(store.pendingCreate.value?.canonicalPayload).toEqual(payload)
    expect(store.pendingCreate.value?.idempotencyKey).toBeTruthy()
    expect(JSON.parse(sessionStorage.getItem('docus.ledger.pending-create') ?? '{}')).toMatchObject({
      canonicalPayload: payload,
      operation: 'transaction',
    })

    api.createLedgerTransaction.mockResolvedValue({ id: 'tx-1', type: 'expense' })
    await store.retryPendingCreate()
    expect(api.createLedgerTransaction).toHaveBeenLastCalledWith(payload, expect.any(String))
    expect(store.pendingCreate.value).toBeNull()
    expect(sessionStorage.getItem('docus.ledger.pending-create')).toBeNull()
  })

  it('treats a definite 503 as a confirmed failure and clears recovery', async () => {
    api.getLedgerSettings.mockResolvedValue(settings(true))
    api.listLedgerAccounts.mockResolvedValue([account('account-1')])
    api.createLedgerTransaction.mockRejectedValue(new LedgerApiError('busy', 503, 'ledger-write-busy'))
    const store = useLedgerStore()
    await store.bootstrap()
    const payload = {
      type: 'expense' as const,
      amountMinor: 1,
      accountId: 'account-1',
      categoryId: 'category-1',
      occurredAt: 1_700_000_000_000,
      payee: '',
      note: '',
    }
    await expect(store.createTransaction(payload)).rejects.toMatchObject({ code: 'ledger-write-busy' })
    expect(store.mutationState.value).toBe('ERROR')
    expect(store.pendingCreate.value).toBeNull()
    expect(sessionStorage.getItem('docus.ledger.pending-create')).toBeNull()
  })

  it('does not send any create mutation when sessionStorage cannot persist the intent', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    const store = useLedgerStore()
    const accountPayload = {
      name: '招商银行',
      type: 'bank' as const,
      nature: 'asset' as const,
      openingBalanceMinor: 0,
      openingDate: '2026-09-05',
      currency: 'CNY',
      note: '',
    }
    const transactionPayload = {
      type: 'expense' as const,
      amountMinor: 1,
      accountId: 'account-1',
      categoryId: 'category-1',
      occurredAt: 1_700_000_000_000,
      payee: '',
      note: '',
    }

    await expect(store.createSettings({ baseCurrency: 'CNY', timezone: 'Asia/Shanghai' }))
      .rejects.toMatchObject({ code: 'ledger-recovery-storage-unavailable' })
    await expect(store.createAccount(accountPayload))
      .rejects.toMatchObject({ code: 'ledger-recovery-storage-unavailable' })
    await expect(store.createCategory({ kind: 'expense', name: '交通' }))
      .rejects.toMatchObject({ code: 'ledger-recovery-storage-unavailable' })
    await expect(store.createTransaction(transactionPayload))
      .rejects.toMatchObject({ code: 'ledger-recovery-storage-unavailable' })

    expect(api.createLedgerSettings).not.toHaveBeenCalled()
    expect(api.createLedgerAccount).not.toHaveBeenCalled()
    expect(api.createLedgerCategory).not.toHaveBeenCalled()
    expect(api.createLedgerTransaction).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('blocks new creates and retains an invalid recovery record', async () => {
    const invalidRecord = {
      version: 99,
      operation: 'transaction',
      operationScope: 'POST:/api/ledger/transactions',
      idempotencyKey: 'key-invalid',
      canonicalPayload: {},
      createdAt: 1,
      ownerIdentity: null,
    }
    const raw = JSON.stringify(invalidRecord)
    sessionStorage.setItem('docus.ledger.pending-create', raw)
    resetLedgerStoreForTesting()
    const store = useLedgerStore()

    expect(store.recoveryState.value).toBe('BLOCKED')
    await expect(store.createCategory({ kind: 'expense', name: '新分类' }))
      .rejects.toMatchObject({ code: 'ledger-recovery-blocked' })
    expect(api.createLedgerCategory).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('docus.ledger.pending-create')).toBe(raw)
  })

  it('keeps the original intent when a successful create response body is unusable, then replays it', async () => {
    api.getLedgerSettings.mockResolvedValue(settings(true))
    api.listLedgerAccounts.mockResolvedValue([account('account-1')])
    const malformedSuccess = new LedgerApiError(
      'success body could not be validated',
      201,
      'ledger-malformed-response',
      null,
      false,
      true,
    )
    api.createLedgerTransaction.mockRejectedValueOnce(malformedSuccess)
    const store = useLedgerStore()
    await store.bootstrap()
    const payload = {
      type: 'expense' as const,
      amountMinor: 3800,
      accountId: 'account-1',
      categoryId: 'category-1',
      occurredAt: 1_700_000_000_000,
      payee: '',
      note: '',
    }

    await expect(store.createTransaction(payload)).rejects.toMatchObject({
      code: 'ledger-malformed-response',
      transportOutcomeUnknown: false,
      requiresIdempotentReplay: true,
    })
    const firstKey = store.pendingCreate.value?.idempotencyKey
    expect(firstKey).toBeTruthy()
    expect(store.mutationState.value).toBe('UNCERTAIN')
    expect(JSON.parse(sessionStorage.getItem('docus.ledger.pending-create') ?? '{}')).toMatchObject({
      idempotencyKey: firstKey,
      canonicalPayload: payload,
    })

    api.createLedgerTransaction.mockResolvedValue({ id: 'tx-replayed', type: 'expense' })
    await store.retryPendingCreate()
    expect(api.createLedgerTransaction).toHaveBeenLastCalledWith(payload, firstKey)
    expect(store.pendingCreate.value).toBeNull()
    expect(sessionStorage.getItem('docus.ledger.pending-create')).toBeNull()
  })
})
