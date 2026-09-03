import { afterEach, describe, expect, it } from 'vitest'
import { applyMigrations } from '../db.js'
import type { LedgerAccount } from '../ledger/domain.js'
import {
  executeIdempotentLedgerCreate,
  fingerprintLedgerMutation,
  LEDGER_IDEMPOTENCY_OPERATION_SCOPES,
} from '../ledger/idempotency.js'
import { createLedgerRepository } from '../ledger/repository.js'
import {
  createLedgerTestDatabase,
  type LedgerTestDatabase,
} from './helpers/ledgerDb.js'
import { parseAccountCreateRequest } from '../ledger/validation.js'

const databases: LedgerTestDatabase[] = []

function freshDatabase(): LedgerTestDatabase {
  const database = createLedgerTestDatabase()
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.cleanup()
})

function account(id: string): LedgerAccount {
  return {
    id,
    name: 'Persistent account',
    type: 'bank',
    nature: 'asset',
    openingBalanceMinor: 0,
    openingDate: '2026-01-01',
    currency: 'CNY',
    note: '',
    archivedAt: null,
    version: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
  }
}

describe('Ledger persistent idempotency replay', () => {
  it('reopens the same SQLite file and replays one immutable response snapshot', () => {
    const database = freshDatabase()
    const repositoryA = createLedgerRepository(database.db)
    const storedAccount = account('reopen-account')
    const request = parseAccountCreateRequest({
      name: storedAccount.name,
      type: storedAccount.type,
      nature: storedAccount.nature,
      openingBalanceMinor: storedAccount.openingBalanceMinor,
      openingDate: storedAccount.openingDate,
      currency: storedAccount.currency,
    })
    const operationScope = LEDGER_IDEMPOTENCY_OPERATION_SCOPES.accounts
    const idempotencyKey = 'reopen-key'
    const responseBody = {
      id: storedAccount.id,
      name: storedAccount.name,
      currentBalanceMinor: 0,
    }

    const first = executeIdempotentLedgerCreate(database.db, repositoryA, {
      operationScope,
      idempotencyKey,
      request,
      createdAt: 1_234,
      mutation: () => {
        repositoryA.insertAccount(storedAccount)
        return {
          resultStatus: 'committed' as const,
          responseStatus: 201 as const,
          responseBody,
          resultType: 'account',
          resultId: storedAccount.id,
        }
      },
    })
    const firstRecord = repositoryA.getIdempotencyRecord(operationScope, idempotencyKey)
    expect(firstRecord).not.toBeNull()
    expect(firstRecord?.requestFingerprint).toBe(fingerprintLedgerMutation(request))
    expect(firstRecord?.responseBodyJson).toBe(first.responseBodyJson)
    expect(repositoryA.listAccounts()).toHaveLength(1)

    database.close()
    const reopened = database.openConnection()
    applyMigrations(reopened)
    const repositoryB = createLedgerRepository(reopened)
    let callbackCount = 0

    const replay = executeIdempotentLedgerCreate(reopened, repositoryB, {
      operationScope,
      idempotencyKey,
      request,
      mutation: () => {
        callbackCount += 1
        throw new Error('reopen replay must not execute mutation')
      },
    })
    const reopenedRecord = repositoryB.getIdempotencyRecord(operationScope, idempotencyKey)
    const counts = reopened.prepare(`
      SELECT
        (SELECT COUNT(*) FROM ledger_accounts) AS account_count,
        (SELECT COUNT(*) FROM ledger_idempotency) AS idempotency_count
    `).get() as { account_count: number; idempotency_count: number }

    expect(replay.replayed).toBe(true)
    expect(replay.responseStatus).toBe(first.responseStatus)
    expect(replay.responseBodyJson).toBe(first.responseBodyJson)
    expect(reopenedRecord).toEqual(firstRecord)
    expect(callbackCount).toBe(0)
    expect(repositoryB.listAccounts()).toHaveLength(1)
    expect(counts).toEqual({ account_count: 1, idempotency_count: 1 })

    database.close()
  })
})
