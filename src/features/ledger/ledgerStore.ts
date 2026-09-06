import { computed, reactive, ref, type ComputedRef } from 'vue'
import type {
  LedgerAccountCreateRequest,
  LedgerAccountDto,
  LedgerAccountTransactionsDto,
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

export interface LedgerOverviewRequestContext {
  readonly scope: LedgerOverviewScope
  readonly anchorDate: string | undefined
}

export type LedgerOverviewRefreshResult =
  | {
      readonly status: 'success'
      readonly requestEpoch: number
      readonly request: LedgerOverviewRequestContext
      readonly overview: LedgerOverviewDto
    }
  | {
      readonly status: 'error'
      readonly requestEpoch: number
      readonly request: LedgerOverviewRequestContext
      readonly error: LedgerApiError
    }
  | {
      readonly status: 'stale'
      readonly requestEpoch: number
      readonly request: LedgerOverviewRequestContext
    }

interface LedgerStoreState {
  settings: LedgerSettingsDto | null
  accounts: LedgerAccountDto[]
  categories: LedgerCategoryDto[]
  overview: LedgerOverviewDto | null
  overviewDataReady: boolean
  overviewScope: LedgerOverviewScope
  overviewRequestedAnchorDate: string | undefined
  transactions: LedgerTransactionPageDto | null
  accountDetail: LedgerAccountDto | null
  accountTransactions: LedgerAccountTransactionsDto | null
  workspaceState: LedgerWorkspaceState
  workspaceLoading: boolean
  overviewLoading: boolean
  transactionsLoading: boolean
  workspaceError: LedgerApiError | null
  overviewError: LedgerApiError | null
  transactionsError: LedgerApiError | null
  mutationError: LedgerApiError | null
  transactionQuery: LedgerTransactionQuery
  mutationState: LedgerMutationState
  pendingCreate: LedgerPendingCreateIntent | null
  recoveryState: LedgerRecoveryState
  recoveryBlockedReason: string | null
  recoveryGateActive: boolean
  /**
   * Three independent request lifecycles. The Workspace lifecycle owns the
   * current-state dependency (Settings, Accounts, Categories) and therefore
   * `workspaceState`; the Overview lifecycle owns the historical projection
   * read. They must not share a generation counter: a period navigation
   * refresh would otherwise cancel an in-flight Workspace bootstrap and leave
   * the workspace in BOOTSTRAPPING forever.
   */
  workspaceEpoch: number
  overviewEpoch: number
  transactionsEpoch: number
}

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
  overviewDataReady: false,
  overviewScope: 'month',
  overviewRequestedAnchorDate: undefined,
  transactions: null,
  accountDetail: null,
  accountTransactions: null,
  workspaceState: 'BOOTSTRAPPING',
  workspaceLoading: false,
  overviewLoading: false,
  transactionsLoading: false,
  workspaceError: null,
  overviewError: null,
  transactionsError: null,
  mutationError: null,
  transactionQuery: { type: 'all', limit: 50 },
  mutationState: initialPending ? 'UNCERTAIN' : 'IDLE',
  pendingCreate: initialPending,
  recoveryState: initialRecoveryState,
  recoveryBlockedReason: initialRecovery.status === 'invalid' ? initialRecovery.reason : null,
  recoveryGateActive: initialRecovery.status === 'valid' || initialRecovery.status === 'invalid',
  workspaceEpoch: 0,
  overviewEpoch: 0,
  transactionsEpoch: 0,
})

const ownerIdentity = ref<string | null>(null)
let bootstrapPromise: Promise<LedgerOverviewRefreshResult | undefined> | null = null

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

function isWorkspaceCurrent(epoch: number): boolean {
  return state.workspaceEpoch === epoch
}

function isOverviewCurrent(epoch: number): boolean {
  return state.overviewEpoch === epoch
}

function isTransactionsCurrent(epoch: number): boolean {
  return state.transactionsEpoch === epoch
}

function beginWorkspaceRequest(): number {
  const epoch = state.workspaceEpoch + 1
  state.workspaceEpoch = epoch
  return epoch
}

function beginOverviewRequest(): number {
  const epoch = state.overviewEpoch + 1
  state.overviewEpoch = epoch
  return epoch
}

function beginTransactionsRequest(): number {
  const epoch = state.transactionsEpoch + 1
  state.transactionsEpoch = epoch
  return epoch
}

function currentOverviewRequest(): LedgerOverviewRequestContext {
  return {
    scope: state.overviewScope,
    anchorDate: state.overviewRequestedAnchorDate,
  }
}

