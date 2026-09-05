import type { Database as DatabaseT } from 'better-sqlite3'
import {
  ledgerAccountFromRow,
  ledgerCategoryFromRow,
  ledgerSettingsFromRow,
  ledgerTransactionFromRow,
  type LedgerAccount,
  type LedgerCategory,
  type LedgerSettings,
  type LedgerTransaction,
} from './domain.js'
import { ledgerValidationError } from './errors.js'

const SELECT_SETTINGS = `
  SELECT singleton_id, base_currency, timezone, has_created_account,
         version, created_at, updated_at
  FROM ledger_settings
  WHERE singleton_id = 1
`

const INSERT_SETTINGS = `
  INSERT INTO ledger_settings (
    singleton_id, base_currency, timezone, has_created_account,
    version, created_at, updated_at
  ) VALUES (1, @baseCurrency, @timezone, @hasCreatedAccount,
            @version, @createdAt, @updatedAt)
`

const UPDATE_SETTINGS = `
  UPDATE ledger_settings
  SET base_currency = @baseCurrency,
      timezone = @timezone,
      has_created_account = @hasCreatedAccount,
      version = @version,
      updated_at = @updatedAt
  WHERE singleton_id = 1
    AND version = @expectedVersion
`

const SELECT_ACCOUNT = `
  SELECT id, name, type, nature, opening_balance_minor, opening_date,
         currency, note, archived_at, version, created_at, updated_at
  FROM ledger_accounts
  WHERE id = @id
`

const SELECT_ACCOUNTS = `
  SELECT id, name, type, nature, opening_balance_minor, opening_date,
         currency, note, archived_at, version, created_at, updated_at
  FROM ledger_accounts
  ORDER BY updated_at DESC, id DESC
`

const SELECT_ACTIVE_ACCOUNTS = `
  SELECT id, name, type, nature, opening_balance_minor, opening_date,
         currency, note, archived_at, version, created_at, updated_at
  FROM ledger_accounts
  WHERE archived_at IS NULL
  ORDER BY updated_at DESC, id DESC
`

const INSERT_ACCOUNT = `
  INSERT INTO ledger_accounts (
    id, name, type, nature, opening_balance_minor, opening_date, currency,
    note, archived_at, version, created_at, updated_at
  ) VALUES (
    @id, @name, @type, @nature, @openingBalanceMinor, @openingDate, @currency,
    @note, @archivedAt, @version, @createdAt, @updatedAt
  )
`

const UPDATE_ACCOUNT = `
  UPDATE ledger_accounts
  SET name = @name,
      type = @type,
      nature = @nature,
      opening_balance_minor = @openingBalanceMinor,
      opening_date = @openingDate,
      currency = @currency,
      note = @note,
      archived_at = @archivedAt,
      version = @version,
      updated_at = @updatedAt
  WHERE id = @id
    AND version = @expectedVersion
`

const DELETE_ACCOUNT = 'DELETE FROM ledger_accounts WHERE id = @id'

const HAS_ACCOUNT_HISTORY = `
  SELECT 1 AS present
  FROM ledger_transactions
  WHERE account_id = @accountId
     OR from_account_id = @accountId
     OR to_account_id = @accountId
  LIMIT 1
`

const SELECT_CATEGORY = `
  SELECT id, kind, name, normalized_name, archived_at, version,
         created_at, updated_at
  FROM ledger_categories
  WHERE id = @id
`

const SELECT_CATEGORY_BY_IDENTITY = `
  SELECT id, kind, name, normalized_name, archived_at, version,
         created_at, updated_at
  FROM ledger_categories
  WHERE kind = @kind
    AND normalized_name = @normalizedName
`

const SELECT_CATEGORIES = `
  SELECT id, kind, name, normalized_name, archived_at, version,
         created_at, updated_at
  FROM ledger_categories
  ORDER BY kind ASC, normalized_name ASC, id ASC
`

const SELECT_ACTIVE_CATEGORIES = `
  SELECT id, kind, name, normalized_name, archived_at, version,
         created_at, updated_at
  FROM ledger_categories
  WHERE archived_at IS NULL
  ORDER BY kind ASC, normalized_name ASC, id ASC
`

