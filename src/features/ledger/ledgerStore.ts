import { computed, reactive, ref, type ComputedRef } from 'vue'
import type {
  LedgerAccountCreateRequest,
  LedgerAccountDto,
  LedgerCategoryCreateRequest,
  LedgerCategoryDto,
  LedgerExpenseCreateRequest,
  LedgerIncomeCreateRequest,
  LedgerOverviewDto,
  LedgerOverviewScope,
  LedgerSettingsCreateRequest,
  LedgerSettingsDto,
  LedgerTransactionDto,
  LedgerTransactionPageDto,
  LedgerTransactionQuery,
  LedgerTransferCreateRequest,
} from '../../../shared/ledgerProtocol'
import { subscribeAuthSessionRequired } from '../../lib/auth-session'
import {
  archiveLedgerAccount,
  archiveLedgerCategory,
  createLedgerAccount,
  createLedgerCategory,
  createLedgerSettings,
  createLedgerTransaction,
  deleteLedgerAccount,
  deleteLedgerCategory,
  deleteLedgerTransaction,
  getLedgerAccount,
  getLedgerAccountTransactions,
  getLedgerOverview,
  getLedgerSettings,
  getLedgerTransaction,
  listLedgerAccounts,
  listLedgerCategories,
  listLedgerTransactions,
  patchLedgerAccount,
  patchLedgerCategory,
  patchLedgerSettings,
  patchLedgerTransaction,
  restoreLedgerAccount,
  restoreLedgerCategory,
  type LedgerAccountPatchInput,
  type LedgerCategoryPatchInput,
  type LedgerDeletedResponse,
  type LedgerTransactionPatchInput,
} from './api'
import {
  LedgerApiError,
  normalizeLedgerError,
  shouldKeepPendingCreate,
} from './ledgerErrors'
import {
  clearLedgerPendingCreate,
  createLedgerPendingIntent,
  readLedgerPendingCreate,
  type LedgerCreateOperation,
  type LedgerCreatePayload,
  type LedgerPendingCreateIntent,
  type LedgerPendingCreateReadResult,
  writeLedgerPendingCreate,
} from './recovery'

export type LedgerWorkspaceState =
  | 'BOOTSTRAPPING'
  | 'UNINITIALIZED'
  | 'FIRST_ACCOUNT_REQUIRED'
  | 'NO_ACTIVE_ACCOUNT'
  | 'READY'
  | 'RECOVERABLE_ERROR'

export type LedgerMutationState = 'IDLE' | 'SUBMITTING' | 'CONFIRMED' | 'ERROR' | 'UNCERTAIN'
export type LedgerRecoveryState = 'NONE' | 'PENDING' | 'BLOCKED'

interface LedgerStoreState {
  settings: LedgerSettingsDto | null
  accounts: LedgerAccountDto[]
  categories: LedgerCategoryDto[]
  overview: LedgerOverviewDto | null
  overviewScope: LedgerOverviewScope
  transactions: LedgerTransactionPageDto | null
  accountDetail: LedgerAccountDto | null
  accountTransactions: LedgerAccountTransactionsDto | null
  workspaceState: LedgerWorkspaceState
  loading: boolean
  error: LedgerApiError | null
  transactionQuery: LedgerTransactionQuery
  mutationState: LedgerMutationState
  pendingCreate: LedgerPendingCreateIntent | null
  recoveryState: LedgerRecoveryState
  recoveryBlockedReason: string | null
  recoveryGateActive: boolean
  requestEpoch: number
}

// Importing this type locally avoids making the store's public state wider
// than the shared transport contract.
import type { LedgerAccountTransactionsDto } from '../../../shared/ledgerProtocol'

const initialRecovery = readLedgerPendingCreate()
const initialPending = initialRecovery.status === 'valid' ? initialRecovery.intent : null
const initialRecoveryState: LedgerRecoveryState = initialRecovery.status === 'valid'
  ? 'PENDING'
  : initialRecovery.status === 'invalid' ? 'BLOCKED' : 'NONE'
