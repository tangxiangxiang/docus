import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import app from '../index.js'
import { __setDbForTesting, applyMigrations } from '../db.js'
import {
  closeAuthTestContext,
  createAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from './helpers/auth.js'

const db = new Database(':memory:')
let auth: AuthenticatedTestContext

beforeAll(() => {
  applyMigrations(db)
  auth = createAuthenticatedTestContext({ db })
})

afterAll(() => {
  closeAuthTestContext(auth)
  db.close()
})

beforeEach(() => {
  db.exec(`
    DELETE FROM ledger_idempotency;
    DELETE FROM ledger_transactions;
    DELETE FROM ledger_categories;
    DELETE FROM ledger_accounts;
    DELETE FROM ledger_settings;
  `)
  __setDbForTesting(db)
})

async function request(
  path: string,
  options: {
    method?: string
    body?: unknown
    cookie?: string
    contentType?: string
    idempotencyKey?: string
  } = {},
): Promise<Response> {
  const headers = new Headers()
  if (options.cookie !== undefined) headers.set('Cookie', options.cookie)
  if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey)
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  if (body !== undefined) {
    headers.set('Content-Length', String(Buffer.byteLength(body)))
    if (options.contentType !== '') headers.set('Content-Type', options.contentType ?? 'application/json')
  }
  return app.fetch(new Request(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
  }))
}

async function authenticated(
  path: string,
  options: Omit<Parameters<typeof request>[1], 'cookie'> = {},
): Promise<Response> {
  return request(path, { ...options, cookie: auth.cookie })
}

async function json(response: Response): Promise<any> {
  return response.json()
}

async function initialize(): Promise<any> {
  const response = await authenticated('/api/ledger/settings', {
    method: 'POST',
    body: { baseCurrency: 'CNY', timezone: 'Asia/Shanghai' },
    idempotencyKey: 'settings-init',
  })
  expect(response.status).toBe(201)
  return json(response)
}

function accountBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Cash account',
    type: 'bank',
    nature: 'asset',
    openingBalanceMinor: 0,
    openingDate: '2026-01-01',
    currency: 'CNY',
    ...overrides,
  }
}

function categoryBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'expense', name: 'Custom category', ...overrides }
}

