import { afterEach, describe, expect, it } from 'vitest'
import type {
  LedgerAccountDto,
  LedgerCategoryDto,
  LedgerSettingsCreateRequest,
  LedgerTransactionDto,
  LedgerTransactionQuery,
} from '../../shared/ledgerProtocol.js'
import type { LedgerTransaction } from './domain.js'
import { createLedgerRepository, type LedgerRepository } from './repository.js'
import { createLedgerProjections, type LedgerProjections } from './projections.js'
import { createLedgerService, type LedgerService } from './service.js'
import { LedgerError } from './errors.js'
import {
  parseAccountCreateRequest,
  parseCategoryCreateRequest,
  parseSettingsCreateRequest,
  parseTransactionCreateRequest,
  parseTransactionQuery,
} from './validation.js'
import {
  createLedgerTestDatabase,
  type LedgerTestDatabase,
} from '../__tests__/helpers/ledgerDb.js'

const databases: LedgerTestDatabase[] = []
const TEST_NOW = Date.parse('2026-09-02T04:00:00.000Z')

interface ProjectionFixture {
  readonly database: LedgerTestDatabase
  readonly repository: LedgerRepository
  readonly service: LedgerService
  readonly projections: LedgerProjections
  readonly clock: { value: number }
}

function freshFixture(
  timezone = 'Asia/Shanghai',
  now = TEST_NOW,
): ProjectionFixture {
  const database = createLedgerTestDatabase()
  databases.push(database)
  const repository = createLedgerRepository(database.db)
  const clock = { value: now }
  let nextId = 0
  const createId = () => `projection-test-${String(++nextId).padStart(4, '0')}`
  const service = createLedgerService(database.db, repository, {
    createId,
    now: () => clock.value,
  })
  const projections = createLedgerProjections(repository, { now: () => clock.value })
  const settings: LedgerSettingsCreateRequest = parseSettingsCreateRequest({
    baseCurrency: 'CNY',
    timezone,
  })
  service.createSettings(settings, 'projection-settings')
  return { database, repository, service, projections, clock }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.cleanup()
})

function account(
  fixture: ProjectionFixture,
  key: string,
  overrides: Record<string, unknown> = {},
): LedgerAccountDto {
  const result = fixture.service.createAccount(parseAccountCreateRequest({
    name: 'Projection account',
    type: 'bank',
    nature: 'asset',
    openingBalanceMinor: 0,
    openingDate: '2026-01-01',
    currency: 'CNY',
    ...overrides,
  }), key)
  expect(result.responseStatus).toBe(201)
  return JSON.parse(result.responseBodyJson) as LedgerAccountDto
}

function category(
  fixture: ProjectionFixture,
  key: string,
  overrides: Record<string, unknown> = {},
): LedgerCategoryDto {
  const result = fixture.service.createCategory(parseCategoryCreateRequest({
    kind: 'expense',
    name: `Projection category ${key}`,
    ...overrides,
  }), key)
  expect(result.responseStatus).toBe(201)
  return JSON.parse(result.responseBodyJson) as LedgerCategoryDto
}

function transaction(
  fixture: ProjectionFixture,
  key: string,
  value: Record<string, unknown>,
): LedgerTransactionDto {
  const result = fixture.service.createTransaction(parseTransactionCreateRequest({
    occurredAt: TEST_NOW,
    ...value,
  }), key)
  expect(result.responseStatus).toBe(201)
  return JSON.parse(result.responseBodyJson) as LedgerTransactionDto
}

function adjustment(
  fixture: ProjectionFixture,
  key: string,
  accountId: string,
  targetBalanceMinor: number,
  expectedCalculatedBalanceMinor: number,
): LedgerTransactionDto | null {
  const result = fixture.service.adjustAccount(accountId, {
    targetBalanceMinor,
    expectedCalculatedBalanceMinor,
    occurredAt: TEST_NOW,
    note: 'projection adjustment',
  }, key)
  const body = JSON.parse(result.responseBodyJson) as {
    adjustment: LedgerTransactionDto | null
  }
  return body.adjustment
}

function query(overrides: Record<string, unknown> = {}): LedgerTransactionQuery {
  return parseTransactionQuery(overrides)
}