function staleOverviewResult(
  requestEpoch: number,
  request: LedgerOverviewRequestContext,
): LedgerOverviewRefreshResult {
  return { status: 'stale', requestEpoch, request }
}

function errorOverviewResult(
  requestEpoch: number,
  request: LedgerOverviewRequestContext,
  error: LedgerApiError,
): LedgerOverviewRefreshResult {
  return { status: 'error', requestEpoch, request, error }
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
  state.overviewDataReady = false
  state.transactions = null
  state.accountDetail = null
  state.accountTransactions = null
  state.workspaceError = null
  state.overviewError = null
  state.transactionsError = null
  state.mutationError = null
  state.workspaceLoading = false
  state.overviewLoading = false
  state.transactionsLoading = false
  state.workspaceState = 'BOOTSTRAPPING'
  state.mutationState = state.recoveryState === 'PENDING' ? 'UNCERTAIN' : state.recoveryState === 'BLOCKED' ? 'ERROR' : 'IDLE'
}

/**
 * Phase A of a workspace load: the current-state dependency. Accounts and
 * Categories describe the Current Snapshot, never a historical period, so a
 * failure here is a workspace recovery boundary and must not be reported as a
 * period-only projection error.
 */
type LedgerCurrentStateResult =
  | { readonly status: 'published' }
  | { readonly status: 'stale' }
  | { readonly status: 'error'; readonly error: LedgerApiError }

async function refreshCurrentState(
  epoch: number,
  settings: LedgerSettingsDto,
): Promise<LedgerCurrentStateResult> {
  try {
    const [accounts, categories] = await Promise.all([
      listLedgerAccounts(true),
      listLedgerCategories(undefined, true),
    ])
    if (!isWorkspaceCurrent(epoch)) return { status: 'stale' }
    state.settings = settings
    state.accounts = accounts
    state.categories = categories
    state.workspaceState = lifecycleFor(settings, accounts)
    // The request-level error was already cleared when this request started.
    // Clearing it again here could discard a newer Overview request's error.
    return { status: 'published' }
  } catch (error) {
    const normalized = normalizeLedgerError(error)
    if (!isWorkspaceCurrent(epoch)) return { status: 'stale' }
    state.workspaceError = normalized
    state.workspaceState = 'RECOVERABLE_ERROR'
    return { status: 'error', error: normalized }
  } finally {
    if (isWorkspaceCurrent(epoch)) state.workspaceLoading = false
  }
}

/**
 * Phase B of a workspace load: the historical projection read. Only this read
 * may degrade into a period-only error, and only while the Workspace itself is
 * already usable — `failurePolicy` carries that decision from the caller.
 */
type LedgerOverviewFailurePolicy = 'workspace-error' | 'period-only'

async function refreshOverviewPhase(
  epoch: number,
  request: LedgerOverviewRequestContext,
  failurePolicy: LedgerOverviewFailurePolicy,
): Promise<LedgerOverviewRefreshResult> {
  // A newer Overview request already owns this lifecycle. Sending a request
  // whose result could never be published would only waste it.
  if (!isOverviewCurrent(epoch)) return staleOverviewResult(epoch, request)
  try {
    const overview = await getLedgerOverview(request)
    if (!isOverviewCurrent(epoch)) return staleOverviewResult(epoch, request)
    state.overview = overview
    state.overviewDataReady = true
    state.overviewScope = request.scope
    state.overviewRequestedAnchorDate = request.anchorDate
    state.overviewError = null
    return {
      status: 'success',
      requestEpoch: epoch,
      request,
      overview,
    }
  } catch (error) {
    const normalized = normalizeLedgerError(error)
    if (!isOverviewCurrent(epoch)) return staleOverviewResult(epoch, request)
    state.overviewDataReady = false
    state.overviewError = normalized
    // A future anchor is a route-level validation outcome. LedgerView owns the
    // canonicalization to today, so it must not turn an otherwise usable
    // workspace into a workspace recovery state while that route correction is
    // in flight. Other Overview failures keep the caller's requested recovery
    // boundary (mutation/bootstrap versus period-only).
    const isFutureAnchorValidation = normalized.code === 'ledger-validation-failed'
      && normalized.details?.field === 'anchorDate'
    if (failurePolicy === 'workspace-error' && !isFutureAnchorValidation) {
      state.workspaceState = 'RECOVERABLE_ERROR'
    }
    return errorOverviewResult(epoch, request, normalized)
  } finally {
    if (isOverviewCurrent(epoch)) state.overviewLoading = false
  }
}