const INSERT_CATEGORY = `
  INSERT INTO ledger_categories (
    id, kind, name, normalized_name, archived_at, version, created_at, updated_at
  ) VALUES (
    @id, @kind, @name, @normalizedName, @archivedAt, @version, @createdAt, @updatedAt
  )
`

const UPDATE_CATEGORY = `
  UPDATE ledger_categories
  SET kind = @kind,
      name = @name,
      normalized_name = @normalizedName,
      archived_at = @archivedAt,
      version = @version,
      updated_at = @updatedAt
  WHERE id = @id
    AND version = @expectedVersion
`

const DELETE_CATEGORY = 'DELETE FROM ledger_categories WHERE id = @id'

const HAS_CATEGORY_HISTORY = `
  SELECT 1 AS present
  FROM ledger_transactions
  WHERE category_id = @categoryId
  LIMIT 1
`

const SELECT_TRANSACTION = `
  SELECT id, type, amount_minor, account_id, from_account_id, to_account_id,
         category_id, occurred_at, payee, note,
         adjustment_calculated_balance_minor, adjustment_target_balance_minor,
         deleted_at, version, created_at, updated_at
  FROM ledger_transactions
  WHERE id = @id
`

const INSERT_TRANSACTION = `
  INSERT INTO ledger_transactions (
    id, type, amount_minor, account_id, from_account_id, to_account_id,
    category_id, occurred_at, payee, note,
    adjustment_calculated_balance_minor, adjustment_target_balance_minor,
    deleted_at, version, created_at, updated_at
  ) VALUES (
    @id, @type, @amountMinor, @accountId, @fromAccountId, @toAccountId,
    @categoryId, @occurredAt, @payee, @note,
    @adjustmentCalculatedBalanceMinor, @adjustmentTargetBalanceMinor,
    @deletedAt, @version, @createdAt, @updatedAt
  )
`

const UPDATE_TRANSACTION = `
  UPDATE ledger_transactions
  SET type = @type,
      amount_minor = @amountMinor,
      account_id = @accountId,
      from_account_id = @fromAccountId,
      to_account_id = @toAccountId,
      category_id = @categoryId,
      occurred_at = @occurredAt,
      payee = @payee,
      note = @note,
      adjustment_calculated_balance_minor = @adjustmentCalculatedBalanceMinor,
      adjustment_target_balance_minor = @adjustmentTargetBalanceMinor,
      deleted_at = @deletedAt,
      version = @version,
      updated_at = @updatedAt
  WHERE id = @id
    AND version = @expectedVersion
`

const SOFT_DELETE_TRANSACTION = `
  UPDATE ledger_transactions
  SET deleted_at = @deletedAt,
      version = @version,
      updated_at = @updatedAt
  WHERE id = @id
    AND version = @expectedVersion
`

const SELECT_ACTIVE_TRANSACTIONS_FOR_ACCOUNT = `
  SELECT id, type, amount_minor, account_id, from_account_id, to_account_id,
         category_id, occurred_at, payee, note,
         adjustment_calculated_balance_minor, adjustment_target_balance_minor,
         deleted_at, version, created_at, updated_at
  FROM ledger_transactions
  WHERE deleted_at IS NULL
    AND (
      account_id = @accountId
      OR from_account_id = @accountId
      OR to_account_id = @accountId
    )
  ORDER BY occurred_at DESC, created_at DESC, id DESC
`

const SELECT_ALL_ACTIVE_TRANSACTIONS = `
  SELECT id, type, amount_minor, account_id, from_account_id, to_account_id,
         category_id, occurred_at, payee, note,
         adjustment_calculated_balance_minor, adjustment_target_balance_minor,
         deleted_at, version, created_at, updated_at
  FROM ledger_transactions
  WHERE deleted_at IS NULL
  ORDER BY occurred_at DESC, created_at DESC, id DESC
`

