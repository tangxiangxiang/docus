import { createHash } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import type {
  LedgerAccountCreateRequest,
  LedgerAdjustmentEndpointRequest,
  LedgerCategoryCreateRequest,
  LedgerSettingsCreateRequest,
  LedgerTransactionCreateRequest,
} from '../../shared/ledgerProtocol.js'
import { LedgerError, ledgerValidationError } from './errors.js'
import {
  type LedgerIdempotencyRecord,
  type LedgerIdempotencyResultStatus,
  type LedgerRepository,
} from './repository.js'
import { runLedgerWrite } from './writeTransaction.js'

/** Canonical, already-parsed request DTOs accepted by Ledger create mutations. */
export type LedgerCanonicalMutation =
  | LedgerSettingsCreateRequest
  | LedgerAccountCreateRequest
  | LedgerCategoryCreateRequest
  | LedgerTransactionCreateRequest
  | LedgerAdjustmentEndpointRequest

export type LedgerJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly LedgerJsonValue[]
  | { readonly [key: string]: LedgerJsonValue }

export const LEDGER_IDEMPOTENCY_OPERATION_SCOPES = {
  settings: 'POST:/api/ledger/settings',
  accounts: 'POST:/api/ledger/accounts',
  categories: 'POST:/api/ledger/categories',
  transactions: 'POST:/api/ledger/transactions',
} as const

export function ledgerAccountAdjustmentOperationScope(accountId: string): string {
  return `POST:/api/ledger/accounts/${accountId}/adjust`
}

function serializationError(message: string): never {
  throw new TypeError(`Ledger JSON serialization rejected the value: ${message}`)
}

function assertDataProperty(value: object, key: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor === undefined || !('value' in descriptor)) {
    serializationError('accessor properties are not supported')
  }
}

function assertPlainObject(value: object): void {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    serializationError('only plain objects are supported')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    serializationError('symbol properties are not supported')
  }
}

function serializeLedgerJsonValue(value: unknown, activeObjects: Set<object>): string {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string': {
      const encoded = JSON.stringify(value)
      if (encoded === undefined) serializationError('string could not be encoded')
      return encoded
    }
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number': {
      if (!Number.isFinite(value)) serializationError('numbers must be finite')
      const encoded = JSON.stringify(value)
      if (encoded === undefined) serializationError('number could not be encoded')
      return encoded
    }
    case 'undefined':
      return serializationError('undefined is not supported')
    case 'bigint':
      return serializationError('bigint is not supported')
    case 'function':
      return serializationError('functions are not supported')
    case 'symbol':
      return serializationError('symbols are not supported')
    case 'object':
      break
    default:
      return serializationError('unsupported value type')
  }

  const objectValue = value as object
  if (activeObjects.has(objectValue)) serializationError('cyclic objects are not supported')
  activeObjects.add(objectValue)

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        serializationError('only ordinary arrays are supported')
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        serializationError('symbol properties are not supported')
      }
      const ownNames = Object.getOwnPropertyNames(value)
      const keys = Object.keys(value)
      if (ownNames.length !== keys.length + 1 || !ownNames.includes('length')) {
        serializationError('arrays may not have extra properties')
      }
      if (keys.length !== value.length) serializationError('sparse arrays are not supported')

      for (let index = 0; index < value.length; index += 1) {
        const key = String(index)
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          serializationError('sparse arrays are not supported')
        }
        assertDataProperty(value, key)
      }

      const serializedItems: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        serializedItems.push(serializeLedgerJsonValue(value[index], activeObjects))
      }
      return `[${serializedItems.join(',')}]`
    }

    assertPlainObject(objectValue)
    const ownNames = Object.getOwnPropertyNames(objectValue)
    const keys = Object.keys(objectValue)
    if (ownNames.length !== keys.length) {
      serializationError('non-enumerable properties are not supported')
    }

    return `{${keys.sort().map((key) => {
      assertDataProperty(objectValue, key)
      const encodedKey = JSON.stringify(key)
      if (encodedKey === undefined) serializationError('object key could not be encoded')
      return `${encodedKey}:${serializeLedgerJsonValue((objectValue as Record<string, unknown>)[key], activeObjects)}`
    }).join(',')}}`
  } finally {
    activeObjects.delete(objectValue)
  }
}

/** Serialize JSON-safe Ledger data with recursively sorted object keys. */
export function stableSerializeLedgerJson(value: unknown): string {
  return serializeLedgerJsonValue(value, new Set<object>())
}

/** Serialize a typed first-response body for durable Ledger replay. */
export function serializeLedgerReplayResponse<TResponseBody extends LedgerJsonValue>(
  responseBody: TResponseBody,
): string {
  return stableSerializeLedgerJson(responseBody)
}