function firstCategory(
  fixture: ProjectionFixture,
  kind: 'income' | 'expense',
): LedgerCategoryDto {
  const found = fixture.repository.listCategories({ includeArchived: true })
    .find((candidate) => candidate.kind === kind)
  if (!found) throw new Error(`missing seeded ${kind} category`)
  return {
    ...found,
    archivedAt: found.archivedAt,
    version: found.version,
    createdAt: found.createdAt,
    updatedAt: found.updatedAt,
  }
}

function expectLedgerCode(callback: () => unknown, code: LedgerError['code']): void {
  try {
    callback()
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerError)
    expect((error as LedgerError).code).toBe(code)
    return
  }
  throw new Error(`Expected LedgerError ${code}`)
}

function insertValidTransaction(
  repository: LedgerRepository,
  transactionValue: LedgerTransaction,
): void {
  repository.insertTransaction(transactionValue)
}

describe('Ledger transaction query projections', () => {
  it('applies active/type/account/category/date filters and includes Adjustment in type=all', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'account-a')
    const other = account(fixture, 'account-b', { name: 'Other account' })
    const expenseCategory = firstCategory(fixture, 'expense')
    const incomeCategory = firstCategory(fixture, 'income')

    const income = transaction(fixture, 'income', {
      type: 'income', amountMinor: 100, accountId: asset.id, categoryId: incomeCategory.id,
      occurredAt: TEST_NOW - 3_000, payee: 'Salary',
    })
    const expense = transaction(fixture, 'expense', {
      type: 'expense', amountMinor: 25, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 2_000, payee: 'Coffee',
    })
    const transfer = transaction(fixture, 'transfer', {
      type: 'transfer', amountMinor: 10, fromAccountId: asset.id, toAccountId: other.id,
      occurredAt: TEST_NOW - 1_000,
    })
    const adjustmentRow = adjustment(fixture, 'adjustment', asset.id, 66, 65)
    expect(adjustmentRow).not.toBeNull()

    const all = fixture.projections.listTransactions(query())
    expect(all.transactions.map((row) => row.id)).toEqual([
      adjustmentRow!.id,
      transfer.id,
      expense.id,
      income.id,
    ])
    expect(all.transactions.map((row) => row.type)).toEqual([
      'adjustment', 'transfer', 'expense', 'income',
    ])

    expect(fixture.projections.listTransactions(query({ type: 'income' })).transactions)
      .toEqual([income])
    expect(fixture.projections.listTransactions(query({ type: 'expense' })).transactions)
      .toEqual([expense])
    expect(fixture.projections.listTransactions(query({ type: 'transfer' })).transactions)
      .toEqual([transfer])
    expect(fixture.projections.listTransactions(query({ accountId: other.id }))
      .transactions.map((row) => row.id)).toEqual([transfer.id])
    expect(fixture.projections.listTransactions(query({ categoryId: expenseCategory.id }))
      .transactions.map((row) => row.id)).toEqual([expense.id])
    expect(fixture.projections.listTransactions(query({
      from: String(TEST_NOW - 2_000),
      to: String(TEST_NOW + 1),
    })).transactions.map((row) => row.id)).toEqual([
      adjustmentRow!.id, transfer.id, expense.id,
    ])
  })

  it('uses literal search matching and excludes deleted rows by default', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'search-account')
    const expenseCategory = firstCategory(fixture, 'expense')
    const percent = transaction(fixture, 'percent', {
      type: 'expense', amountMinor: 1, accountId: asset.id, categoryId: expenseCategory.id,
      payee: '100%', occurredAt: TEST_NOW - 3_000,
    })
    const underscore = transaction(fixture, 'underscore', {
      type: 'expense', amountMinor: 1, accountId: asset.id, categoryId: expenseCategory.id,
      payee: 'a_b', occurredAt: TEST_NOW - 2_000,
    })
    const slash = transaction(fixture, 'slash', {
      type: 'expense', amountMinor: 1, accountId: asset.id, categoryId: expenseCategory.id,
      note: 'c\\d', occurredAt: TEST_NOW - 1_000,
    })

    expect(fixture.projections.listTransactions(query({ search: ' 100% ' })).transactions)
      .toEqual([percent])
    expect(fixture.projections.listTransactions(query({ search: 'a_b' })).transactions)
      .toEqual([underscore])
    expect(fixture.projections.listTransactions(query({ search: 'c\\d' })).transactions)
      .toEqual([slash])
    expect(fixture.projections.listTransactions(query({ search: '   ' })).transactions)
      .toHaveLength(3)

    fixture.service.deleteTransaction(percent.id, { expectedVersion: 1 })
    expect(fixture.projections.listTransactions(query({ search: '100%' })).transactions)
      .toHaveLength(0)
    expect(fixture.projections.listTransactions(query({ search: '100%', includeDeleted: 'true' })).transactions)
      .toHaveLength(1)
  })

  it('keeps the three-field keyset order continuous across pages', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'cursor-account')
    const expenseCategory = firstCategory(fixture, 'expense')
    const rows: LedgerTransaction[] = [
      {
        id: 'cursor-a', type: 'expense', amountMinor: 1, accountId: asset.id,
        categoryId: expenseCategory.id, occurredAt: TEST_NOW, payee: '', note: '',
        deletedAt: null, version: 1, createdAt: TEST_NOW, updatedAt: TEST_NOW,
      },
      {
        id: 'cursor-b', type: 'expense', amountMinor: 2, accountId: asset.id,
        categoryId: expenseCategory.id, occurredAt: TEST_NOW, payee: '', note: '',
        deletedAt: null, version: 1, createdAt: TEST_NOW, updatedAt: TEST_NOW,
      },
      {
        id: 'cursor-c', type: 'expense', amountMinor: 3, accountId: asset.id,
        categoryId: expenseCategory.id, occurredAt: TEST_NOW, payee: '', note: '',
        deletedAt: null, version: 1, createdAt: TEST_NOW, updatedAt: TEST_NOW,
      },
    ]
    rows.forEach((row) => insertValidTransaction(fixture.repository, row))

    const full = fixture.projections.listTransactions(query({ limit: '200' }))
    expect(full.transactions.map((row) => row.id)).toEqual(['cursor-c', 'cursor-b', 'cursor-a'])

    const pageIds: string[] = []
    let cursor: string | undefined
    for (;;) {
      const page = fixture.projections.listTransactions(query({
        limit: '1',
        ...(cursor === undefined ? {} : { cursor }),
      }))
      pageIds.push(...page.transactions.map((row) => row.id))
      if (page.page.nextCursor === null) break
      cursor = page.page.nextCursor
    }
    expect(pageIds).toEqual(full.transactions.map((row) => row.id))
    expect(new Set(pageIds).size).toBe(pageIds.length)

    expectLedgerCode(
      () => fixture.projections.listTransactions(query({ cursor: 'not-a-cursor' })),
      'ledger-validation-failed',
    )
  })
})

