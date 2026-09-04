import { afterEach, describe, expect, it } from 'vitest'
import type {
  LedgerAccountDto,
  LedgerAccountCreateRequest,
  LedgerCategoryDto,
  LedgerCategoryCreateRequest,
  LedgerSettingsCreateRequest,
} from '../../shared/ledgerProtocol.js'
import { DEFAULT_LEDGER_CATEGORIES_V1 } from './defaultCategories.js'
import { LedgerError } from './errors.js'
import { createLedgerRepository, type LedgerRepository } from './repository.js'
import { createLedgerService, type LedgerService } from './service.js'
import {
  parseAccountCreateRequest,
  parseCategoryCreateRequest,
  parseSettingsCreateRequest,
} from './validation.js'
import {
  createLedgerTestDatabase,
  type LedgerTestDatabase,
} from '../__tests__/helpers/ledgerDb.js'

const databases: LedgerTestDatabase[] = []

const EXPECTED_DEFAULT_LEDGER_CATEGORIES_V1 = [
  { kind: 'expense', name: '餐饮' },
  { kind: 'expense', name: '交通' },
  { kind: 'expense', name: '购物' },
  { kind: 'expense', name: '住房' },
  { kind: 'expense', name: '日用' },
  { kind: 'expense', name: '娱乐' },
  { kind: 'expense', name: '医疗' },
  { kind: 'expense', name: '教育' },
  { kind: 'expense', name: '旅行' },
  { kind: 'expense', name: '人情' },
  { kind: 'expense', name: '其他' },
  { kind: 'income', name: '工资' },
  { kind: 'income', name: '奖金' },
  { kind: 'income', name: '投资收益' },
  { kind: 'income', name: '兼职' },
  { kind: 'income', name: '退款' },
  { kind: 'income', name: '红包' },
  { kind: 'income', name: '其他' },
] as const

function freshService(): {
  database: LedgerTestDatabase
  repository: LedgerRepository
  service: LedgerService
} {
  const database = createLedgerTestDatabase()
  databases.push(database)
  const repository = createLedgerRepository(database.db)
  let nextId = 0
  let nextTime = 1_700_000_000_000
  const service = createLedgerService(database.db, repository, {
    createId: () => `ledger-test-${++nextId}`,
    now: () => nextTime++,
  })
  return { database, repository, service }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.cleanup()
})

function expectLedgerError(callback: () => unknown, code: LedgerError['code']): LedgerError {
  try {
    callback()
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerError)
    expect((error as LedgerError).code).toBe(code)
    return error as LedgerError
  }
  throw new Error(`Expected LedgerError ${code}`)
}

function settingsRequest(overrides: Partial<LedgerSettingsCreateRequest> = {}) {
  return parseSettingsCreateRequest({
    baseCurrency: 'CNY',
    timezone: 'Asia/Shanghai',
    ...overrides,
  })
}

function initialize(service: LedgerService): void {
  const result = service.createSettings(settingsRequest(), 'settings-init')
  expect(result.responseStatus).toBe(201)
}

function accountRequest(
  overrides: Partial<LedgerAccountCreateRequest> = {},
) {
  return parseAccountCreateRequest({
    name: 'Test account',
    type: 'bank',
    nature: 'asset',
    openingBalanceMinor: 0,
    openingDate: '2026-01-01',
    currency: 'CNY',
    ...overrides,
  })
}

function categoryRequest(
  overrides: Partial<LedgerCategoryCreateRequest> = {},
) {
  return parseCategoryCreateRequest({
    kind: 'expense',
    name: 'Custom category',
    ...overrides,
  })
}

function createAccount(
  service: LedgerService,
  key: string,
  overrides: Parameters<typeof accountRequest>[0] = {},
): LedgerAccountDto {
  const result = service.createAccount(accountRequest(overrides), key)
  expect(result.responseStatus).toBe(201)
  return JSON.parse(result.responseBodyJson) as LedgerAccountDto
}

