import type { Database as DatabaseT } from 'better-sqlite3'
import { LedgerError } from './errors.js'

function isThenable(value: unknown): value is PromiseLike<unknown> {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  return typeof (value as { then?: unknown }).then === 'function'
}

function invokeSynchronous<T>(callback: () => T): T {
  const result = callback()
  if (isThenable(result)) {
    throw new TypeError('Ledger write callbacks must be synchronous')
  }
  return result
}

function sqliteErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isSqliteBusy(error: unknown): boolean {
  const code = sqliteErrorCode(error)
  return code === 'SQLITE_BUSY' || code?.startsWith('SQLITE_BUSY_') === true
}

function ledgerWriteBusyError(): LedgerError {
  return new LedgerError(
    'ledger-write-busy',
    503,
    'Ledger write is temporarily busy; please retry',
  )
}

/**
 * Run one synchronous Ledger mutation transaction. Nested calls reuse the
 * current connection transaction; only the outermost call opens an IMMEDIATE
 * transaction and owns its commit/rollback boundary.
 */
export function runLedgerWrite<T>(db: DatabaseT, callback: () => T): T {
  try {
    if (db.inTransaction) return invokeSynchronous(callback)
    return db.transaction(() => invokeSynchronous(callback)).immediate()
  } catch (error) {
    if (isSqliteBusy(error)) throw ledgerWriteBusyError()
    throw error
  }
}