describe('Ledger Account Detail projections', () => {
  it('computes complete current-month movement independently of page limit', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'movement-asset')
    const other = account(fixture, 'movement-other', { name: 'Movement other' })
    const expenseCategory = firstCategory(fixture, 'expense')
    const incomeCategory = firstCategory(fixture, 'income')

    transaction(fixture, 'movement-income', {
      type: 'income', amountMinor: 100, accountId: asset.id, categoryId: incomeCategory.id,
      occurredAt: TEST_NOW - 5_000,
    })
    transaction(fixture, 'movement-expense', {
      type: 'expense', amountMinor: 20, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 4_000,
    })
    transaction(fixture, 'movement-transfer', {
      type: 'transfer', amountMinor: 30, fromAccountId: asset.id, toAccountId: other.id,
      occurredAt: TEST_NOW - 3_000,
    })
    transaction(fixture, 'outside-month', {
      type: 'expense', amountMinor: 999, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: Date.parse('2026-08-31T15:59:59.999Z'),
    })
    const deleted = transaction(fixture, 'movement-deleted', {
      type: 'expense', amountMinor: 500, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 1_000,
    })
    fixture.service.deleteTransaction(deleted.id, { expectedVersion: 1 })
    adjustment(fixture, 'movement-adjustment', asset.id, -929, -949)

    const detail = fixture.projections.getAccountTransactions(asset.id, query({ limit: '1' }))
    expect(detail.transactions).toHaveLength(1)
    expect(detail.transactions[0]?.type).toBe('adjustment')
    expect(detail.account.currentBalanceMinor).toBe(-929)
    expect(detail.movement).toEqual({ balanceIncreaseMinor: 100, balanceDecreaseMinor: 50 })
  })

  it('uses natural-balance wording-neutral movement fields for liabilities', () => {
    const fixture = freshFixture()
    const card = account(fixture, 'movement-card', {
      name: 'Card', type: 'credit_card', nature: 'liability',
    })
    const otherCard = account(fixture, 'movement-card-other', {
      name: 'Other card', type: 'credit_card', nature: 'liability',
    })
    const expenseCategory = firstCategory(fixture, 'expense')
    const incomeCategory = firstCategory(fixture, 'income')

    transaction(fixture, 'liability-expense', {
      type: 'expense', amountMinor: 20, accountId: card.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 4_000,
    })
    transaction(fixture, 'liability-income', {
      type: 'income', amountMinor: 10, accountId: card.id, categoryId: incomeCategory.id,
      occurredAt: TEST_NOW - 3_000,
    })
    transaction(fixture, 'liability-outgoing', {
      type: 'transfer', amountMinor: 30, fromAccountId: card.id, toAccountId: otherCard.id,
      occurredAt: TEST_NOW - 2_000,
    })
    transaction(fixture, 'liability-incoming', {
      type: 'transfer', amountMinor: 5, fromAccountId: otherCard.id, toAccountId: card.id,
      occurredAt: TEST_NOW - 1_000,
    })

    expect(fixture.projections.getAccountTransactions(card.id, query()).movement).toEqual({
      balanceIncreaseMinor: 50,
      balanceDecreaseMinor: 15,
    })
  })
})