async function bootstrap(): Promise<LedgerOverviewRefreshResult | undefined> {
  if (bootstrapPromise) return bootstrapPromise
  const workspaceEpoch = beginWorkspaceRequest()
  const overviewEpoch = beginOverviewRequest()
  const request = currentOverviewRequest()
  state.workspaceLoading = true
  state.overviewLoading = true
  state.workspaceError = null
  state.overviewError = null
  state.overviewDataReady = false
  state.workspaceState = 'BOOTSTRAPPING'
  applyRecoveryReadResult(readLedgerPendingCreate())

  const pendingRequest = (async (): Promise<LedgerOverviewRefreshResult | undefined> => {
    try {
      let settings: LedgerSettingsDto
      try {
        settings = await getLedgerSettings()
      } catch (error) {
        const normalized = normalizeLedgerError(error)
        if (normalized.code === 'ledger-not-found') {
          if (isWorkspaceCurrent(workspaceEpoch)) {
            state.settings = null
            state.accounts = []
            state.categories = []
            state.transactions = null
            state.workspaceState = 'UNINITIALIZED'
            state.workspaceError = null
          }
          if (isOverviewCurrent(overviewEpoch)) {
            state.overview = null
            state.overviewDataReady = false
          }
          return undefined
        }
        if (!isWorkspaceCurrent(workspaceEpoch)) return staleOverviewResult(overviewEpoch, request)
        state.workspaceError = normalized
        state.workspaceState = 'RECOVERABLE_ERROR'
        if (isOverviewCurrent(overviewEpoch)) state.overviewDataReady = false
        return errorOverviewResult(overviewEpoch, request, normalized)
      }
      if (!isWorkspaceCurrent(workspaceEpoch)) return staleOverviewResult(overviewEpoch, request)

      const currentState = await refreshCurrentState(workspaceEpoch, settings)
      if (currentState.status === 'stale') return staleOverviewResult(overviewEpoch, request)
      // A current-state failure is already published as a workspace recovery
      // state. It is reported back with the same envelope so route callers can
      // tell a completed request from a superseded one.
      if (currentState.status === 'error') return errorOverviewResult(overviewEpoch, request, currentState.error)

      // The Workspace lifecycle is complete at this point. A period navigation
      // that superseded this Overview request can no longer strand it.
      return await refreshOverviewPhase(overviewEpoch, request, 'workspace-error')
    } finally {
      if (isWorkspaceCurrent(workspaceEpoch)) state.workspaceLoading = false
      if (isOverviewCurrent(overviewEpoch)) state.overviewLoading = false
    }
  })()
  bootstrapPromise = pendingRequest
  try {
    return await pendingRequest
  } finally {
    if (bootstrapPromise === pendingRequest) bootstrapPromise = null
  }
}

async function refreshData(): Promise<void> {
  const settings = state.settings
  if (!settings) {
    await bootstrap()
    return
  }
  const workspaceEpoch = beginWorkspaceRequest()
  const overviewEpoch = beginOverviewRequest()
  const request = currentOverviewRequest()
  state.workspaceLoading = true
  state.overviewLoading = true
  state.workspaceError = null
  state.overviewError = null
  state.overviewDataReady = false
  try {
    // Phase A — the Current Snapshot's own dependency.
    const currentState = await refreshCurrentState(workspaceEpoch, settings)
    if (currentState.status !== 'published') return

    // Phase B — the historical projection. This is a mutation refresh, not a
    // read-only navigation refresh. If the projection cannot be refreshed,
    // the just-refreshed Current Snapshot must not remain behind stale
    // projection data, so the workspace enters its recovery boundary.
    const overviewResult = await refreshOverviewPhase(
      overviewEpoch,
      request,
      'workspace-error',
    )
    if (overviewResult.status !== 'success') return

    // Phase C — the transaction page, only when one is already presented.
    if (state.transactions !== null) {
      const transactionsEpoch = beginTransactionsRequest()
      state.transactionsLoading = true
      state.transactionsError = null
      try {
        const page = await listLedgerTransactions(state.transactionQuery)
        if (isTransactionsCurrent(transactionsEpoch)) state.transactions = page
      } catch (error) {
        if (!isTransactionsCurrent(transactionsEpoch)) return
        state.transactionsError = normalizeLedgerError(error)
      } finally {
        if (isTransactionsCurrent(transactionsEpoch)) state.transactionsLoading = false
      }
    }
  } finally {
    if (isWorkspaceCurrent(workspaceEpoch)) state.workspaceLoading = false
    if (isOverviewCurrent(overviewEpoch)) state.overviewLoading = false
  }
}

