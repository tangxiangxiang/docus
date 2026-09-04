import { authFetch } from '../../lib/auth-session'
import type {
  LedgerAccountCreateRequest,
  LedgerAccountDto,
  LedgerAccountNature,
  LedgerAccountTransactionsDto,
  LedgerAccountType,
  LedgerCategoryCreateRequest,
  LedgerCategoryDto,
  LedgerCategoryKind,
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
import { LedgerApiError, type LedgerErrorDetails } from './ledgerErrors'

export interface LedgerDeletedResponse {
  readonly deleted: true
  readonly id: string
}

export type LedgerAccountPatchInput = {
  readonly expectedVersion: number
  readonly name?: string
  readonly note?: string
  readonly type?: LedgerAccountType
  readonly nature?: LedgerAccountNature
  readonly openingBalanceMinor?: number
  readonly openingDate?: string
}

export type LedgerCategoryPatchInput = {
  readonly expectedVersion: number
  readonly kind?: LedgerCategoryKind
  readonly name?: string
}

export type LedgerTransactionPatchInput = {
  readonly expectedVersion: number
  readonly type?: 'income' | 'expense' | 'transfer' | 'adjustment'
  readonly amountMinor?: number
  readonly accountId?: string
  readonly fromAccountId?: string
  readonly toAccountId?: string
  readonly categoryId?: string
  readonly occurredAt?: number
  readonly payee?: string
  readonly note?: string
  readonly adjustmentCalculatedBalanceMinor?: number
  readonly adjustmentTargetBalanceMinor?: number
}

type ResponseValidator<T> = (value: unknown) => T

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function malformed(label: string): LedgerApiError {
  return new LedgerApiError(`Ledger returned an invalid ${label}.`, 200, 'ledger-malformed-response')
}

function objectResponse<T>(label: string): ResponseValidator<T> {
  return (value: unknown) => {
    if (!isRecord(value)) throw malformed(label)
    return value as T
  }
}

function arrayResponse<T>(label: string): ResponseValidator<T[]> {
  return (value: unknown) => {
    if (!Array.isArray(value)) throw malformed(label)
    return value as T[]
  }
}

function settingsResponse(value: unknown): LedgerSettingsDto {
  if (!isRecord(value)
    || typeof value.baseCurrency !== 'string'
    || typeof value.currencyExponent !== 'number'
    || typeof value.timezone !== 'string'
    || typeof value.hasCreatedAccount !== 'boolean'
    || !Number.isSafeInteger(value.version)
    || !Number.isSafeInteger(value.createdAt)
    || !Number.isSafeInteger(value.updatedAt)) {
    throw malformed('Settings response')
  }
  return value as unknown as LedgerSettingsDto
}

function accountResponse(value: unknown): LedgerAccountDto {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || (value.archivedAt !== null && typeof value.archivedAt !== 'number')
    || typeof value.currentBalanceMinor !== 'number') {
    throw malformed('Account response')
  }
  return value as unknown as LedgerAccountDto
}

function categoryResponse(value: unknown): LedgerCategoryDto {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw malformed('Category response')
  }
  return value as unknown as LedgerCategoryDto
}

function transactionResponse(value: unknown): LedgerTransactionDto {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    throw malformed('Transaction response')
  }
  return value as unknown as LedgerTransactionDto
}

function transactionPageResponse(value: unknown): LedgerTransactionPageDto {
  if (!isRecord(value) || !Array.isArray(value.transactions) || !isRecord(value.page)) {
    throw malformed('Transaction list response')
  }
  return value as unknown as LedgerTransactionPageDto
}

function errorDetails(value: unknown): LedgerErrorDetails | null {
  if (!isRecord(value)) return null
  return value as LedgerErrorDetails
}