describe('Ledger Overview and trend projections', () => {
  it('derives current balances, checked totals, net worth, and excludes Transfer from cashflow', () => {
    const fixture = freshFixture()
    const bank = account(fixture, 'overview-bank', { openingBalanceMinor: 1_000 })
    const card = account(fixture, 'overview-card', {
      name: 'Credit card', type: 'credit_card', nature: 'liability', openingBalanceMinor: 200,
    })
    const expenseCategory = firstCategory(fixture, 'expense')
    const incomeCategory = firstCategory(fixture, 'income')
    transaction(fixture, 'overview-income', {
      type: 'income', amountMinor: 100, accountId: bank.id, categoryId: incomeCategory.id,
      occurredAt: TEST_NOW - 5_000,
    })
    transaction(fixture, 'overview-bank-expense', {
      type: 'expense', amountMinor: 40, accountId: bank.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 4_000,
    })
    transaction(fixture, 'overview-card-expense', {
      type: 'expense', amountMinor: 50, accountId: card.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 3_000,
    })
    transaction(fixture, 'overview-repayment', {
      type: 'transfer', amountMinor: 30, fromAccountId: bank.id, toAccountId: card.id,
      occurredAt: TEST_NOW - 2_000,
    })

    const overview = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    expect(overview.currency).toBe('CNY')
    expect(overview.currencyExponent).toBe(2)
    expect(overview.assetTotalMinor).toBe(1_030)
    expect(overview.liabilityTotalMinor).toBe(220)
    expect(overview.netWorthMinor).toBe(810)
    expect(overview.cashflow).toEqual({ incomeMinor: 100, expenseMinor: 90, balanceMinor: 10 })
    expect(overview.categoryBreakdown.expense).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryId: expenseCategory.id, amountMinor: 90 }),
    ]))
    expect(overview.periods.map((period) => period.period)).toEqual(['today', 'week', 'month', 'year'])
    expect(overview.recentTransactions).toHaveLength(4)
  })

  it('keeps scope-independent fields fixed while periodizing only cashflow and categories', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'scope-account')
    const expenseCategory = firstCategory(fixture, 'expense')
    const incomeCategory = firstCategory(fixture, 'income')
    transaction(fixture, 'scope-current-expense', {
      type: 'expense', amountMinor: 10, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 1_000,
    })
    transaction(fixture, 'scope-old-income', {
      type: 'income', amountMinor: 100, accountId: asset.id, categoryId: incomeCategory.id,
      occurredAt: Date.parse('2026-01-15T00:00:00.000Z'),
    })

    const today = fixture.projections.getOverview({ scope: 'today', anchorDate: undefined })
    const month = fixture.projections.getOverview({ scope: 'month', anchorDate: undefined })
    const all = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    for (const candidate of [today, month]) {
      expect(candidate.assetTotalMinor).toBe(all.assetTotalMinor)
      expect(candidate.liabilityTotalMinor).toBe(all.liabilityTotalMinor)
      expect(candidate.netWorthMinor).toBe(all.netWorthMinor)
      expect(candidate.accounts).toEqual(all.accounts)
      expect(candidate.periods).toEqual(all.periods)
      expect(candidate.trend).toEqual(all.trend)
      expect(candidate.recentTransactions).toEqual(all.recentTransactions)
    }
    expect(today.cashflow).toEqual({ incomeMinor: 0, expenseMinor: 10, balanceMinor: -10 })
    expect(month.cashflow).toEqual(today.cashflow)
    expect(all.cashflow).toEqual({ incomeMinor: 100, expenseMinor: 10, balanceMinor: 90 })
  })

  it('anchors complete natural periods while keeping the Current Snapshot on NOW semantics', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'anchored-account', { openingBalanceMinor: 1_000 })
    const expenseCategory = firstCategory(fixture, 'expense')
    const incomeCategory = firstCategory(fixture, 'income')
    const atShanghaiNoon = (date: string): number => Date.parse(`${date}T12:00:00+08:00`)

    transaction(fixture, 'anchored-aug-start', {
      type: 'expense', amountMinor: 10, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: atShanghaiNoon('2026-08-01'),
    })
    transaction(fixture, 'anchored-aug-anchor', {
      type: 'expense', amountMinor: 5, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: atShanghaiNoon('2026-08-20'),
    })
    transaction(fixture, 'anchored-aug-after-anchor', {
      type: 'expense', amountMinor: 40, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: atShanghaiNoon('2026-08-25'),
    })
    transaction(fixture, 'anchored-september', {
      type: 'expense', amountMinor: 50, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: atShanghaiNoon('2026-09-01'),
    })
    transaction(fixture, 'anchored-income', {
      type: 'income', amountMinor: 100, accountId: asset.id, categoryId: incomeCategory.id,
      occurredAt: atShanghaiNoon('2026-08-21'),
    })

    const overview = fixture.projections.getOverview({
      scope: 'month',
      anchorDate: '2026-08-20',
    })
    expect(overview.context).toEqual({
      anchorDate: '2026-08-20',
      todayDate: '2026-09-02',
      isToday: false,
      scope: 'month',
    })
    expect(overview.cashflow).toEqual({ incomeMinor: 100, expenseMinor: 55, balanceMinor: 45 })
    expect(overview.categoryBreakdown.expense).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryId: expenseCategory.id, amountMinor: 55 }),
    ]))
    expect(overview.periods.find((period) => period.period === 'today')).toMatchObject({
      incomeMinor: 0, expenseMinor: 5, balanceMinor: -5,
    })
    expect(overview.periods.find((period) => period.period === 'week')).toMatchObject({
      incomeMinor: 100, expenseMinor: 5, balanceMinor: 95,
    })
    expect(overview.periods.find((period) => period.period === 'month')).toMatchObject({
      incomeMinor: 100, expenseMinor: 55, balanceMinor: 45,
    })
    expect(overview.periods.find((period) => period.period === 'year')).toMatchObject({
      incomeMinor: 100, expenseMinor: 105, balanceMinor: -5,
    })
    expect(overview.trend.at(-1)).toMatchObject({ month: '2026-08', incomeMinor: 100, expenseMinor: 55 })

    // The September transaction remains part of the current balance even
    // though it is outside the historical August period analysis.
    expect(overview.assetTotalMinor).toBe(995)
    expect(overview.accounts[0]?.currentBalanceMinor).toBe(995)
    expect(overview.recentTransactions.every((row) => row.occurredAt < atShanghaiNoon('2026-08-21'))).toBe(true)

    const all = fixture.projections.getOverview({
      scope: 'all',
      anchorDate: '2026-08-20',
    })
    expect(all.cashflow).toEqual({ incomeMinor: 0, expenseMinor: 15, balanceMinor: -15 })
    expect(all.context.scope).toBe('all')
  })

  it('returns an independent five-row Recent Transactions cutoff with canonical ordering', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'anchored-recent-account')
    const expenseCategory = firstCategory(fixture, 'expense')
    const atShanghaiNoon = (date: string): number => Date.parse(`${date}T12:00:00+08:00`)

    const ids: string[] = []
    for (let index = 0; index < 6; index += 1) {
      const row = transaction(fixture, `anchored-recent-${index}`, {
        type: 'expense', amountMinor: index + 1, accountId: asset.id, categoryId: expenseCategory.id,
        occurredAt: atShanghaiNoon(`2026-08-${String(14 + index).padStart(2, '0')}`),
      })
      ids.push(row.id)
    }
    const afterAnchor = transaction(fixture, 'anchored-recent-after', {
      type: 'expense', amountMinor: 99, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: atShanghaiNoon('2026-08-21'),
    })
    const deleted = fixture.repository.getTransaction(ids[0]!)!
    fixture.service.deleteTransaction(deleted.id, { expectedVersion: deleted.version })

    const overview = fixture.projections.getOverview({
      scope: 'today',
      anchorDate: '2026-08-20',
    })
    expect(overview.recentTransactions).toHaveLength(5)
    expect(overview.recentTransactions.map((row) => row.id)).toEqual(ids.slice(1).reverse())
    expect(overview.recentTransactions.map((row) => row.id)).not.toContain(afterAnchor.id)
    expect(overview.recentTransactions.every((row) => row.deletedAt === null)).toBe(true)
  })

  it('keeps archived Category identity and current name in historical breakdowns', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'archived-category-account')
    const archivedCategory = category(fixture, 'archived-category')
    transaction(fixture, 'archived-category-expense', {
      type: 'expense', amountMinor: 12, accountId: asset.id, categoryId: archivedCategory.id,
      occurredAt: TEST_NOW - 1_000,
    })
    const archived = fixture.service.archiveCategory(archivedCategory.id, { expectedVersion: 1 })
    expect(archived.archivedAt).not.toBeNull()

    const overview = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    expect(overview.categoryBreakdown.expense).toEqual(expect.arrayContaining([
      expect.objectContaining({
        categoryId: archivedCategory.id,
        name: archivedCategory.name,
        amountMinor: 12,
      }),
    ]))
  })

  it('updates live projections after Adjustment and soft delete without adding cashflow', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'live-account')
    const expenseCategory = firstCategory(fixture, 'expense')
    const expense = transaction(fixture, 'live-expense', {
      type: 'expense', amountMinor: 25, accountId: asset.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 1_000,
    })
    const before = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    const adjustmentRow = adjustment(fixture, 'live-adjustment', asset.id, 10, -25)
    expect(adjustmentRow).not.toBeNull()
    const adjusted = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    expect(adjusted.accounts[0].currentBalanceMinor).toBe(10)
    expect(adjusted.cashflow).toEqual(before.cashflow)
    expect(adjusted.categoryBreakdown).toEqual(before.categoryBreakdown)
    expect(adjusted.trend).toEqual(before.trend)

    fixture.service.deleteTransaction(expense.id, { expectedVersion: 1 })
    const deleted = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    expect(deleted.accounts[0].currentBalanceMinor).toBe(35)
    expect(deleted.cashflow).toEqual({ incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 })
    expect(deleted.recentTransactions.map((row) => row.id)).toEqual([adjustmentRow!.id])
  })

  it('preserves Transfer net worth and separates credit-card repayment from expense', () => {
    const fixture = freshFixture()
    const bank = account(fixture, 'net-worth-bank', { openingBalanceMinor: 100 })
    const card = account(fixture, 'net-worth-card', {
      name: 'Net worth card', type: 'credit_card', nature: 'liability', openingBalanceMinor: 100,
    })
    const expenseCategory = firstCategory(fixture, 'expense')
    const before = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    transaction(fixture, 'card-expense', {
      type: 'expense', amountMinor: 20, accountId: card.id, categoryId: expenseCategory.id,
      occurredAt: TEST_NOW - 2_000,
    })
    const afterExpense = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    expect(afterExpense.netWorthMinor).toBe(before.netWorthMinor - 20)
    const beforeTransfer = afterExpense.netWorthMinor
    transaction(fixture, 'card-repayment', {
      type: 'transfer', amountMinor: 30, fromAccountId: bank.id, toAccountId: card.id,
      occurredAt: TEST_NOW - 1_000,
    })
    const afterTransfer = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    expect(afterTransfer.netWorthMinor).toBe(beforeTransfer)
    expect(afterTransfer.cashflow).toEqual({ incomeMinor: 0, expenseMinor: 20, balanceMinor: -20 })
  })

  it('returns fixed recent five active records and calendar-month trend points', () => {
    const fixture = freshFixture()
    const asset = account(fixture, 'recent-account')
    const expenseCategory = firstCategory(fixture, 'expense')
    for (let index = 0; index < 6; index += 1) {
      transaction(fixture, `recent-${index}`, {
        type: 'expense', amountMinor: index + 1, accountId: asset.id, categoryId: expenseCategory.id,
        occurredAt: TEST_NOW - (index + 1) * 1_000,
      })
      fixture.clock.value += 1
    }
    const newest = fixture.repository.listActiveTransactions()[0]
    fixture.service.deleteTransaction(newest.id, { expectedVersion: 1 })
    adjustment(fixture, 'recent-adjustment', asset.id, -22, -20)

    const overview = fixture.projections.getOverview({ scope: 'all', anchorDate: undefined })
    expect(overview.recentTransactions).toHaveLength(5)
    expect(overview.recentTransactions.every((row) => row.deletedAt === null)).toBe(true)
    expect(overview.recentTransactions.some((row) => row.type === 'adjustment')).toBe(true)
    expect(overview.trend.map((point) => point.month)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ])
    expect(fixture.projections.getTrend(3).map((point) => point.month)).toEqual([
      '2026-07', '2026-08', '2026-09',
    ])
  })

  it('rejects an unsafe aggregate even when every persisted amount is safe', () => {
    const fixture = freshFixture()
    const first = account(fixture, 'overflow-first')
    const second = account(fixture, 'overflow-second', { name: 'Overflow second' })
    const incomeCategory = firstCategory(fixture, 'income')
    const amountMinor = 5_000_000_000_000_000
    const base = {
      type: 'income' as const,
      categoryId: incomeCategory.id,
      occurredAt: TEST_NOW - 1_000,
      payee: '',
      note: '',
      deletedAt: null,
      version: 1,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    }
    insertValidTransaction(fixture.repository, {
      ...base,
      id: 'overflow-first-transaction',
      amountMinor,
      accountId: first.id,
    })
    insertValidTransaction(fixture.repository, {
      ...base,
      id: 'overflow-second-transaction',
      amountMinor,
      accountId: second.id,
    })

    expectLedgerCode(
      () => fixture.projections.getOverview({ scope: 'all', anchorDate: undefined }),
      'ledger-money-overflow',
    )
  })

  it('rejects uninitialized reads and malformed trend counts', () => {
    const database = createLedgerTestDatabase()
    databases.push(database)
    const repository = createLedgerRepository(database.db)
    const projections = createLedgerProjections(repository, { now: () => TEST_NOW })
    expectLedgerCode(() => projections.getOverview({ scope: 'all', anchorDate: undefined }), 'ledger-not-found')
    expectLedgerCode(() => projections.getTrend(0), 'ledger-not-found')

    const fixture = freshFixture()
    expectLedgerCode(() => parseTransactionQuery({ from: String(TEST_NOW), to: String(TEST_NOW) }), 'ledger-validation-failed')
    expectLedgerCode(() => fixture.projections.getTrend(0), 'ledger-validation-failed')
  })
})