const state = reactive<LedgerStoreState>({
  settings: null,
  accounts: [],
  categories: [],
  overview: null,
  overviewScope: 'month',
  transactions: null,
  accountDetail: null,
  accountTransactions: null,
  workspaceState: 'BOOTSTRAPPING',
  loading: false,
  error: null,
  transactionQuery: { type: 'all', limit: 50 },
  mutationState: initialPending ? 'UNCERTAIN' : 'IDLE',
  pendingCreate: initialPending,
  recoveryState: initialRecoveryState,
  recoveryBlockedReason: initialRecovery.status === 'invalid' ? initialRecovery.reason : null,
  recoveryGateActive: initialRecovery.status === 'valid' || initialRecovery.status === 'invalid',
  requestEpoch: 0,
})

const ownerIdentity = ref<string | null>(null)
let bootstrapPromise: Promise<void> | null = null

function activeAccounts(accounts: readonly LedgerAccountDto[]): LedgerAccountDto[] {
  return accounts.filter((account) => account.archivedAt === null)
}

function archivedAccounts(accounts: readonly LedgerAccountDto[]): LedgerAccountDto[] {
  return accounts.filter((account) => account.archivedAt !== null)
}

function lifecycleFor(settings: LedgerSettingsDto, accounts: readonly LedgerAccountDto[]): LedgerWorkspaceState {
  const active = activeAccounts(accounts)
  if (active.length > 0) return 'READY'
  return settings.hasCreatedAccount ? 'NO_ACTIVE_ACCOUNT' : 'FIRST_ACCOUNT_REQUIRED'
}

function generatedIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isCurrent(epoch: number): boolean {
  return state.requestEpoch === epoch
}

function applyRecoveryReadResult(result: LedgerPendingCreateReadResult): void {
  switch (result.status) {
    case 'valid':
      state.pendingCreate = result.intent
      state.recoveryState = 'PENDING'
      state.recoveryBlockedReason = null
      state.recoveryGateActive = true
      state.mutationState = 'UNCERTAIN'
      return
    case 'invalid':
      // Keep the record in storage. Removing an untrusted record would make a
      // later reload look safe and allow a duplicate create intent.
      state.pendingCreate = null
      state.recoveryState = 'BLOCKED'
      state.recoveryBlockedReason = result.reason
      state.recoveryGateActive = true
      state.mutationState = 'ERROR'
      return
    case 'none':
      if (state.pendingCreate) {
        state.recoveryState = 'BLOCKED'
        state.recoveryBlockedReason = 'A previously loaded Ledger create intent is missing from sessionStorage.'
        state.recoveryGateActive = true
        state.mutationState = 'ERROR'
      } else {
        state.recoveryState = 'NONE'
        state.recoveryBlockedReason = null
        state.recoveryGateActive = false
        state.mutationState = 'IDLE'
      }
      return
    case 'unavailable':
      // A valid in-memory pending intent remains safer than discarding it. If
      // there is no record, the create boundary will refuse new mutations
      // when it cannot persist a snapshot.
      if (!state.pendingCreate && state.recoveryState !== 'BLOCKED') {
        state.recoveryState = 'NONE'
        state.recoveryBlockedReason = null
        state.recoveryGateActive = false
        state.mutationState = 'IDLE'
      }
  }
}

function clearPresentation(): void {
  state.settings = null
  state.accounts = []
  state.categories = []
  state.overview = null
  state.transactions = null
  state.accountDetail = null
  state.accountTransactions = null
  state.error = null
  state.loading = false
  state.workspaceState = 'BOOTSTRAPPING'
  state.mutationState = state.recoveryState === 'PENDING' ? 'UNCERTAIN' : state.recoveryState === 'BLOCKED' ? 'ERROR' : 'IDLE'
}

async function loadData(
  epoch: number,
  settings: LedgerSettingsDto,
  overviewScope: LedgerOverviewScope = state.overviewScope,
): Promise<void> {
  const [accounts, categories, overview] = await Promise.all([
    listLedgerAccounts(true),
    listLedgerCategories(undefined, true),
    getLedgerOverview(overviewScope),
  ])
  if (!isCurrent(epoch)) return
  state.settings = settings
  state.accounts = accounts
  state.categories = categories
  state.overview = overview
  state.overviewScope = overviewScope
  state.workspaceState = lifecycleFor(settings, accounts)
  state.error = null
}

