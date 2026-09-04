// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearLedgerPendingCreate,
  createLedgerPendingIntent,
  isLedgerPendingCreateIntent,
  LEDGER_PENDING_CREATE_STORAGE_KEY,
  readLedgerPendingCreate,
  writeLedgerPendingCreate,
} from '../recovery'

describe('Ledger unresolved create recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('stores only the exact create intent in sessionStorage', () => {
    const intent = createLedgerPendingIntent(
      'transaction',
      {
        type: 'expense',
        amountMinor: 3800,
        accountId: 'account-1',
        categoryId: 'category-1',
        occurredAt: 1_700_000_000_000,
        payee: '',
        note: '',
      },
      'key-a',
      'owner-a',
      1_700_000_000_123,
    )
    writeLedgerPendingCreate(intent)

    expect(readLedgerPendingCreate()).toEqual(intent)
    expect(sessionStorage.getItem(LEDGER_PENDING_CREATE_STORAGE_KEY)).toContain('key-a')
    expect(sessionStorage.getItem(LEDGER_PENDING_CREATE_STORAGE_KEY)).not.toContain('password')
    clearLedgerPendingCreate()
    expect(readLedgerPendingCreate()).toBeNull()
  })

  it('fails closed on malformed or unsupported records', () => {
    sessionStorage.setItem(LEDGER_PENDING_CREATE_STORAGE_KEY, '{broken')
    expect(readLedgerPendingCreate()).toBeNull()
    expect(sessionStorage.getItem(LEDGER_PENDING_CREATE_STORAGE_KEY)).toBeNull()

    const unsupported = {
      version: 99,
      operation: 'transaction',
      operationScope: 'POST:/api/ledger/transactions',
      idempotencyKey: 'key-b',
      canonicalPayload: {},
      createdAt: 1,
      ownerIdentity: null,
    }
    expect(isLedgerPendingCreateIntent(unsupported)).toBe(false)
    sessionStorage.setItem(LEDGER_PENDING_CREATE_STORAGE_KEY, JSON.stringify(unsupported))
    expect(readLedgerPendingCreate()).toBeNull()
  })
})
