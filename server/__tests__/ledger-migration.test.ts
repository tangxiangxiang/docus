import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db.js'

const databases: Database.Database[] = []

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  databases.push(db)
  return db
}

function insertAccount(db: Database.Database, id: string, nature = 'asset'): void {
  db.prepare(`
    INSERT INTO ledger_accounts (
      id, name, type, nature, opening_balance_minor, opening_date, currency,
      note, archived_at, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
  `).run(id, `Account ${id}`, nature === 'asset' ? 'bank' : 'loan', nature, 0, '2026-01-01', 'CNY', '', 1_000, 1_000)
}

function insertCategory(db: Database.Database, id: string, kind = 'expense'): void {
  db.prepare(`
    INSERT INTO ledger_categories (
      id, kind, name, normalized_name, archived_at, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, 1, ?, ?)
  `).run(id, kind, `Category ${id}`, `category ${id}`, 1_000, 1_000)
}

function insertIncome(
  db: Database.Database,
  id: string,
  accountId: string,
  categoryId: string,
  overrides: Record<string, unknown> = {},
): void {
  const values = {
    type: 'income',
    amountMinor: 100,
    accountId,
    fromAccountId: null,
    toAccountId: null,
    categoryId,
    occurredAt: 2_000,
    payee: '',
    note: '',
    calculated: null,
    target: null,
    deletedAt: null,
    version: 1,
    createdAt: 2_000,
    updatedAt: 2_000,
    ...overrides,
  }
  db.prepare(`
    INSERT INTO ledger_transactions (
      id, type, amount_minor, account_id, from_account_id, to_account_id,
      category_id, occurred_at, payee, note,
      adjustment_calculated_balance_minor, adjustment_target_balance_minor,
      deleted_at, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    values.type,
    values.amountMinor,
    values.accountId,
    values.fromAccountId,
    values.toAccountId,
    values.categoryId,
    values.occurredAt,
    values.payee,
    values.note,
    values.calculated,
    values.target,
    values.deletedAt,
    values.version,
    values.createdAt,
    values.updatedAt,
  )
}

function insertTransfer(
  db: Database.Database,
  id: string,
  fromAccountId: string,
  toAccountId: string,
  overrides: Record<string, unknown> = {},
): void {
  const values = {
    amountMinor: 100,
    categoryId: null,
    payee: '',
    ...overrides,
  }
  db.prepare(`
    INSERT INTO ledger_transactions (
      id, type, amount_minor, account_id, from_account_id, to_account_id,
      category_id, occurred_at, payee, note,
      adjustment_calculated_balance_minor, adjustment_target_balance_minor,
      deleted_at, version, created_at, updated_at
    ) VALUES (?, 'transfer', ?, NULL, ?, ?, ?, 2_000, ?, '', NULL, NULL, NULL, 1, 2_000, 2_000)
  `).run(id, values.amountMinor, fromAccountId, toAccountId, values.categoryId, values.payee)
}

function insertAdjustment(
  db: Database.Database,
  id: string,
  accountId: string,
  calculated: number,
  target: number,
  overrides: Record<string, unknown> = {},
): void {
  const values = {
    amountMinor: target - calculated,
    payee: '',
    ...overrides,
  }
  db.prepare(`
    INSERT INTO ledger_transactions (
      id, type, amount_minor, account_id, from_account_id, to_account_id,
      category_id, occurred_at, payee, note,
      adjustment_calculated_balance_minor, adjustment_target_balance_minor,
      deleted_at, version, created_at, updated_at
    ) VALUES (?, 'adjustment', ?, ?, NULL, NULL, NULL, 2_000, ?, '', ?, ?, NULL, 1, 2_000, 2_000)
  `).run(id, values.amountMinor, accountId, values.payee, calculated, target)
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    if (db.open) db.close()
  }
})

describe('Ledger 0013 foundation migration', () => {
  it('creates the five schema-only Ledger tables and records version 13', () => {
    const db = freshDb()
    applyMigrations(db)

    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(13)
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as Array<{ name: string }>).map((row) => row.name)
    expect(tables).toEqual(expect.arrayContaining([
      'ledger_settings',
      'ledger_accounts',
      'ledger_categories',
      'ledger_transactions',
      'ledger_idempotency',
    ]))
    expect(db.prepare('SELECT COUNT(*) AS count FROM ledger_settings').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM ledger_categories').get()).toEqual({ count: 0 })
    expect(tables.some((name) => /ledger_(monthly|balance|summary|cache)/.test(name))).toBe(false)
  })

  it('upgrades a schema through version 12 and is idempotent on repeat application', () => {
    const db = freshDb()
    db.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (12);
    `)

    applyMigrations(db)
    const firstTableCount = (db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'",
    ).get() as { count: number }).count
    applyMigrations(db)

    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(13)
    expect((db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'",
    ).get() as { count: number }).count).toBe(firstTableCount)
  })

  it('keeps Account names non-unique and Category identity unique without parent/current-balance columns', () => {
    const db = freshDb()
    applyMigrations(db)
    insertAccount(db, 'same-name-a')
    insertAccount(db, 'same-name-b')
    expect(() => db.prepare(`
      INSERT INTO ledger_accounts (
        id, name, type, nature, opening_balance_minor, opening_date, currency,
        note, version, created_at, updated_at
      ) VALUES ('same-name-c', 'Account same-name-a', 'cash', 'asset', 0, '2026-01-01', 'CNY', '', 1, 1, 1)
    `).run()).not.toThrow()

    insertCategory(db, 'category-a')
    expect(() => db.prepare(`
      INSERT INTO ledger_categories (id, kind, name, normalized_name, version, created_at, updated_at)
      VALUES ('category-b', 'expense', 'Different display', 'category category-a', 1, 1, 1)
    `).run()).toThrow()

    const accountColumns = (db.prepare('PRAGMA table_info(ledger_accounts)').all() as Array<{ name: string }>)
      .map((column) => column.name)
    const categoryColumns = (db.prepare('PRAGMA table_info(ledger_categories)').all() as Array<{ name: string }>)
      .map((column) => column.name)
    expect(accountColumns).not.toContain('current_balance_minor')
    expect(categoryColumns).not.toContain('parent_id')
  })

  it('creates the accepted indexes and enables foreign keys for the test connection', () => {
    const db = freshDb()
    applyMigrations(db)
    const indexes = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_ledger_%' ORDER BY name",
    ).all() as Array<{ name: string }>).map((row) => row.name)
    expect(indexes).toEqual(expect.arrayContaining([
      'idx_ledger_accounts_archived_updated',
      'idx_ledger_categories_kind_archived_name',
      'idx_ledger_transactions_active_order',
      'idx_ledger_transactions_account',
      'idx_ledger_transactions_from_account',
      'idx_ledger_transactions_to_account',
      'idx_ledger_transactions_category',
    ]))
    expect((db.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0]?.foreign_keys).toBe(1)
  })

  it('enforces singleton, idempotency identity, and row-local transaction shapes', () => {
    const db = freshDb()
    applyMigrations(db)
    expect(() => db.prepare(`
      INSERT INTO ledger_settings (
        singleton_id, base_currency, timezone, created_at, updated_at
      ) VALUES (2, 'CNY', 'Asia/Shanghai', 1, 1)
    `).run()).toThrow()

    db.prepare(`
      INSERT INTO ledger_idempotency (
        operation_scope, idempotency_key, request_fingerprint, response_status,
        response_body_json, result_status, result_type, result_id, created_at
      ) VALUES ('POST:/api/ledger/transactions', 'retry-1', ?, 201, '{}', 'committed', 'transaction', 'tx-1', 1)
    `).run('a'.repeat(64))
    expect(() => db.prepare(`
      INSERT INTO ledger_idempotency (
        operation_scope, idempotency_key, request_fingerprint, response_status,
        response_body_json, result_status, created_at
      ) VALUES ('POST:/api/ledger/transactions', 'retry-1', ?, 201, '{}', 'committed', 2)
    `).run('b'.repeat(64))).toThrow()

    insertAccount(db, 'account-a')
    insertAccount(db, 'account-b')
    insertCategory(db, 'expense-a')
    insertCategory(db, 'income-a', 'income')

    expect(() => insertIncome(db, 'bad-missing-account', 'missing-account', 'expense-a')).toThrow()
    expect(() => insertIncome(db, 'bad-missing-category', 'account-a', 'missing-category')).toThrow()
    expect(() => insertIncome(db, 'bad-transfer-fields', 'account-a', 'expense-a', {
      fromAccountId: 'account-b',
    })).toThrow()
    expect(() => insertTransfer(db, 'bad-same-account', 'account-a', 'account-a')).toThrow()
    expect(() => insertTransfer(db, 'bad-transfer-category', 'account-a', 'account-b', {
      categoryId: 'expense-a',
    })).toThrow()
    expect(() => insertTransfer(db, 'bad-transfer-amount', 'account-a', 'account-b', {
      amountMinor: 0,
    })).toThrow()
    expect(() => insertAdjustment(db, 'bad-zero-adjustment', 'account-a', 100, 100, {
      amountMinor: 0,
    })).toThrow()
    expect(() => insertAdjustment(db, 'valid-adjustment-shape', 'account-a', 100, 200, {
      amountMinor: 100,
    })).not.toThrow()
    expect(() => db.prepare(`
      INSERT INTO ledger_transactions (
        id, type, amount_minor, account_id, occurred_at, payee, note,
        adjustment_calculated_balance_minor, adjustment_target_balance_minor,
        version, created_at, updated_at
      ) VALUES ('bad-adjustment-missing-values', 'adjustment', 100, 'account-a', 2000, '', '', NULL, 200, 1, 2000, 2000)
    `).run()).toThrow()
    expect(() => insertAdjustment(db, 'bad-adjustment-delta', 'account-a', 100, 200, {
      amountMinor: 99,
    })).toThrow()
    expect(() => insertIncome(db, 'bad-type', 'account-a', 'expense-a', {
      type: 'not-a-transaction',
    })).toThrow()
  })

  it('enforces RESTRICT for both active and soft-deleted transaction history', () => {
    const db = freshDb()
    applyMigrations(db)
    insertAccount(db, 'account-history')
    insertCategory(db, 'category-history')
    insertIncome(db, 'history-row', 'account-history', 'category-history')

    expect(() => db.prepare('DELETE FROM ledger_accounts WHERE id = ?').run('account-history')).toThrow()
    expect(() => db.prepare('DELETE FROM ledger_categories WHERE id = ?').run('category-history')).toThrow()

    db.prepare('UPDATE ledger_transactions SET deleted_at = ? WHERE id = ?').run(3_000, 'history-row')
    expect(() => db.prepare('DELETE FROM ledger_accounts WHERE id = ?').run('account-history')).toThrow()
    expect(() => db.prepare('DELETE FROM ledger_categories WHERE id = ?').run('category-history')).toThrow()
  })
})