async function parseErrorBody(response: Response): Promise<{ message: string; code: string; details: LedgerErrorDetails | null }> {
  try {
    const body: unknown = await response.json()
    if (isRecord(body)) {
      return {
        message: typeof body.error === 'string' ? body.error : `Ledger request failed (${response.status}).`,
        code: typeof body.code === 'string' ? body.code : `ledger-http-${response.status}`,
        details: errorDetails(body.details),
      }
    }
  } catch {
    // Keep the status-specific opaque fallback below.
  }
  return {
    message: `Ledger request failed (${response.status}).`,
    code: `ledger-http-${response.status}`,
    details: null,
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  validate: ResponseValidator<T> = objectResponse<T>('response'),
): Promise<T> {
  let response: Response
  try {
    response = await authFetch(path, init)
  } catch (error) {
    throw new LedgerApiError(
      error instanceof Error ? error.message : 'Ledger network request failed.',
      0,
      'ledger-network-error',
      null,
      true,
    )
  }

  if (!response.ok) {
    const body = await parseErrorBody(response)
    throw new LedgerApiError(body.message, response.status, body.code, body.details)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw malformed('JSON response')
  }
  return validate(body)
}

function jsonInit(
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  idempotencyKey?: string,
): RequestInit {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)
  return { method, headers, body: JSON.stringify(body) }
}