async function bootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  const epoch = state.requestEpoch + 1
  state.requestEpoch = epoch
  state.loading = true
  state.error = null
  state.workspaceState = 'BOOTSTRAPPING'
  applyRecoveryReadResult(readLedgerPendingCreate())

  const pendingRequest = (async () => {
    try {
      let settings: LedgerSettingsDto
      try {
        settings = await getLedgerSettings()
      } catch (error) {
        const normalized = normalizeLedgerError(error)
        if (normalized.code === 'ledger-not-found') {
          if (isCurrent(epoch)) {
            state.settings = null
            state.accounts = []
            state.categories = []
            state.overview = null
            state.transactions = null
            state.workspaceState = 'UNINITIALIZED'
            state.error = null
          }
          return
        }
        throw normalized
      }
      if (!isCurrent(epoch)) return
      await loadData(epoch, settings)
    } catch (error) {
      if (!isCurrent(epoch)) return
      state.error = normalizeLedgerError(error)
      state.workspaceState = 'RECOVERABLE_ERROR'
    } finally {
      if (isCurrent(epoch)) state.loading = false
    }
  })()
  bootstrapPromise = pendingRequest
  try {
    await pendingRequest
  } finally {
    if (bootstrapPromise === pendingRequest) bootstrapPromise = null
  }
}

async function refreshData(): Promise<void> {
  if (!state.settings) return bootstrap()
  const epoch = state.requestEpoch + 1
  state.requestEpoch = epoch
  state.loading = true
  state.error = null
  try {
    await loadData(epoch, state.settings, state.overviewScope)
    if (state.transactions !== null) {
      state.transactions = await listLedgerTransactions(state.transactionQuery)
    }
  } catch (error) {
    if (!isCurrent(epoch)) return
    state.error = normalizeLedgerError(error)
    state.workspaceState = 'RECOVERABLE_ERROR'
  } finally {
    if (isCurrent(epoch)) state.loading = false
  }
}

async function refreshOverview(scope: LedgerOverviewScope): Promise<void> {
  const epoch = state.requestEpoch + 1
  state.requestEpoch = epoch
  state.loading = true
  state.error = null
  try {
    const overview = await getLedgerOverview(scope)
    if (!isCurrent(epoch)) return
    state.overview = overview
    state.overviewScope = scope
  } catch (error) {
    if (!isCurrent(epoch)) return
    state.error = normalizeLedgerError(error)
  } finally {
    if (isCurrent(epoch)) state.loading = false
  }
}

async function refreshTransactions(query: LedgerTransactionQuery = state.transactionQuery): Promise<void> {
  const epoch = state.requestEpoch + 1
  state.requestEpoch = epoch
  state.transactionQuery = { ...query }
  state.error = null
  try {
    const page = await listLedgerTransactions(query)
    if (isCurrent(epoch)) state.transactions = page
  } catch (error) {
    if (isCurrent(epoch)) state.error = normalizeLedgerError(error)
  }
}

async function loadMoreTransactions(): Promise<void> {
  const current = state.transactions
  const cursor = current?.page.nextCursor
  if (!current || !cursor) return
  const epoch = state.requestEpoch + 1
  state.requestEpoch = epoch
  state.error = null
  try {
    const page = await listLedgerTransactions({ ...state.transactionQuery, cursor })
    if (!isCurrent(epoch)) return
    state.transactions = {
      transactions: [...current.transactions, ...page.transactions],
      page: page.page,
    }
  } catch (error) {
    if (isCurrent(epoch)) state.error = normalizeLedgerError(error)
  }
}