async function refreshOverview(): Promise<LedgerOverviewRefreshResult> {
  const epoch = beginOverviewRequest()
  const request = currentOverviewRequest()
  state.overviewLoading = true
  state.overviewError = null
  state.overviewDataReady = false
  // A period navigation refresh never owns the Workspace lifecycle, so it can
  // neither cancel a running bootstrap nor report a workspace failure.
  return refreshOverviewPhase(epoch, request, 'period-only')
}

function setOverviewRequestContext(context: LedgerOverviewRequestContext): void {
  state.overviewScope = context.scope
  state.overviewRequestedAnchorDate = context.anchorDate
  state.overviewDataReady = false
  state.overviewError = null
}

async function refreshTransactions(query: LedgerTransactionQuery = state.transactionQuery): Promise<void> {
  const epoch = beginTransactionsRequest()
  state.transactionQuery = { ...query }
  state.transactionsLoading = true
  state.transactionsError = null
  try {
    const page = await listLedgerTransactions(query)
    if (isTransactionsCurrent(epoch)) state.transactions = page
  } catch (error) {
    if (isTransactionsCurrent(epoch)) state.transactionsError = normalizeLedgerError(error)
  } finally {
    if (isTransactionsCurrent(epoch)) state.transactionsLoading = false
  }
}

