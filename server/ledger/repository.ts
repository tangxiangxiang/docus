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
  }
}