async function beginCreate<T>(
  operation: LedgerCreateOperation,
  payload: LedgerCreatePayload,
  request: (key: string) => Promise<T>,
): Promise<T> {
  if (state.recoveryState === 'BLOCKED') {
    const blocked = new LedgerApiError(
      'An unverified Ledger create record blocks new creates.',
      409,
      'ledger-recovery-blocked',
    )
    state.error = blocked
    state.mutationState = 'ERROR'
    throw blocked
  }
  if (state.pendingCreate) {
    throw new LedgerApiError(
      'An unresolved Ledger create intent must be recovered first.',
      409,
      'ledger-pending-create-recovery',
    )
  }
  const intent = createLedgerPendingIntent(
    operation,
    payload,
    generatedIdempotencyKey(),
    ownerIdentity.value,
  )
  const persisted = writeLedgerPendingCreate(intent)
  if (!persisted.ok) {
    const storageError = new LedgerApiError(
      persisted.reason,
      0,
      'ledger-recovery-storage-unavailable',
    )
    state.error = storageError
    state.mutationState = 'ERROR'
    throw storageError
  }
  state.pendingCreate = intent
  state.recoveryState = 'PENDING'
  state.recoveryBlockedReason = null
  state.recoveryGateActive = false
  state.error = null
  state.mutationState = 'SUBMITTING'
  try {
    const result = await request(intent.idempotencyKey)
    clearLedgerPendingCreate()
    state.pendingCreate = null
    state.recoveryState = 'NONE'
    state.recoveryBlockedReason = null
    state.recoveryGateActive = false
    state.mutationState = 'CONFIRMED'
    await refreshData()
    return result
  } catch (error) {
    const normalized = normalizeLedgerError(error)
    if (shouldKeepPendingCreate(normalized)) {
      state.recoveryGateActive = true
      state.mutationState = 'UNCERTAIN'
      // Keep the exact record and payload. The user must replay this intent.
    } else {
      clearLedgerPendingCreate()
      state.pendingCreate = null
      state.recoveryState = 'NONE'
      state.recoveryBlockedReason = null
      state.recoveryGateActive = false
      state.mutationState = 'ERROR'
    }
    throw normalized
  }
}

async function retryPendingCreate(): Promise<unknown> {
  const intent = state.pendingCreate
  if (!intent) return null
  state.mutationState = 'SUBMITTING'
  try {
    let result: unknown
    switch (intent.operation) {
      case 'settings':
        result = await createLedgerSettings(intent.canonicalPayload as LedgerSettingsCreateRequest, intent.idempotencyKey)
        break
      case 'account':
        result = await createLedgerAccount(intent.canonicalPayload as LedgerAccountCreateRequest, intent.idempotencyKey)
        break
      case 'category':
        result = await createLedgerCategory(intent.canonicalPayload as LedgerCategoryCreateRequest, intent.idempotencyKey)
        break
      case 'transaction':
        result = await createLedgerTransaction(
          intent.canonicalPayload as LedgerIncomeCreateRequest | LedgerExpenseCreateRequest | LedgerTransferCreateRequest,
          intent.idempotencyKey,
        )
        break
    }
    clearLedgerPendingCreate()
    state.pendingCreate = null
    state.recoveryState = 'NONE'
    state.recoveryBlockedReason = null
    state.mutationState = 'CONFIRMED'
    await refreshData()
    return result
  } catch (error) {
    const normalized = normalizeLedgerError(error)
    if (shouldKeepPendingCreate(normalized)) {
      state.recoveryGateActive = true
      state.mutationState = 'UNCERTAIN'
    } else {
      clearLedgerPendingCreate()
      state.pendingCreate = null
      state.recoveryState = 'NONE'
      state.recoveryBlockedReason = null
      state.recoveryGateActive = false
      state.mutationState = 'ERROR'
    }
    throw normalized
  }
}

function setOwnerIdentity(identity: string | null): void {
  ownerIdentity.value = identity
  const pending = state.pendingCreate
  if (pending && pending.ownerIdentity !== null && identity !== null && pending.ownerIdentity !== identity) {
    // Do not replay a record created by another authenticated owner. It is
    // discarded only after the identity mismatch is known; no new intent is
    // generated automatically.
    clearLedgerPendingCreate()
    state.pendingCreate = null
    state.recoveryState = 'NONE'
    state.recoveryBlockedReason = null
    state.recoveryGateActive = false
    state.mutationState = 'IDLE'
  }
}

function dismissRecoveryGate(): void {
  if (state.pendingCreate === null && state.recoveryState === 'NONE') {
    state.recoveryGateActive = false
  }
}

const active = computed(() => activeAccounts(state.accounts))
const archived = computed(() => archivedAccounts(state.accounts))