const SELECT_ACTIVE_TRANSACTIONS_IN_RANGE = `
  SELECT id, type, amount_minor, account_id, from_account_id, to_account_id,
         category_id, occurred_at, payee, note,
         adjustment_calculated_balance_minor, adjustment_target_balance_minor,
         deleted_at, version, created_at, updated_at
  FROM ledger_transactions
  WHERE deleted_at IS NULL
    AND occurred_at >= @from
    AND occurred_at < @to
  ORDER BY occurred_at DESC, created_at DESC, id DESC
`

const SELECT_ACTIVE_TRANSACTIONS_BEFORE = `
  SELECT id, type, amount_minor, account_id, from_account_id, to_account_id,
         category_id, occurred_at, payee, note,
         adjustment_calculated_balance_minor, adjustment_target_balance_minor,
         deleted_at, version, created_at, updated_at
  FROM ledger_transactions
  WHERE deleted_at IS NULL
    AND occurred_at < @to
  ORDER BY occurred_at DESC, created_at DESC, id DESC
`

const SELECT_RECENT_ACTIVE_TRANSACTIONS_BEFORE = `
  SELECT id, type, amount_minor, account_id, from_account_id, to_account_id,
         category_id, occurred_at, payee, note,
         adjustment_calculated_balance_minor, adjustment_target_balance_minor,
         deleted_at, version, created_at, updated_at
  FROM ledger_transactions
  WHERE deleted_at IS NULL
    AND occurred_at < @to
  ORDER BY occurred_at DESC, created_at DESC, id DESC
  LIMIT @limit
`

const SELECT_IDEMPOTENCY_RECORD = `
  SELECT operation_scope, idempotency_key, request_fingerprint,
         response_status, response_body_json, result_status, result_type,
         result_id, created_at
  FROM ledger_idempotency
  WHERE operation_scope = @operationScope
    AND idempotency_key = @idempotencyKey
`

const INSERT_IDEMPOTENCY_RECORD = `
  INSERT INTO ledger_idempotency (
    operation_scope, idempotency_key, request_fingerprint,
    response_status, response_body_json, result_status, result_type,
    result_id, created_at
  ) VALUES (
    @operationScope, @idempotencyKey, @requestFingerprint,
    @responseStatus, @responseBodyJson, @resultStatus, @resultType,
    @resultId, @createdAt
  )
`

export interface LedgerSettingsUpdateInput {
  readonly settings: LedgerSettings
  readonly expectedVersion: number
}

export interface LedgerAccountUpdateInput {
  readonly account: LedgerAccount
  readonly expectedVersion: number
}

export interface LedgerCategoryUpdateInput {
  readonly category: LedgerCategory
  readonly expectedVersion: number
}

export interface LedgerTransactionUpdateInput {
  readonly transaction: LedgerTransaction
  readonly expectedVersion: number
}

export interface LedgerTransactionSoftDeleteInput {
  readonly id: string
  readonly deletedAt: number
  readonly version: number
  readonly updatedAt: number
  readonly expectedVersion: number
}

export type LedgerIdempotencyResultStatus = 'committed' | 'no-op'

export interface LedgerIdempotencyRecord {
  readonly operationScope: string
  readonly idempotencyKey: string
  readonly requestFingerprint: string
  readonly responseStatus: number
  readonly responseBodyJson: string
  readonly resultStatus: LedgerIdempotencyResultStatus
  readonly resultType: string | null
  readonly resultId: string | null
  readonly createdAt: number
}

export interface LedgerTransactionQueryOptions {
  readonly type?: 'all' | 'income' | 'expense' | 'transfer'
  readonly accountId?: string
  readonly categoryId?: string
  readonly from?: number
  readonly to?: number
  readonly search?: string
  readonly includeDeleted?: boolean
  readonly limit: number
  readonly cursor?: {
    readonly occurredAt: number
    readonly createdAt: number
    readonly id: string
  }
}

export interface LedgerTransactionRangeOptions {
  readonly from?: number
  readonly to: number
}

export interface LedgerRepository {
  getSettings(): LedgerSettings | null
  insertSettings(settings: LedgerSettings): void
  updateSettings(input: LedgerSettingsUpdateInput): number

