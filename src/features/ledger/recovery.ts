import type {
  LedgerAccountCreateRequest,
  LedgerCategoryCreateRequest,
  LedgerSettingsCreateRequest,
  LedgerTransactionCreateRequest,
} from '../../../shared/ledgerProtocol'

export const LEDGER_PENDING_CREATE_STORAGE_KEY = 'docus.ledger.pending-create'
export const LEDGER_RECOVERY_SCHEMA_VERSION = 1 as const

export type LedgerCreateOperation = 'settings' | 'account' | 'category' | 'transaction'
export type LedgerCreatePayload =
  | LedgerSettingsCreateRequest
  | LedgerAccountCreateRequest
  | LedgerCategoryCreateRequest
  | LedgerTransactionCreateRequest

export interface LedgerPendingCreateIntent {
  readonly version: typeof LEDGER_RECOVERY_SCHEMA_VERSION
  readonly operation: LedgerCreateOperation
  readonly operationScope: string
  readonly idempotencyKey: string
  readonly canonicalPayload: LedgerCreatePayload
  readonly createdAt: number
  /** A non-secret owner hint prevents replay into a different owner session. */
  readonly ownerIdentity: string | null
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function storage(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isOperation(value: unknown): value is LedgerCreateOperation {
  return value === 'settings' || value === 'account' || value === 'category' || value === 'transaction'
}

function isSafePayload(value: unknown): value is LedgerCreatePayload {
  return isRecord(value) && Object.keys(value).every((key) => key.length > 0)
}

export function isLedgerPendingCreateIntent(value: unknown): value is LedgerPendingCreateIntent {
  if (!isRecord(value)) return false
  return value.version === LEDGER_RECOVERY_SCHEMA_VERSION
    && isOperation(value.operation)
    && typeof value.operationScope === 'string'
    && value.operationScope.length > 0
    && typeof value.idempotencyKey === 'string'
    && value.idempotencyKey.length > 0
    && isSafePayload(value.canonicalPayload)
    && typeof value.createdAt === 'number'
    && Number.isSafeInteger(value.createdAt)
    && (value.ownerIdentity === null || typeof value.ownerIdentity === 'string')
}

export function readLedgerPendingCreate(): LedgerPendingCreateIntent | null {
  const store = storage()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(LEDGER_PENDING_CREATE_STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isLedgerPendingCreateIntent(parsed)) {
      store.removeItem(LEDGER_PENDING_CREATE_STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    try { store.removeItem(LEDGER_PENDING_CREATE_STORAGE_KEY) } catch { /* fail closed */ }
    return null
  }
}

export function writeLedgerPendingCreate(intent: LedgerPendingCreateIntent): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(LEDGER_PENDING_CREATE_STORAGE_KEY, JSON.stringify(intent))
  } catch {
    // Storage may be blocked in private mode. The in-memory intent still
    // protects the current form; a hard reload cannot be made durable there.
  }
}

export function clearLedgerPendingCreate(): void {
  const store = storage()
  if (!store) return
  try { store.removeItem(LEDGER_PENDING_CREATE_STORAGE_KEY) } catch { /* ignore */ }
}

export function ledgerOperationScope(operation: LedgerCreateOperation): string {
  switch (operation) {
    case 'settings': return 'POST:/api/ledger/settings'
    case 'account': return 'POST:/api/ledger/accounts'
    case 'category': return 'POST:/api/ledger/categories'
    case 'transaction': return 'POST:/api/ledger/transactions'
  }
}

export function createLedgerPendingIntent(
  operation: LedgerCreateOperation,
  canonicalPayload: LedgerCreatePayload,
  idempotencyKey: string,
  ownerIdentity: string | null,
  createdAt = Date.now(),
): LedgerPendingCreateIntent {
  return {
    version: LEDGER_RECOVERY_SCHEMA_VERSION,
    operation,
    operationScope: ledgerOperationScope(operation),
    idempotencyKey,
    canonicalPayload,
    createdAt,
    ownerIdentity,
  }
}