export interface LedgerStore {
  readonly settings: ComputedRef<LedgerSettingsDto | null>
  readonly accounts: ComputedRef<readonly LedgerAccountDto[]>
  readonly activeAccounts: ComputedRef<readonly LedgerAccountDto[]>
  readonly archivedAccounts: ComputedRef<readonly LedgerAccountDto[]>
  readonly categories: ComputedRef<readonly LedgerCategoryDto[]>
  readonly activeCategories: ComputedRef<readonly LedgerCategoryDto[]>
  readonly archivedCategories: ComputedRef<readonly LedgerCategoryDto[]>
  readonly overview: ComputedRef<LedgerOverviewDto | null>
  readonly overviewScope: ComputedRef<LedgerOverviewScope>
  readonly transactions: ComputedRef<LedgerTransactionPageDto | null>
  readonly accountDetail: ComputedRef<LedgerAccountDto | null>
  readonly accountTransactions: ComputedRef<LedgerAccountTransactionsDto | null>
  readonly workspaceState: ComputedRef<LedgerWorkspaceState>
  readonly loading: ComputedRef<boolean>
  readonly error: ComputedRef<LedgerApiError | null>
  readonly transactionQuery: ComputedRef<LedgerTransactionQuery>
  readonly mutationState: ComputedRef<LedgerMutationState>
  readonly pendingCreate: ComputedRef<LedgerPendingCreateIntent | null>
  readonly recoveryState: ComputedRef<LedgerRecoveryState>
  readonly recoveryBlockedReason: ComputedRef<string | null>
  readonly hasUnresolvedCreate: ComputedRef<boolean>
  readonly recoveryGateVisible: ComputedRef<boolean>
  readonly bootstrap: () => Promise<void>
  readonly refreshData: () => Promise<void>
  readonly refreshOverview: (scope: LedgerOverviewScope) => Promise<void>
  readonly refreshTransactions: (query?: LedgerTransactionQuery) => Promise<void>
  readonly loadMoreTransactions: () => Promise<void>
  readonly getAccount: (id: string) => Promise<LedgerAccountDto>
  readonly getTransaction: (id: string) => Promise<LedgerTransactionDto>
  readonly getAccountTransactions: (id: string, query?: LedgerTransactionQuery) => Promise<LedgerAccountTransactionsDto>
  readonly createSettings: (body: LedgerSettingsCreateRequest) => Promise<LedgerSettingsDto>
  readonly patchSettings: (body: { expectedVersion: number; baseCurrency?: string; timezone?: string }) => Promise<LedgerSettingsDto>
  readonly createAccount: (body: LedgerAccountCreateRequest) => Promise<LedgerAccountDto>
  readonly patchAccount: (id: string, body: LedgerAccountPatchInput) => Promise<LedgerAccountDto>
  readonly archiveAccount: (id: string, expectedVersion: number) => Promise<LedgerAccountDto>
  readonly restoreAccount: (id: string, expectedVersion: number) => Promise<LedgerAccountDto>
  readonly deleteAccount: (id: string, expectedVersion: number) => Promise<LedgerDeletedResponse>
  readonly createCategory: (body: LedgerCategoryCreateRequest) => Promise<LedgerCategoryDto>
  readonly patchCategory: (id: string, body: LedgerCategoryPatchInput) => Promise<LedgerCategoryDto>
  readonly archiveCategory: (id: string, expectedVersion: number) => Promise<LedgerCategoryDto>
  readonly restoreCategory: (id: string, expectedVersion: number) => Promise<LedgerCategoryDto>
  readonly deleteCategory: (id: string, expectedVersion: number) => Promise<LedgerDeletedResponse>
  readonly createTransaction: (body: LedgerIncomeCreateRequest | LedgerExpenseCreateRequest | LedgerTransferCreateRequest) => Promise<LedgerTransactionDto>
  readonly patchTransaction: (id: string, body: LedgerTransactionPatchInput) => Promise<LedgerTransactionDto>
  readonly deleteTransaction: (id: string, expectedVersion: number) => Promise<LedgerTransactionDto>
  readonly retryPendingCreate: () => Promise<unknown>
  readonly dismissRecoveryGate: () => void
  readonly setOwnerIdentity: (identity: string | null) => void
}