  getAccount(id: string): LedgerAccount | null
  listAccounts(options?: { readonly includeArchived?: boolean }): LedgerAccount[]
  insertAccount(account: LedgerAccount): void
  updateAccount(input: LedgerAccountUpdateInput): number
  deleteAccount(id: string): number
  hasAccountHistory(accountId: string): boolean

  getCategory(id: string): LedgerCategory | null
  findCategoryByIdentity(kind: LedgerCategory['kind'], normalizedName: string): LedgerCategory | null
  listCategories(options?: { readonly includeArchived?: boolean }): LedgerCategory[]
  insertCategory(category: LedgerCategory): void
  updateCategory(input: LedgerCategoryUpdateInput): number
  deleteCategory(id: string): number
  hasCategoryHistory(categoryId: string): boolean

  getTransaction(id: string): LedgerTransaction | null
  insertTransaction(transaction: LedgerTransaction): void
  updateTransaction(input: LedgerTransactionUpdateInput): number
  softDeleteTransaction(input: LedgerTransactionSoftDeleteInput): number
  listActiveTransactionsForAccount(accountId: string): LedgerTransaction[]
  listActiveTransactions(): LedgerTransaction[]
  listActiveTransactionsInRange(options: LedgerTransactionRangeOptions): LedgerTransaction[]
  listRecentActiveTransactionsBefore(to: number, limit: number): LedgerTransaction[]
  queryTransactions(options: LedgerTransactionQueryOptions): LedgerTransaction[]

  getIdempotencyRecord(operationScope: string, idempotencyKey: string): LedgerIdempotencyRecord | null
  insertIdempotencyRecord(record: LedgerIdempotencyRecord): void
}