describe('Ledger API owner boundary and Settings', () => {
  it('rejects anonymous Ledger reads before domain work', async () => {
    const response = await request('/api/ledger/settings')
    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ code: 'auth-session-required' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('fails closed before explicit Settings initialization', async () => {
    const settings = await authenticated('/api/ledger/settings')
    const accounts = await authenticated('/api/ledger/accounts')
    const categories = await authenticated('/api/ledger/categories')
    expect(settings.status).toBe(404)
    expect(accounts.status).toBe(404)
    expect(categories.status).toBe(404)
    expect(await json(settings)).toMatchObject({ code: 'ledger-not-found' })
    expect(await json(accounts)).toMatchObject({ code: 'ledger-not-found' })
    expect(await json(categories)).toMatchObject({ code: 'ledger-not-found' })
  })

  it('initializes Settings with exactly 18 categories and replays the original snapshot', async () => {
    const first = await authenticated('/api/ledger/settings', {
      method: 'POST',
      body: { baseCurrency: 'CNY', timezone: 'Asia/Shanghai' },
      idempotencyKey: 'settings-replay',
    })
    const firstText = await first.text()
    expect(first.status).toBe(201)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(first.headers.get('content-type')).toMatch(/application\/json/)

    const categories = await authenticated('/api/ledger/categories')
    expect(categories.status).toBe(200)
    expect(await json(categories)).toHaveLength(18)

    const replay = await authenticated('/api/ledger/settings', {
      method: 'POST',
      body: { baseCurrency: 'CNY', timezone: 'Asia/Shanghai' },
      idempotencyKey: 'settings-replay',
    })
    expect(replay.status).toBe(201)
    expect(await replay.text()).toBe(firstText)
  })

  it('uses Idempotency-Key replay and centralizes malformed JSON errors', async () => {
    const headers = new Headers({
      Cookie: auth.cookie,
      'Content-Type': 'application/json',
      'Content-Length': '9',
      'Idempotency-Key': 'settings-key',
    })
    const first = await app.fetch(new Request('http://localhost/api/ledger/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseCurrency: 'CNY', timezone: 'Asia/Shanghai' }),
    }))
    expect(first.status).toBe(201)
    const firstText = await first.text()

    const replay = await authenticated('/api/ledger/settings', {
      method: 'POST',
      body: { baseCurrency: 'CNY', timezone: 'Asia/Shanghai' },
      idempotencyKey: 'settings-key',
    })
    expect(replay.status).toBe(201)
    expect(await replay.text()).toBe(firstText)

    const malformed = await app.fetch(new Request('http://localhost/api/ledger/settings', {
      method: 'POST',
      headers: new Headers({
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
        'Content-Length': '8',
        'Idempotency-Key': 'malformed',
      }),
      body: '{broken',
    }))
    expect(malformed.status).toBe(400)
    const malformedBody = await json(malformed)
    expect(malformedBody).toEqual(expect.objectContaining({
      code: 'ledger-validation-failed',
    }))
    expect(malformedBody).not.toHaveProperty('stack')
    expect(JSON.stringify(malformedBody)).not.toMatch(/SQL|database|\.sqlite/i)
  })

  it('patches Settings before the first Account and locks both fields afterwards', async () => {
    await initialize()
    const patched = await authenticated('/api/ledger/settings', {
      method: 'PATCH',
      body: { expectedVersion: 1, timezone: 'UTC', baseCurrency: 'USD' },
    })
    expect(patched.status).toBe(200)
    expect(await json(patched)).toMatchObject({ timezone: 'UTC', baseCurrency: 'USD', version: 2 })

    const account = await authenticated('/api/ledger/accounts', {
      method: 'POST',
      body: accountBody({ currency: 'USD' }),
      idempotencyKey: 'account-freeze',
    })
    expect(account.status).toBe(201)

    const timezone = await authenticated('/api/ledger/settings', {
      method: 'PATCH',
      body: { expectedVersion: 1, timezone: 'Asia/Shanghai' },
    })
    const currency = await authenticated('/api/ledger/settings', {
      method: 'PATCH',
      body: { expectedVersion: 1, baseCurrency: 'CNY' },
    })
    expect(timezone.status).toBe(409)
    expect(currency.status).toBe(409)
    expect(await json(timezone)).toMatchObject({ code: 'ledger-timezone-locked' })
    expect(await json(currency)).toMatchObject({ code: 'ledger-base-currency-locked' })
  })
})

describe('Ledger Account API', () => {
  it('creates Accounts with currentBalanceMinor, allows duplicate names, and hides archived rows by default', async () => {
    await initialize()
    const first = await authenticated('/api/ledger/accounts', {
      method: 'POST',
      body: accountBody({ openingBalanceMinor: 100, name: 'Same name' }),
      idempotencyKey: 'account-one',
    })
    expect(first.status).toBe(201)
    const firstBody = await json(first)
    expect(firstBody).toMatchObject({ currentBalanceMinor: 100, name: 'Same name', version: 1 })

    const second = await authenticated('/api/ledger/accounts', {
      method: 'POST',
      body: accountBody({ name: 'Same name' }),
      idempotencyKey: 'account-two',
    })
    expect(second.status).toBe(201)
    const secondBody = await json(second)
    expect(secondBody.id).not.toBe(firstBody.id)

    const list = await authenticated('/api/ledger/accounts')
    expect(await json(list)).toHaveLength(2)

    const nonzeroArchive = await authenticated(`/api/ledger/accounts/${firstBody.id}/archive`, {
      method: 'POST',
      body: { expectedVersion: 1 },
    })
    expect(nonzeroArchive.status).toBe(409)
    expect(await json(nonzeroArchive)).toMatchObject({ code: 'ledger-account-nonzero-balance' })

    const archive = await authenticated(`/api/ledger/accounts/${secondBody.id}/archive`, {
      method: 'POST',
      body: { expectedVersion: 1 },
    })
    expect(archive.status).toBe(200)
    const archived = await json(archive)
    expect(archived.currentBalanceMinor).toBe(0)

    expect(await json(await authenticated('/api/ledger/accounts'))).toHaveLength(1)
    expect(await json(await authenticated('/api/ledger/accounts?includeArchived=true'))).toHaveLength(2)

    const archivedPatch = await authenticated(`/api/ledger/accounts/${secondBody.id}`, {
      method: 'PATCH',
      body: { expectedVersion: archived.version, openingBalanceMinor: 1 },
    })
    expect(archivedPatch.status).toBe(409)
    expect(await json(archivedPatch)).toMatchObject({ code: 'ledger-archived-account' })

    const renamed = await authenticated(`/api/ledger/accounts/${secondBody.id}`, {
      method: 'PATCH',
      body: { expectedVersion: archived.version, name: 'Restorable account' },
    })
    expect(renamed.status).toBe(200)
    const renamedBody = await json(renamed)
    const restored = await authenticated(`/api/ledger/accounts/${secondBody.id}/restore`, {
      method: 'POST',
      body: { expectedVersion: renamedBody.version },
    })
    expect(restored.status).toBe(200)
    const restoredBody = await json(restored)
    expect(restoredBody).toMatchObject({ archivedAt: null, version: renamedBody.version + 1 })

    const noOpRestore = await authenticated(`/api/ledger/accounts/${secondBody.id}/restore`, {
      method: 'POST',
      body: { expectedVersion: restoredBody.version },
    })
    expect(noOpRestore.status).toBe(200)
    expect((await json(noOpRestore)).version).toBe(restoredBody.version)
  })

  it('returns canonical conflicts and physically deletes only no-history Accounts', async () => {
    await initialize()
    const account = await authenticated('/api/ledger/accounts', {
      method: 'POST',
      body: accountBody(),
      idempotencyKey: 'account-delete',
    })
    const accountBodyResponse = await json(account)
    const stale = await authenticated(`/api/ledger/accounts/${accountBodyResponse.id}/archive`, {
      method: 'POST',
      body: { expectedVersion: 99 },
    })
    expect(stale.status).toBe(409)
    expect(await json(stale)).toMatchObject({ code: 'ledger-version-conflict' })

    const deleted = await authenticated(`/api/ledger/accounts/${accountBodyResponse.id}`, {
      method: 'DELETE',
      body: { expectedVersion: 1 },
    })
    expect(deleted.status).toBe(200)
    expect(await json(deleted)).toEqual({ deleted: true, id: accountBodyResponse.id })

    const missing = await authenticated(`/api/ledger/accounts/${accountBodyResponse.id}`)
    expect(missing.status).toBe(404)
    expect(await json(missing)).toMatchObject({ code: 'ledger-not-found' })
    expect((db.prepare('SELECT has_created_account FROM ledger_settings').get() as { has_created_account: number }).has_created_account)
      .toBe(1)
  })
})

describe('Ledger Category API and L0.6 boundary', () => {
  it('enforces normalized identity, archive/restore, kind filter, and physical delete history', async () => {
    await initialize()
    const created = await authenticated('/api/ledger/categories', {
      method: 'POST',
      body: categoryBody({ name: '  Foo  ' }),
      idempotencyKey: 'category-foo',
    })
    expect(created.status).toBe(201)
    const category = await json(created)
    expect(category.normalizedName).toBe('foo')

    const duplicate = await authenticated('/api/ledger/categories', {
      method: 'POST',
      body: categoryBody({ name: 'FOO' }),
      idempotencyKey: 'category-duplicate',
    })
    expect(duplicate.status).toBe(409)
    expect(await json(duplicate)).toMatchObject({ code: 'ledger-duplicate-category' })

    const income = await authenticated('/api/ledger/categories', {
      method: 'POST',
      body: categoryBody({ kind: 'income', name: 'FOO' }),
      idempotencyKey: 'category-income',
    })
    expect(income.status).toBe(201)
    expect((await json(income)).kind).toBe('income')

    const archived = await authenticated(`/api/ledger/categories/${category.id}/archive`, {
      method: 'POST',
      body: { expectedVersion: 1 },
    })
    expect(archived.status).toBe(200)
    const archivedBody = await json(archived)

    const archivedDuplicate = await authenticated('/api/ledger/categories', {
      method: 'POST',
      body: categoryBody({ name: 'foo' }),
      idempotencyKey: 'category-archived-duplicate',
    })
    expect(archivedDuplicate.status).toBe(409)

    const archivedPatch = await authenticated(`/api/ledger/categories/${category.id}`, {
      method: 'PATCH',
      body: { expectedVersion: archivedBody.version, name: 'changed' },
    })
    expect(archivedPatch.status).toBe(409)
    expect(await json(archivedPatch)).toMatchObject({ code: 'ledger-archived-category' })

    const restored = await authenticated(`/api/ledger/categories/${category.id}/restore`, {
      method: 'POST',
      body: { expectedVersion: archivedBody.version },
    })
    expect(restored.status).toBe(200)
    expect((await json(restored)).version).toBe(3)

    const expenses = await authenticated('/api/ledger/categories?kind=expense')
    const incomes = await authenticated('/api/ledger/categories?kind=income')
    expect((await json(expenses)).every((item: any) => item.kind === 'expense')).toBe(true)
    expect((await json(incomes)).every((item: any) => item.kind === 'income')).toBe(true)

    const deleted = await authenticated(`/api/ledger/categories/${category.id}`, {
      method: 'DELETE',
      body: { expectedVersion: 3 },
    })
    expect(deleted.status).toBe(200)
  })

  it('does not expose a working Adjustment endpoint in L0.5', async () => {
    await initialize()
    const account = await authenticated('/api/ledger/accounts', {
      method: 'POST',
      body: accountBody(),
      idempotencyKey: 'account-adjust-boundary',
    })
    const accountValue = await json(account)
    const response = await authenticated(`/api/ledger/accounts/${accountValue.id}/adjust`, {
      method: 'POST',
      body: {
        targetBalanceMinor: 1,
        expectedCalculatedBalanceMinor: 0,
        occurredAt: 1_700_000_000_000,
      },
    })
    expect(response.status).toBe(404)
    expect((await response.text())).not.toContain('501')
  })
})