function queryString(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export function getLedgerSettings(): Promise<LedgerSettingsDto> {
  return request('/api/ledger/settings', {}, settingsResponse)
}

export function createLedgerSettings(
  body: LedgerSettingsCreateRequest,
  idempotencyKey: string,
): Promise<LedgerSettingsDto> {
  return request('/api/ledger/settings', jsonInit('POST', body, idempotencyKey), settingsResponse)
}

export function patchLedgerSettings(body: {
  readonly expectedVersion: number
  readonly baseCurrency?: string
  readonly timezone?: string
}): Promise<LedgerSettingsDto> {
  return request('/api/ledger/settings', jsonInit('PATCH', body), settingsResponse)
}

export function listLedgerAccounts(includeArchived = true): Promise<LedgerAccountDto[]> {
  return request(
    `/api/ledger/accounts${queryString({ includeArchived })}`,
    {},
    arrayResponse<LedgerAccountDto>('Account list response'),
  ).then((accounts) => accounts.map(accountResponse))
}

export function getLedgerAccount(id: string): Promise<LedgerAccountDto> {
  return request(`/api/ledger/accounts/${encodeURIComponent(id)}`, {}, accountResponse)
}

export function createLedgerAccount(
  body: LedgerAccountCreateRequest,
  idempotencyKey: string,
): Promise<LedgerAccountDto> {
  return request(`/api/ledger/accounts`, jsonInit('POST', body, idempotencyKey), accountResponse)
}

export function patchLedgerAccount(id: string, body: LedgerAccountPatchInput): Promise<LedgerAccountDto> {
  return request(`/api/ledger/accounts/${encodeURIComponent(id)}`, jsonInit('PATCH', body), accountResponse)
}

export function archiveLedgerAccount(id: string, expectedVersion: number): Promise<LedgerAccountDto> {
  return request(`/api/ledger/accounts/${encodeURIComponent(id)}/archive`, jsonInit('POST', { expectedVersion }), accountResponse)
}

export function restoreLedgerAccount(id: string, expectedVersion: number): Promise<LedgerAccountDto> {
  return request(`/api/ledger/accounts/${encodeURIComponent(id)}/restore`, jsonInit('POST', { expectedVersion }), accountResponse)
}

export function deleteLedgerAccount(id: string, expectedVersion: number): Promise<LedgerDeletedResponse> {
  return request(
    `/api/ledger/accounts/${encodeURIComponent(id)}`,
    jsonInit('DELETE', { expectedVersion }),
    objectResponse<LedgerDeletedResponse>('Account delete response'),
  )
}

export function listLedgerCategories(
  kind?: LedgerCategoryKind,
  includeArchived = true,
): Promise<LedgerCategoryDto[]> {
  return request(
    `/api/ledger/categories${queryString({ kind, includeArchived })}`,
    {},
    arrayResponse<LedgerCategoryDto>('Category list response'),
  ).then((categories) => categories.map(categoryResponse))
}

export function createLedgerCategory(body: LedgerCategoryCreateRequest, idempotencyKey: string): Promise<LedgerCategoryDto> {
  return request('/api/ledger/categories', jsonInit('POST', body, idempotencyKey), categoryResponse)
}

export function patchLedgerCategory(id: string, body: LedgerCategoryPatchInput): Promise<LedgerCategoryDto> {
  return request(`/api/ledger/categories/${encodeURIComponent(id)}`, jsonInit('PATCH', body), categoryResponse)
}

export function archiveLedgerCategory(id: string, expectedVersion: number): Promise<LedgerCategoryDto> {
  return request(`/api/ledger/categories/${encodeURIComponent(id)}/archive`, jsonInit('POST', { expectedVersion }), categoryResponse)
}

export function restoreLedgerCategory(id: string, expectedVersion: number): Promise<LedgerCategoryDto> {
  return request(`/api/ledger/categories/${encodeURIComponent(id)}/restore`, jsonInit('POST', { expectedVersion }), categoryResponse)
}

export function deleteLedgerCategory(id: string, expectedVersion: number): Promise<LedgerDeletedResponse> {
  return request(
    `/api/ledger/categories/${encodeURIComponent(id)}`,
    jsonInit('DELETE', { expectedVersion }),
    objectResponse<LedgerDeletedResponse>('Category delete response'),
  )
}

export function createLedgerTransaction(
  body: LedgerIncomeCreateRequest | LedgerExpenseCreateRequest | LedgerTransferCreateRequest,
  idempotencyKey: string,
): Promise<LedgerTransactionDto> {
  return request('/api/ledger/transactions', jsonInit('POST', body, idempotencyKey), transactionResponse)
}

export function getLedgerTransaction(id: string): Promise<LedgerTransactionDto> {
  return request(`/api/ledger/transactions/${encodeURIComponent(id)}`, {}, transactionResponse)
}

export function patchLedgerTransaction(id: string, body: LedgerTransactionPatchInput): Promise<LedgerTransactionDto> {
  return request(`/api/ledger/transactions/${encodeURIComponent(id)}`, jsonInit('PATCH', body), transactionResponse)
}

export function deleteLedgerTransaction(id: string, expectedVersion: number): Promise<LedgerTransactionDto> {
  return request(`/api/ledger/transactions/${encodeURIComponent(id)}`, jsonInit('DELETE', { expectedVersion }), transactionResponse)
}

export function listLedgerTransactions(query: LedgerTransactionQuery = {}): Promise<LedgerTransactionPageDto> {
  return request(
    `/api/ledger/transactions${queryString({
      type: query.type,
      accountId: query.accountId,
      categoryId: query.categoryId,
      from: query.from,
      to: query.to,
      search: query.search,
      includeDeleted: query.includeDeleted,
      limit: query.limit,
      cursor: query.cursor,
    })}`,
    {},
    transactionPageResponse,
  )
}

export function getLedgerAccountTransactions(
  id: string,
  query: LedgerTransactionQuery = {},
): Promise<LedgerAccountTransactionsDto> {
  return request(
    `/api/ledger/accounts/${encodeURIComponent(id)}/transactions${queryString({
      type: query.type,
      accountId: undefined,
      categoryId: query.categoryId,
      from: query.from,
      to: query.to,
      search: query.search,
      includeDeleted: query.includeDeleted,
      limit: query.limit,
      cursor: query.cursor,
    })}`,
    {},
    objectResponse<LedgerAccountTransactionsDto>('Account transaction response'),
  )
}

export function getLedgerOverview(scope: LedgerOverviewScope = 'month'): Promise<LedgerOverviewDto> {
  return request(`/api/ledger/overview${queryString({ scope })}`, {}, objectResponse<LedgerOverviewDto>('Overview response'))
}

export function getLedgerTrend(months = 6): Promise<readonly unknown[]> {
  return request(`/api/ledger/trend${queryString({ months })}`, {}, arrayResponse<unknown>('Trend response'))
}