const store: LedgerStore = {
  settings: computed(() => state.settings),
  accounts: computed(() => state.accounts),
  activeAccounts: active,
  archivedAccounts: archived,
  categories: computed(() => state.categories),
  activeCategories: computed(() => state.categories.filter((category) => category.archivedAt === null)),
  archivedCategories: computed(() => state.categories.filter((category) => category.archivedAt !== null)),
  overview: computed(() => state.overview),
  overviewScope: computed(() => state.overviewScope),
  transactions: computed(() => state.transactions),
  accountDetail: computed(() => state.accountDetail),
  accountTransactions: computed(() => state.accountTransactions),
  workspaceState: computed(() => state.workspaceState),
  loading: computed(() => state.loading),
  error: computed(() => state.error),
  transactionQuery: computed(() => state.transactionQuery),
  mutationState: computed(() => state.mutationState),
  pendingCreate: computed(() => state.pendingCreate),
  recoveryState: computed(() => state.recoveryState),
  recoveryBlockedReason: computed(() => state.recoveryBlockedReason),
  hasUnresolvedCreate: computed(() => state.recoveryState !== 'NONE'),
  recoveryGateVisible: computed(() => state.recoveryGateActive),
  bootstrap,
  refreshData,
  refreshOverview,
  refreshTransactions,
  loadMoreTransactions,
  getAccount: async (id) => {
    const result = await getLedgerAccount(id)
    state.accountDetail = result
    const index = state.accounts.findIndex((account) => account.id === result.id)
    if (index >= 0) state.accounts[index] = result
    else state.accounts.push(result)
    return result
  },
  getTransaction,
  getAccountTransactions: async (id, query = {}) => {
    const result = await getLedgerAccountTransactions(id, query)
    state.accountTransactions = result
    return result
  },
  createSettings: (body) => beginCreate('settings', body, (key) => createLedgerSettings(body, key)),
  patchSettings: async (body) => {
    const result = await patchLedgerSettings(body)
    await bootstrap()
    return result
  },
  createAccount: (body) => beginCreate('account', body, (key) => createLedgerAccount(body, key)),
  patchAccount: async (id, body) => { const result = await patchLedgerAccount(id, body); await refreshData(); return result },
  archiveAccount: async (id, version) => { const result = await archiveLedgerAccount(id, version); await refreshData(); return result },
  restoreAccount: async (id, version) => { const result = await restoreLedgerAccount(id, version); await refreshData(); return result },
  deleteAccount: async (id, version) => { const result = await deleteLedgerAccount(id, version); await refreshData(); return result },
  createCategory: (body) => beginCreate('category', body, (key) => createLedgerCategory(body, key)),
  patchCategory: async (id, body) => { const result = await patchLedgerCategory(id, body); await refreshData(); return result },
  archiveCategory: async (id, version) => { const result = await archiveLedgerCategory(id, version); await refreshData(); return result },
  restoreCategory: async (id, version) => { const result = await restoreLedgerCategory(id, version); await refreshData(); return result },
  deleteCategory: async (id, version) => { const result = await deleteLedgerCategory(id, version); await refreshData(); return result },
  createTransaction: (body) => beginCreate('transaction', body, (key) => createLedgerTransaction(body, key)),
  patchTransaction: async (id, body) => { const result = await patchLedgerTransaction(id, body); await refreshData(); return result },
  deleteTransaction: async (id, version) => { const result = await deleteLedgerTransaction(id, version); await refreshData(); return result },
  retryPendingCreate,
  dismissRecoveryGate,
  setOwnerIdentity,
}

export function useLedgerStore(): LedgerStore {
  return store
}

export function resetLedgerStoreForTesting(): void {
  state.settings = null
  state.accounts = []
  state.categories = []
  state.overview = null
  state.overviewScope = 'month'
  state.transactions = null
  state.accountDetail = null
  state.accountTransactions = null
  state.workspaceState = 'BOOTSTRAPPING'
  state.loading = false
  state.error = null
  state.transactionQuery = { type: 'all', limit: 50 }
  state.mutationState = 'IDLE'
  state.pendingCreate = null
  state.recoveryState = 'NONE'
  state.recoveryBlockedReason = null
  state.recoveryGateActive = false
  state.requestEpoch = 0
  bootstrapPromise = null
  ownerIdentity.value = null

  applyRecoveryReadResult(readLedgerPendingCreate())
}

subscribeAuthSessionRequired(() => {
  // Session expiry must reset only in-memory presentation. The pending create
  // record remains in sessionStorage for the same owner to recover after login.
  clearPresentation()
})

async function getTransaction(id: string): Promise<LedgerTransactionDto> {
  return getLedgerTransaction(id)
}