async function loadMoreTransactions(): Promise<void> {
  const current = state.transactions
  const cursor = current?.page.nextCursor
  if (!current || !cursor) return
  const epoch = beginTransactionsRequest()
  state.transactionsLoading = true
  state.transactionsError = null
  try {
    const page = await listLedgerTransactions({ ...state.transactionQuery, cursor })
    if (!isTransactionsCurrent(epoch)) return
    state.transactions = {
      transactions: [...current.transactions, ...page.transactions],
      page: page.page,
    }
  } catch (error) {
    if (isTransactionsCurrent(epoch)) state.transactionsError = normalizeLedgerError(error)
  } finally {
    if (isTransactionsCurrent(epoch)) state.transactionsLoading = false
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
    state.mutationError = blocked
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
    state.mutationError = storageError
    state.mutationState = 'ERROR'
    throw storageError
  }
  state.pendingCreate = intent
  state.recoveryState = 'PENDING'
  state.recoveryBlockedReason = null
  state.recoveryGateActive = false
  state.mutationError = null
  state.mutationState = 'SUBMITTING'
  try {
    const result = await request(intent.idempotencyKey)
    clearLedgerPendingCreate()
    state.pendingCreate = null
    state.recoveryState = 'NONE'
    state.recoveryBlockedReason = null
    state.recoveryGateActive = false
    state.mutationError = null
    state.mutationState = 'CONFIRMED'
    await refreshData()
    return result
  } catch (error) {
    const normalized = normalizeLedgerError(error)
    if (shouldKeepPendingCreate(normalized)) {
      state.recoveryGateActive = true
      state.mutationState = 'UNCERTAIN'
      state.mutationError = normalized
      // Keep the exact record and payload. The user must replay this intent.
    } else {
      clearLedgerPendingCreate()
      state.pendingCreate = null
      state.recoveryState = 'NONE'
      state.recoveryBlockedReason = null
      state.recoveryGateActive = false
      state.mutationState = 'ERROR'
      state.mutationError = normalized
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
    state.mutationError = null
    state.mutationState = 'CONFIRMED'
    await refreshData()
    return result
  } catch (error) {
    const normalized = normalizeLedgerError(error)
    if (shouldKeepPendingCreate(normalized)) {
      state.recoveryGateActive = true
      state.mutationState = 'UNCERTAIN'
      state.mutationError = normalized
    } else {
      clearLedgerPendingCreate()
      state.pendingCreate = null
      state.recoveryState = 'NONE'
      state.recoveryBlockedReason = null
      state.recoveryGateActive = false
      state.mutationState = 'ERROR'
      state.mutationError = normalized
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
const overviewRequestContext = computed<LedgerOverviewRequestContext>(() => currentOverviewRequest())
const overviewMatchesRequest = computed(() => {
  const overview = state.overview
  if (!state.overviewDataReady || overview === null || overview.context.scope !== state.overviewScope) return false
  if (state.overviewRequestedAnchorDate === undefined) return overview.context.isToday
  return overview.context.anchorDate === state.overviewRequestedAnchorDate
})

export interface LedgerStore {
  readonly settings: ComputedRef<LedgerSettingsDto | null>
  readonly accounts: ComputedRef<readonly LedgerAccountDto[]>
  readonly activeAccounts: ComputedRef<readonly LedgerAccountDto[]>
  readonly archivedAccounts: ComputedRef<readonly LedgerAccountDto[]>
  readonly categories: ComputedRef<readonly LedgerCategoryDto[]>
  readonly activeCategories: ComputedRef<readonly LedgerCategoryDto[]>
  readonly archivedCategories: ComputedRef<readonly LedgerCategoryDto[]>
  readonly overview: ComputedRef<LedgerOverviewDto | null>
  readonly overviewDataReady: ComputedRef<boolean>
  readonly overviewScope: ComputedRef<LedgerOverviewScope>
  readonly overviewRequestedAnchorDate: ComputedRef<string | undefined>
  readonly overviewRequestContext: ComputedRef<LedgerOverviewRequestContext>
  readonly overviewMatchesRequest: ComputedRef<boolean>
  readonly transactions: ComputedRef<LedgerTransactionPageDto | null>
  readonly accountDetail: ComputedRef<LedgerAccountDto | null>
  readonly accountTransactions: ComputedRef<LedgerAccountTransactionsDto | null>
  readonly workspaceState: ComputedRef<LedgerWorkspaceState>
  readonly workspaceLoading: ComputedRef<boolean>
  readonly overviewLoading: ComputedRef<boolean>
  readonly transactionsLoading: ComputedRef<boolean>
  readonly workspaceError: ComputedRef<LedgerApiError | null>
  readonly overviewError: ComputedRef<LedgerApiError | null>
  readonly transactionsError: ComputedRef<LedgerApiError | null>
  readonly loading: ComputedRef<boolean>
  readonly error: ComputedRef<LedgerApiError | null>
  readonly transactionQuery: ComputedRef<LedgerTransactionQuery>
  readonly mutationState: ComputedRef<LedgerMutationState>
  readonly pendingCreate: ComputedRef<LedgerPendingCreateIntent | null>
  readonly recoveryState: ComputedRef<LedgerRecoveryState>
  readonly recoveryBlockedReason: ComputedRef<string | null>
  readonly hasUnresolvedCreate: ComputedRef<boolean>
  readonly recoveryGateVisible: ComputedRef<boolean>
  readonly bootstrap: () => Promise<LedgerOverviewRefreshResult | undefined>
  readonly refreshData: () => Promise<void>
  readonly setOverviewRequestContext: (context: LedgerOverviewRequestContext) => void
  readonly refreshOverview: () => Promise<LedgerOverviewRefreshResult>
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
  overviewDataReady: computed(() => state.overviewDataReady),
  overviewScope: computed(() => state.overviewScope),
  overviewRequestedAnchorDate: computed(() => state.overviewRequestedAnchorDate),
  overviewRequestContext,
  overviewMatchesRequest,
  transactions: computed(() => state.transactions),
  accountDetail: computed(() => state.accountDetail),
  accountTransactions: computed(() => state.accountTransactions),
  workspaceState: computed(() => state.workspaceState),
  workspaceLoading: computed(() => state.workspaceLoading),
  overviewLoading: computed(() => state.overviewLoading),
  transactionsLoading: computed(() => state.transactionsLoading),
  workspaceError: computed(() => state.workspaceError),
  overviewError: computed(() => state.overviewError),
  transactionsError: computed(() => state.transactionsError),
  loading: computed(() => state.workspaceLoading || state.overviewLoading),
  error: computed(() => state.workspaceError ?? state.overviewError ?? state.transactionsError ?? state.mutationError),
  transactionQuery: computed(() => state.transactionQuery),
  mutationState: computed(() => state.mutationState),
  pendingCreate: computed(() => state.pendingCreate),
  recoveryState: computed(() => state.recoveryState),
  recoveryBlockedReason: computed(() => state.recoveryBlockedReason),
  hasUnresolvedCreate: computed(() => state.recoveryState !== 'NONE'),
  recoveryGateVisible: computed(() => state.recoveryGateActive),
  bootstrap,
  refreshData,
  setOverviewRequestContext,
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
  state.overviewDataReady = false
  state.overviewScope = 'month'
  state.overviewRequestedAnchorDate = undefined
  state.transactions = null
  state.accountDetail = null
  state.accountTransactions = null
  state.workspaceState = 'BOOTSTRAPPING'
  state.workspaceLoading = false
  state.overviewLoading = false
  state.transactionsLoading = false
  state.workspaceError = null
  state.overviewError = null
  state.transactionsError = null
  state.mutationError = null
  state.transactionQuery = { type: 'all', limit: 50 }
  state.mutationState = 'IDLE'
  state.pendingCreate = null
  state.recoveryState = 'NONE'
  state.recoveryBlockedReason = null
  state.recoveryGateActive = false
  state.workspaceEpoch = 0
  state.overviewEpoch = 0
  state.transactionsEpoch = 0
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