function createCategory(
  service: LedgerService,
  key: string,
  overrides: Parameters<typeof categoryRequest>[0] = {},
): LedgerCategoryDto {
  const result = service.createCategory(categoryRequest(overrides), key)
  expect(result.responseStatus).toBe(201)
  return JSON.parse(result.responseBodyJson) as LedgerCategoryDto
}

describe('Ledger Settings and default Category service', () => {
  it('initializes Settings and seeds the exact ordered v1 catalog once', () => {
    const { service } = freshService()

    initialize(service)

    expect(DEFAULT_LEDGER_CATEGORIES_V1).toEqual(EXPECTED_DEFAULT_LEDGER_CATEGORIES_V1)
    const categories = service.listCategories(undefined, true)
    expect(categories).toHaveLength(DEFAULT_LEDGER_CATEGORIES_V1.length)
    expect(new Set(categories.map((category) => `${category.kind}:${category.name}`))).toEqual(
      new Set(DEFAULT_LEDGER_CATEGORIES_V1.map((category) => `${category.kind}:${category.name}`)),
    )
    expect(service.getSettings()).toMatchObject({
      baseCurrency: 'CNY',
      currencyExponent: 2,
      timezone: 'Asia/Shanghai',
      version: 1,
    })
  })

  it('preserves an existing archived seed identity and never auto-unarchives it', () => {
    const { database, repository, service } = freshService()
    database.db.prepare(`
      INSERT INTO ledger_categories (
        id, kind, name, normalized_name, archived_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('existing-food', 'expense', '餐饮', '餐饮', 1_700_000_000_100, 7, 1_700_000_000_000, 1_700_000_000_000)

    initialize(service)

    const preserved = repository.getCategory('existing-food')
    expect(preserved).toMatchObject({
      id: 'existing-food',
      name: '餐饮',
      normalizedName: '餐饮',
      archivedAt: 1_700_000_000_100,
      version: 7,
    })
    expect(service.listCategories(undefined, true)).toHaveLength(18)
  })

  it('replays the original Settings snapshot and rejects a new identity after initialization', () => {
    const { service } = freshService()
    initialize(service)
    const first = service.createSettings(settingsRequest(), 'settings-init')
    expect(first.replayed).toBe(true)
    expect(first.responseStatus).toBe(201)

    expectLedgerError(
      () => service.createSettings(settingsRequest({ timezone: 'UTC' }), 'another-settings-key'),
      'ledger-settings-already-initialized',
    )
    expectLedgerError(
      () => service.createSettings(settingsRequest({ timezone: 'UTC' }), 'settings-init'),
      'ledger-idempotency-conflict',
    )
  })

  it('rolls back Settings, seed Categories, and the replay row as one mutation', () => {
    const database = createLedgerTestDatabase()
    databases.push(database)
    const repository = createLedgerRepository(database.db)
    let generatedIds = 0
    const failingService = createLedgerService(database.db, repository, {
      now: () => 1_700_000_000_000,
      createId: () => {
        generatedIds += 1
        if (generatedIds === 5) throw new Error('seed failure')
        return `failing-${generatedIds}`
      },
    })

    expect(() => failingService.createSettings(settingsRequest(), 'atomic-settings')).toThrow('seed failure')
    expect(repository.getSettings()).toBeNull()
    expect(repository.listCategories({ includeArchived: true })).toEqual([])
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM ledger_idempotency').get()).toEqual({ count: 0 })

    let retryId = 0
    const retryService = createLedgerService(database.db, repository, {
      now: () => 1_700_000_000_100,
      createId: () => `retry-${++retryId}`,
    })
    expect(retryService.createSettings(settingsRequest(), 'atomic-settings').responseStatus).toBe(201)
    expect(repository.getSettings()).not.toBeNull()
    expect(repository.listCategories({ includeArchived: true })).toHaveLength(18)
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM ledger_idempotency').get()).toEqual({ count: 1 })
  })

  it('keeps Settings mutable before the first Account and locks both fields afterwards', () => {
    const { service } = freshService()
    initialize(service)

    const beforeAccount = service.patchSettings({
      expectedVersion: 1,
      timezone: 'UTC',
      baseCurrency: 'USD',
    })
    expect(beforeAccount).toMatchObject({
      timezone: 'UTC',
      baseCurrency: 'USD',
      currencyExponent: 2,
      version: 2,
    })

    const account = createAccount(service, 'account-freeze', { currency: 'USD' })
    expect(account.currentBalanceMinor).toBe(0)
    expect(service.getSettings().version).toBe(2)

    expectLedgerError(
      () => service.patchSettings({ expectedVersion: 1, timezone: 'Asia/Shanghai' }),
      'ledger-timezone-locked',
    )
    expectLedgerError(
      () => service.patchSettings({ expectedVersion: 1, baseCurrency: 'CNY' }),
      'ledger-base-currency-locked',
    )

    service.deleteAccount(account.id, { expectedVersion: account.version })
    expect(service.getSettings().version).toBe(2)
    expectLedgerError(
      () => service.patchSettings({ expectedVersion: 2, timezone: 'Asia/Shanghai' }),
      'ledger-timezone-locked',
    )
    expectLedgerError(
      () => service.patchSettings({ expectedVersion: 2, baseCurrency: 'CNY' }),
      'ledger-base-currency-locked',
    )
  })
})

describe('Ledger Account service lifecycle', () => {
  it('uses the balance engine for projections and enforces the account PATCH matrix', () => {
    const { repository, service } = freshService()
    initialize(service)
    const account = createAccount(service, 'account-matrix')

    const changed = service.patchAccount(account.id, {
      expectedVersion: account.version,
      openingBalanceMinor: 100,
    })
    expect(changed).toMatchObject({ version: 2, openingBalanceMinor: 100, currentBalanceMinor: 100 })

    expectLedgerError(
      () => service.archiveAccount(account.id, { expectedVersion: changed.version }),
      'ledger-account-nonzero-balance',
    )

    const expenseCategory = service.listCategories('expense', false)[0]!
    repository.insertTransaction({
      id: 'account-history',
      type: 'expense',
      amountMinor: 100,
      accountId: account.id,
      categoryId: expenseCategory.id,
      occurredAt: 1_700_000_001_000,
      payee: '',
      note: '',
      deletedAt: 1_700_000_002_000,
      version: 1,
      createdAt: 1_700_000_001_000,
      updatedAt: 1_700_000_002_000,
    })

    expectLedgerError(
      () => service.patchAccount(account.id, {
        expectedVersion: changed.version,
        openingBalanceMinor: 0,
      }),
      'ledger-validation-failed',
    )
    const renamed = service.patchAccount(account.id, {
      expectedVersion: changed.version,
      name: 'Renamed account',
    })
    expect(renamed).toMatchObject({ name: 'Renamed account', version: 3 })

    const archived = createAccount(service, 'account-archive')
    const archivedVersion = service.archiveAccount(archived.id, { expectedVersion: archived.version })
    expect(archivedVersion).toMatchObject({ archivedAt: expect.any(Number), currentBalanceMinor: 0, version: 2 })
    expect(service.listAccounts(false).some((value) => value.id === archived.id)).toBe(false)
    expect(service.listAccounts(true).some((value) => value.id === archived.id)).toBe(true)

    const archivedRename = service.patchAccount(archived.id, {
      expectedVersion: archivedVersion.version,
      name: 'Archived renamed',
    })
    expect(archivedRename.name).toBe('Archived renamed')
    for (const field of ['openingBalanceMinor', 'openingDate', 'nature', 'type', 'currency']) {
      expectLedgerError(
        () => service.patchAccount(archived.id, {
          expectedVersion: archivedRename.version,
          [field]: field === 'openingBalanceMinor' ? 1
            : field === 'openingDate' ? '2026-02-01'
              : field === 'nature' ? 'liability'
                : field === 'type' ? 'other'
                  : 'USD',
        }),
        'ledger-archived-account',
      )
    }

    const restored = service.restoreAccount(archived.id, { expectedVersion: archivedRename.version })
    expect(restored).toMatchObject({ archivedAt: null, version: archivedRename.version + 1 })
    const activeRestore = service.restoreAccount(archived.id, { expectedVersion: restored.version })
    expect(activeRestore.version).toBe(restored.version)
  })

  it('requires zero natural balance for both asset and liability archive', () => {
    const { service } = freshService()
    initialize(service)
    const asset = createAccount(service, 'zero-asset')
    const liability = createAccount(service, 'zero-liability', {
      type: 'credit_card',
      nature: 'liability',
    })
    expect(service.archiveAccount(asset.id, { expectedVersion: asset.version }).archivedAt).not.toBeNull()
    expect(service.archiveAccount(liability.id, { expectedVersion: liability.version }).archivedAt).not.toBeNull()
  })

  it('checks version before balance and history, and never unfreezes Settings on delete', () => {
    const { repository, service } = freshService()
    initialize(service)
    const nonZero = createAccount(service, 'nonzero', { openingBalanceMinor: 1 })
    expectLedgerError(
      () => service.archiveAccount(nonZero.id, { expectedVersion: 99 }),
      'ledger-version-conflict',
    )
    const category = service.listCategories('expense', false)[0]!
    repository.insertTransaction({
      id: 'delete-history',
      type: 'expense',
      amountMinor: 1,
      accountId: nonZero.id,
      categoryId: category.id,
      occurredAt: 1_700_000_001_000,
      payee: '',
      note: '',
      deletedAt: null,
      version: 1,
      createdAt: 1_700_000_001_000,
      updatedAt: 1_700_000_001_000,
    })
    expectLedgerError(
      () => service.deleteAccount(nonZero.id, { expectedVersion: nonZero.version }),
      'ledger-account-has-history',
    )
    expect(service.getSettings().version).toBe(1)
  })

  it('replays an Account snapshot after the Account is physically deleted', () => {
    const { service } = freshService()
    initialize(service)
    const request = accountRequest({ name: 'Replay account' })
    const first = service.createAccount(request, 'account-replay')
    const snapshot = first.responseBodyJson
    const account = JSON.parse(snapshot) as LedgerAccountDto
    service.deleteAccount(account.id, { expectedVersion: account.version })

    const replay = service.createAccount(request, 'account-replay')
    expect(replay.replayed).toBe(true)
    expect(replay.responseStatus).toBe(201)
    expect(replay.responseBodyJson).toBe(snapshot)
    expect(() => service.getAccount(account.id)).toThrow(LedgerError)
  })
})

describe('Ledger Category service lifecycle', () => {
  it('uses normalized identity for create/rename/kind changes, including archived rows', () => {
    const { service } = freshService()
    initialize(service)

    const category = createCategory(service, 'custom-category', { name: '  Foo  ' })
    expect(category.normalizedName).toBe('foo')
    expectLedgerError(
      () => createCategory(service, 'duplicate-category', { name: 'FOO' }),
      'ledger-duplicate-category',
    )
    const oppositeKind = createCategory(service, 'opposite-kind', { kind: 'income', name: 'FOO' })
    expect(oppositeKind.kind).toBe('income')

    const renamed = service.patchCategory(category.id, {
      expectedVersion: category.version,
      name: 'Bar',
    })
    expect(renamed).toMatchObject({ id: category.id, name: 'Bar', normalizedName: 'bar', version: 2 })
    const archived = service.archiveCategory(renamed.id, { expectedVersion: renamed.version })
    expect(archived.normalizedName).toBe('bar')
    expectLedgerError(
      () => createCategory(service, 'archived-duplicate', { name: ' BAR ' }),
      'ledger-duplicate-category',
    )
    expectLedgerError(
      () => service.patchCategory(category.id, { expectedVersion: archived.version, name: 'Other' }),
      'ledger-archived-category',
    )
    const restored = service.restoreCategory(category.id, { expectedVersion: archived.version })
    expect(restored).toMatchObject({ id: category.id, archivedAt: null, version: 4 })
    expect(service.restoreCategory(category.id, { expectedVersion: restored.version }).version)
      .toBe(restored.version)
    expect(service.deleteCategory(oppositeKind.id, { expectedVersion: oppositeKind.version })).toEqual({
      deleted: true,
      id: oppositeKind.id,
    })
  })

  it('freezes kind after any history and counts soft-deleted history for physical delete', () => {
    const { repository, service } = freshService()
    initialize(service)
    const account = createAccount(service, 'category-history-account')
    const category = createCategory(service, 'category-history', { name: 'Historical' })
    repository.insertTransaction({
      id: 'category-history-transaction',
      type: 'expense',
      amountMinor: 1,
      accountId: account.id,
      categoryId: category.id,
      occurredAt: 1_700_000_001_000,
      payee: '',
      note: '',
      deletedAt: 1_700_000_002_000,
      version: 1,
      createdAt: 1_700_000_001_000,
      updatedAt: 1_700_000_002_000,
    })

    expectLedgerError(
      () => service.patchCategory(category.id, { expectedVersion: category.version, kind: 'income' }),
      'ledger-validation-failed',
    )
    const renamed = service.patchCategory(category.id, {
      expectedVersion: category.version,
      name: 'Renamed historical',
    })
    expect(renamed.normalizedName).toBe('renamed historical')
    expectLedgerError(
      () => service.deleteCategory(category.id, { expectedVersion: renamed.version }),
      'ledger-category-has-history',
    )
  })

  it('replays the original Category snapshot after later lifecycle changes', () => {
    const { service } = freshService()
    initialize(service)
    const request = categoryRequest({ name: 'Replay category' })
    const first = service.createCategory(request, 'category-replay')
    const category = JSON.parse(first.responseBodyJson) as LedgerCategoryDto
    service.archiveCategory(category.id, { expectedVersion: category.version })
    const replay = service.createCategory(request, 'category-replay')
    expect(replay.replayed).toBe(true)
    expect(replay.responseBodyJson).toBe(first.responseBodyJson)
  })
})

describe('Ledger service error priority', () => {
  it('applies lifecycle/version gates before lower-priority checks', () => {
    const { service } = freshService()
    initialize(service)
    const account = createAccount(service, 'priority-account', { openingBalanceMinor: 10 })
    expectLedgerError(
      () => service.archiveAccount(account.id, { expectedVersion: 99 }),
      'ledger-version-conflict',
    )

    const zero = createAccount(service, 'priority-archived')
    const archivedAccount = service.archiveAccount(zero.id, { expectedVersion: zero.version })
    expectLedgerError(
      () => service.patchAccount(zero.id, { expectedVersion: 99, openingBalanceMinor: 1 }),
      'ledger-archived-account',
    )
    expect(archivedAccount.currentBalanceMinor).toBe(0)

    expectLedgerError(
      () => service.patchAccount('missing-account', null),
      'ledger-not-found',
    )
    expectLedgerError(
      () => service.patchCategory('missing-category', { malformed: true }),
      'ledger-not-found',
    )
  })

  it('returns the canonical pair and currency errors for Account creation', () => {
    const { service } = freshService()
    initialize(service)
    expectLedgerError(
      () => service.createAccount(accountRequest({ type: 'credit_card', nature: 'asset' }), 'bad-pair'),
      'ledger-invalid-account-pair',
    )
    expectLedgerError(
      () => service.createAccount(accountRequest({ currency: 'USD' }), 'bad-currency'),
      'ledger-currency-mismatch',
    )
  })
})