/** Fingerprint an already parsed and normalized Ledger create request. */
export function fingerprintLedgerMutation(request: LedgerCanonicalMutation): string {
  return createHash('sha256')
    .update(stableSerializeLedgerJson(request), 'utf8')
    .digest('hex')
}

export type LedgerIdempotentResult<TResponseBody extends LedgerJsonValue> = {
  readonly resultStatus: LedgerIdempotencyResultStatus
  readonly responseStatus: 200 | 201
  readonly responseBody: TResponseBody
  readonly resultType?: string | null
  readonly resultId?: string | null
}

export interface LedgerReplayResult {
  readonly responseStatus: 200 | 201
  readonly responseBodyJson: string
  readonly replayed: boolean
}

type NonPromiseResult<T> = T extends PromiseLike<unknown> ? never : T

export interface ExecuteIdempotentLedgerCreateInput<
  TResponseBody extends LedgerJsonValue,
  TResult extends LedgerIdempotentResult<TResponseBody>,
> {
  readonly operationScope: string
  readonly idempotencyKey: string
  readonly request: LedgerCanonicalMutation
  readonly mutation: () => NonPromiseResult<TResult>
  /** Test-only failure seam; never supplied by an HTTP/API caller. */
  readonly afterMutationBeforeIdempotencyInsert?: () => void
  readonly createdAt?: number
}

function invalidExecution(message: string): never {
  throw ledgerValidationError(message)
}

function assertMutationResult<TResponseBody extends LedgerJsonValue>(
  value: unknown,
): asserts value is LedgerIdempotentResult<TResponseBody> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidExecution('Ledger idempotent mutation must return a result object')
  }

  const result = value as Record<string, unknown>
  if (result.resultStatus !== 'committed' && result.resultStatus !== 'no-op') {
    return invalidExecution('Ledger idempotent mutation returned an invalid result status')
  }
  const expectedResponseStatus = result.resultStatus === 'committed' ? 201 : 200
  if (result.responseStatus !== expectedResponseStatus) {
    return invalidExecution('Ledger idempotent mutation returned an invalid response status')
  }
  if (result.resultType !== undefined && result.resultType !== null && typeof result.resultType !== 'string') {
    return invalidExecution('Ledger idempotent mutation returned an invalid result type')
  }
  if (result.resultId !== undefined && result.resultId !== null && typeof result.resultId !== 'string') {
    return invalidExecution('Ledger idempotent mutation returned an invalid result id')
  }
}

function assertReplayStatus(status: number): asserts status is 200 | 201 {
  if (status !== 200 && status !== 201) {
    return invalidExecution('Ledger replay record has an unsupported response status')
  }
}

function replayResult(record: LedgerIdempotencyRecord): LedgerReplayResult {
  assertReplayStatus(record.responseStatus)
  return {
    responseStatus: record.responseStatus,
    responseBodyJson: record.responseBodyJson,
    replayed: true,
  }
}

/**
 * Execute a successful Ledger create/no-op and durably snapshot its first
 * response. The mutation and replay row share runLedgerWrite's transaction.
 */
export function executeIdempotentLedgerCreate<
  TResponseBody extends LedgerJsonValue,
  TResult extends LedgerIdempotentResult<TResponseBody>,
>(
  db: DatabaseT,
  repository: LedgerRepository,
  input: ExecuteIdempotentLedgerCreateInput<TResponseBody, TResult>,
): LedgerReplayResult {
  const requestFingerprint = fingerprintLedgerMutation(input.request)

  return runLedgerWrite(db, () => {
    const existing = repository.getIdempotencyRecord(input.operationScope, input.idempotencyKey)
    if (existing !== null) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new LedgerError(
          'ledger-idempotency-conflict',
          409,
          'Idempotency-Key was already used for a different Ledger request',
        )
      }
      return replayResult(existing)
    }

    const mutationResult = input.mutation()
    assertMutationResult<TResponseBody>(mutationResult)
    const responseBodyJson = serializeLedgerReplayResponse(mutationResult.responseBody)
    const createdAt = input.createdAt ?? Date.now()
    if (!Number.isSafeInteger(createdAt)) {
      return invalidExecution('Ledger idempotency createdAt must be a safe integer')
    }

    input.afterMutationBeforeIdempotencyInsert?.()

    repository.insertIdempotencyRecord({
      operationScope: input.operationScope,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint,
      responseStatus: mutationResult.responseStatus,
      responseBodyJson,
      resultStatus: mutationResult.resultStatus,
      resultType: mutationResult.resultType ?? null,
      resultId: mutationResult.resultId ?? null,
      createdAt,
    })

    return {
      responseStatus: mutationResult.responseStatus,
      responseBodyJson,
      replayed: false,
    }
  })
}