interface SettingsParams {
  readonly baseCurrency: string
  readonly timezone: string
  readonly hasCreatedAccount: number
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

interface SettingsUpdateParams extends SettingsParams {
  readonly expectedVersion: number
}

interface AccountParams {
  readonly id: string
  readonly name: string
  readonly type: LedgerAccount['type']
  readonly nature: LedgerAccount['nature']
  readonly openingBalanceMinor: number
  readonly openingDate: string
  readonly currency: string
  readonly note: string
  readonly archivedAt: number | null
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

interface AccountUpdateParams extends AccountParams {
  readonly expectedVersion: number
}

interface CategoryParams {
  readonly id: string
  readonly kind: LedgerCategory['kind']
  readonly name: string
  readonly normalizedName: string
  readonly archivedAt: number | null
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

interface CategoryUpdateParams extends CategoryParams {
  readonly expectedVersion: number
}

interface TransactionParams {
  readonly id: string
  readonly type: LedgerTransaction['type']
  readonly amountMinor: number
  readonly accountId: string | null
  readonly fromAccountId: string | null
  readonly toAccountId: string | null
  readonly categoryId: string | null
  readonly occurredAt: number
  readonly payee: string
  readonly note: string
  readonly adjustmentCalculatedBalanceMinor: number | null
  readonly adjustmentTargetBalanceMinor: number | null
  readonly deletedAt: number | null
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

interface TransactionUpdateParams extends TransactionParams {
  readonly expectedVersion: number
}

interface TransactionSoftDeleteParams {
  readonly id: string
  readonly deletedAt: number
  readonly version: number
  readonly updatedAt: number
  readonly expectedVersion: number
}

interface IdempotencyLookupParams {
  readonly operationScope: string
  readonly idempotencyKey: string
}

interface IdempotencyParams {
  readonly operationScope: string
  readonly idempotencyKey: string
  readonly requestFingerprint: string
  readonly responseStatus: number
  readonly responseBodyJson: string
  readonly resultStatus: LedgerIdempotencyResultStatus
  readonly resultType: string | null
  readonly resultId: string | null
  readonly createdAt: number
}

function settingsParams(settings: LedgerSettings): SettingsParams {
  return {
    baseCurrency: settings.baseCurrency,
    timezone: settings.timezone,
    hasCreatedAccount: settings.hasCreatedAccount ? 1 : 0,
    version: settings.version,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  }
}

function accountParams(account: LedgerAccount): AccountParams {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    nature: account.nature,
    openingBalanceMinor: account.openingBalanceMinor,
    openingDate: account.openingDate,
    currency: account.currency,
    note: account.note,
    archivedAt: account.archivedAt,
    version: account.version,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

function categoryParams(category: LedgerCategory): CategoryParams {
  return {
    id: category.id,
    kind: category.kind,
    name: category.name,
    normalizedName: category.normalizedName,
    archivedAt: category.archivedAt,
    version: category.version,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }
}

function transactionParams(transaction: LedgerTransaction): TransactionParams {
  const common = {
    id: transaction.id,
    type: transaction.type,
    amountMinor: transaction.amountMinor,
    accountId: null,
    fromAccountId: null,
    toAccountId: null,
    categoryId: null,
    occurredAt: transaction.occurredAt,
    payee: '',
    note: transaction.note,
    adjustmentCalculatedBalanceMinor: null,
    adjustmentTargetBalanceMinor: null,
    deletedAt: transaction.deletedAt,
    version: transaction.version,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  }

  switch (transaction.type) {
    case 'income':
    case 'expense':
      return {
        ...common,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        payee: transaction.payee,
      }
    case 'transfer':
      return {
        ...common,
        fromAccountId: transaction.fromAccountId,
        toAccountId: transaction.toAccountId,
      }
    case 'adjustment':
      return {
        ...common,
        accountId: transaction.accountId,
        adjustmentCalculatedBalanceMinor: transaction.adjustmentCalculatedBalanceMinor,
        adjustmentTargetBalanceMinor: transaction.adjustmentTargetBalanceMinor,
      }
  }
}

function transactionUpdateParams(input: LedgerTransactionUpdateInput): TransactionUpdateParams {
  return {
    ...transactionParams(input.transaction),
    expectedVersion: input.expectedVersion,
  }
}

interface IdempotencyRow {
  readonly operation_scope?: unknown
  readonly idempotency_key?: unknown
  readonly request_fingerprint?: unknown
  readonly response_status?: unknown
  readonly response_body_json?: unknown
  readonly result_status?: unknown
  readonly result_type?: unknown
  readonly result_id?: unknown
  readonly created_at?: unknown
}

function invalidIdempotencyRow(field: string, reason: string): never {
  throw ledgerValidationError('invalid persisted Ledger idempotency row', {
    entity: 'idempotency',
    field,
    reason,
  })
}

function idempotencyRowValue(row: IdempotencyRow, field: keyof IdempotencyRow): unknown {
  if (!Object.prototype.hasOwnProperty.call(row, field)) {
    return invalidIdempotencyRow(field, 'column is missing')
  }
  return row[field]
}

function idempotencyString(row: IdempotencyRow, field: keyof IdempotencyRow, allowEmpty = false): string {
  const value = idempotencyRowValue(row, field)
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    return invalidIdempotencyRow(field, 'column must be a non-empty string')
  }
  return value
}

function idempotencyNullableString(row: IdempotencyRow, field: keyof IdempotencyRow): string | null {
  const value = idempotencyRowValue(row, field)
  if (value === null) return null
  if (typeof value !== 'string') return invalidIdempotencyRow(field, 'column must be null or a string')
  return value
}

function idempotencySafeInteger(row: IdempotencyRow, field: keyof IdempotencyRow): number {
  const value = idempotencyRowValue(row, field)
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return invalidIdempotencyRow(field, 'column must be a safe integer')
  }
  return value
}

function idempotencyRecordFromRow(row: IdempotencyRow): LedgerIdempotencyRecord {
  const requestFingerprint = idempotencyString(row, 'request_fingerprint')
  if (!/^[0-9a-f]{64}$/.test(requestFingerprint)) {
    return invalidIdempotencyRow('request_fingerprint', 'column must be a lowercase SHA-256 fingerprint')
  }

  const responseStatus = idempotencySafeInteger(row, 'response_status')
  if (responseStatus < 100 || responseStatus > 599) {
    return invalidIdempotencyRow('response_status', 'status must be between 100 and 599')
  }

  const resultStatus = idempotencyString(row, 'result_status')
  if (resultStatus !== 'committed' && resultStatus !== 'no-op') {
    return invalidIdempotencyRow('result_status', 'status must be committed or no-op')
  }

  return {
    operationScope: idempotencyString(row, 'operation_scope'),
    idempotencyKey: idempotencyString(row, 'idempotency_key'),
    requestFingerprint,
    responseStatus,
    responseBodyJson: idempotencyString(row, 'response_body_json', true),
    resultStatus,
    resultType: idempotencyNullableString(row, 'result_type'),
    resultId: idempotencyNullableString(row, 'result_id'),
    createdAt: idempotencySafeInteger(row, 'created_at'),
  }
}

function idempotencyParams(record: LedgerIdempotencyRecord): IdempotencyParams {
  return {
    operationScope: record.operationScope,
    idempotencyKey: record.idempotencyKey,
    requestFingerprint: record.requestFingerprint,
    responseStatus: record.responseStatus,
    responseBodyJson: record.responseBodyJson,
    resultStatus: record.resultStatus,
    resultType: record.resultType,
    resultId: record.resultId,
    createdAt: record.createdAt,
  }
}

export function createLedgerRepository(db: DatabaseT): LedgerRepository {
  const statements = {
    getSettings: db.prepare(SELECT_SETTINGS),
    insertSettings: db.prepare<SettingsParams>(INSERT_SETTINGS),
    updateSettings: db.prepare<SettingsUpdateParams>(UPDATE_SETTINGS),

    getAccount: db.prepare(SELECT_ACCOUNT),
    listAccounts: db.prepare(SELECT_ACCOUNTS),
    listActiveAccounts: db.prepare(SELECT_ACTIVE_ACCOUNTS),
    insertAccount: db.prepare<AccountParams>(INSERT_ACCOUNT),
    updateAccount: db.prepare<AccountUpdateParams>(UPDATE_ACCOUNT),
    deleteAccount: db.prepare(DELETE_ACCOUNT),
    hasAccountHistory: db.prepare<{ readonly accountId: string }>(HAS_ACCOUNT_HISTORY),

    getCategory: db.prepare(SELECT_CATEGORY),
    findCategoryByIdentity: db.prepare<{ readonly kind: LedgerCategory['kind']; readonly normalizedName: string }>(
      SELECT_CATEGORY_BY_IDENTITY,
    ),
    listCategories: db.prepare(SELECT_CATEGORIES),
    listActiveCategories: db.prepare(SELECT_ACTIVE_CATEGORIES),
    insertCategory: db.prepare<CategoryParams>(INSERT_CATEGORY),
    updateCategory: db.prepare<CategoryUpdateParams>(UPDATE_CATEGORY),
    deleteCategory: db.prepare(DELETE_CATEGORY),
    hasCategoryHistory: db.prepare<{ readonly categoryId: string }>(HAS_CATEGORY_HISTORY),

    getTransaction: db.prepare(SELECT_TRANSACTION),
    insertTransaction: db.prepare<TransactionParams>(INSERT_TRANSACTION),
    updateTransaction: db.prepare<TransactionUpdateParams>(UPDATE_TRANSACTION),
    softDeleteTransaction: db.prepare<TransactionSoftDeleteParams>(SOFT_DELETE_TRANSACTION),
    listActiveTransactionsForAccount: db.prepare<{ readonly accountId: string }>(
      SELECT_ACTIVE_TRANSACTIONS_FOR_ACCOUNT,
    ),
    listActiveTransactions: db.prepare(SELECT_ALL_ACTIVE_TRANSACTIONS),
    listActiveTransactionsInRange: db.prepare<{ readonly from: number; readonly to: number }>(
      SELECT_ACTIVE_TRANSACTIONS_IN_RANGE,
    ),
    listActiveTransactionsBefore: db.prepare<{ readonly to: number }>(
      SELECT_ACTIVE_TRANSACTIONS_BEFORE,
    ),
    listRecentActiveTransactionsBefore: db.prepare<{ readonly to: number; readonly limit: number }>(
      SELECT_RECENT_ACTIVE_TRANSACTIONS_BEFORE,
    ),
    getIdempotencyRecord: db.prepare<IdempotencyLookupParams, IdempotencyRow>(SELECT_IDEMPOTENCY_RECORD),
    insertIdempotencyRecord: db.prepare<IdempotencyParams>(INSERT_IDEMPOTENCY_RECORD),
  }

  return {
    getSettings(): LedgerSettings | null {
      const row = statements.getSettings.get()
      return row === undefined ? null : ledgerSettingsFromRow(row)
    },

    insertSettings(settings: LedgerSettings): void {
      statements.insertSettings.run(settingsParams(settings))
    },

    updateSettings(input: LedgerSettingsUpdateInput): number {
      return statements.updateSettings.run({
        ...settingsParams(input.settings),
        expectedVersion: input.expectedVersion,
      }).changes
    },

    getAccount(id: string): LedgerAccount | null {
      const row = statements.getAccount.get({ id })
      return row === undefined ? null : ledgerAccountFromRow(row)
    },

    listAccounts(options = {}): LedgerAccount[] {
      const rows = options.includeArchived === false
        ? statements.listActiveAccounts.all()
        : statements.listAccounts.all()
      return rows.map(ledgerAccountFromRow)
    },

    insertAccount(account: LedgerAccount): void {
      statements.insertAccount.run(accountParams(account))
    },

    updateAccount(input: LedgerAccountUpdateInput): number {
      return statements.updateAccount.run({
        ...accountParams(input.account),
        expectedVersion: input.expectedVersion,
      }).changes
    },

    deleteAccount(id: string): number {
      return statements.deleteAccount.run({ id }).changes
    },

    hasAccountHistory(accountId: string): boolean {
      return statements.hasAccountHistory.get({ accountId }) !== undefined
    },

    getCategory(id: string): LedgerCategory | null {
      const row = statements.getCategory.get({ id })
      return row === undefined ? null : ledgerCategoryFromRow(row)
    },

    findCategoryByIdentity(kind: LedgerCategory['kind'], normalizedName: string): LedgerCategory | null {
      const row = statements.findCategoryByIdentity.get({ kind, normalizedName })
      return row === undefined ? null : ledgerCategoryFromRow(row)
    },

    listCategories(options = {}): LedgerCategory[] {
      const rows = options.includeArchived === false
        ? statements.listActiveCategories.all()
        : statements.listCategories.all()
      return rows.map(ledgerCategoryFromRow)
    },

    insertCategory(category: LedgerCategory): void {
      statements.insertCategory.run(categoryParams(category))
    },

    updateCategory(input: LedgerCategoryUpdateInput): number {
      return statements.updateCategory.run({
        ...categoryParams(input.category),
        expectedVersion: input.expectedVersion,
      }).changes
    },

    deleteCategory(id: string): number {
      return statements.deleteCategory.run({ id }).changes
    },

    hasCategoryHistory(categoryId: string): boolean {
      return statements.hasCategoryHistory.get({ categoryId }) !== undefined
    },

    getTransaction(id: string): LedgerTransaction | null {
      const row = statements.getTransaction.get({ id })
      return row === undefined ? null : ledgerTransactionFromRow(row)
    },

    insertTransaction(transaction: LedgerTransaction): void {
      statements.insertTransaction.run(transactionParams(transaction))
    },

    updateTransaction(input: LedgerTransactionUpdateInput): number {
      return statements.updateTransaction.run(transactionUpdateParams(input)).changes
    },

    softDeleteTransaction(input: LedgerTransactionSoftDeleteInput): number {
      return statements.softDeleteTransaction.run(input)
        .changes
    },

    listActiveTransactionsForAccount(accountId: string): LedgerTransaction[] {
      return statements.listActiveTransactionsForAccount
        .all({ accountId })
        .map(ledgerTransactionFromRow)
    },

    listActiveTransactions(): LedgerTransaction[] {
      return statements.listActiveTransactions.all().map(ledgerTransactionFromRow)
    },

    listActiveTransactionsInRange(options: LedgerTransactionRangeOptions): LedgerTransaction[] {
      if (!Number.isSafeInteger(options.to)) {
        throw ledgerValidationError('transaction range to must be a safe integer', { field: 'to' })
      }
      if (options.from !== undefined) {
        if (!Number.isSafeInteger(options.from)) {
          throw ledgerValidationError('transaction range from must be a safe integer', { field: 'from' })
        }
        if (options.from >= options.to) {
          throw ledgerValidationError('transaction range from must be earlier than to', { field: 'from' })
        }
        return statements.listActiveTransactionsInRange
          .all({ from: options.from, to: options.to })
          .map(ledgerTransactionFromRow)
      }
      return statements.listActiveTransactionsBefore
        .all({ to: options.to })
        .map(ledgerTransactionFromRow)
    },

    listRecentActiveTransactionsBefore(to: number, limit: number): LedgerTransaction[] {
      if (!Number.isSafeInteger(to)) {
        throw ledgerValidationError('recent transaction cutoff must be a safe integer', { field: 'to' })
      }
      if (!Number.isSafeInteger(limit) || limit < 1) {
        throw ledgerValidationError('recent transaction limit must be a positive safe integer', { field: 'limit' })
      }
      return statements.listRecentActiveTransactionsBefore
        .all({ to, limit })
        .map(ledgerTransactionFromRow)
    },

    queryTransactions(options: LedgerTransactionQueryOptions): LedgerTransaction[] {
      const clauses: string[] = []
      const params: Record<string, string | number> = {
        limit: options.limit + 1,
      }

      if (options.includeDeleted !== true) clauses.push('deleted_at IS NULL')

      if (options.type !== undefined && options.type !== 'all') {
        clauses.push('type = @type')
        params.type = options.type
      }

      if (options.accountId !== undefined) {
        clauses.push(`(
          account_id = @accountId
          OR from_account_id = @accountId
          OR to_account_id = @accountId
        )`)
        params.accountId = options.accountId
      }

      if (options.categoryId !== undefined) {
        clauses.push('category_id = @categoryId')
        params.categoryId = options.categoryId
      }

      if (options.from !== undefined) {
        clauses.push('occurred_at >= @from')
        params.from = options.from
      }
      if (options.to !== undefined) {
        clauses.push('occurred_at < @to')
        params.to = options.to
      }

      if (options.search !== undefined && options.search.length > 0) {
        const escaped = options.search
          .replaceAll('\\', '\\\\')
          .replaceAll('%', '\\%')
          .replaceAll('_', '\\_')
        params.searchPattern = `%${escaped}%`
        clauses.push(`(
          payee LIKE @searchPattern ESCAPE '\\' COLLATE NOCASE
          OR note LIKE @searchPattern ESCAPE '\\' COLLATE NOCASE
        )`)
      }

      if (options.cursor !== undefined) {
        clauses.push(`(
          occurred_at < @cursorOccurredAt
          OR (
            occurred_at = @cursorOccurredAt
            AND created_at < @cursorCreatedAt
          )
          OR (
            occurred_at = @cursorOccurredAt
            AND created_at = @cursorCreatedAt
            AND id < @cursorId
          )
        )`)
        params.cursorOccurredAt = options.cursor.occurredAt
        params.cursorCreatedAt = options.cursor.createdAt
        params.cursorId = options.cursor.id
      }

      const sql = `
        SELECT id, type, amount_minor, account_id, from_account_id, to_account_id,
               category_id, occurred_at, payee, note,
               adjustment_calculated_balance_minor, adjustment_target_balance_minor,
               deleted_at, version, created_at, updated_at
        FROM ledger_transactions
        ${clauses.length === 0 ? '' : `WHERE ${clauses.join('\n          AND ')}`}
        ORDER BY occurred_at DESC, created_at DESC, id DESC
        LIMIT @limit
      `
      return db.prepare(sql).all(params).map(ledgerTransactionFromRow)
    },

    getIdempotencyRecord(operationScope: string, idempotencyKey: string): LedgerIdempotencyRecord | null {
      const row = statements.getIdempotencyRecord.get({ operationScope, idempotencyKey })
      return row === undefined ? null : idempotencyRecordFromRow(row)
    },

    insertIdempotencyRecord(record: LedgerIdempotencyRecord): void {
      statements.insertIdempotencyRecord.run(idempotencyParams(record))
    },
  }
}
