/** Central error vocabulary for the Ledger server boundary. */

export type LedgerErrorCode =
  | 'ledger-validation-failed'
  | 'ledger-invalid-currency'
  | 'ledger-invalid-timezone'
  | 'ledger-invalid-opening-date'
  | 'ledger-money-unsafe'
  | 'ledger-money-non-positive'
  | 'ledger-money-negative'
  | 'ledger-money-overflow'
  | 'ledger-invalid-decimal'
  | 'ledger-fractional-precision-exceeded'
  | 'ledger-not-found'
  | 'ledger-account-not-found'
  | 'ledger-category-not-found'
  | 'ledger-transaction-not-found'
  | 'ledger-account-currency-mismatch'
  | 'ledger-category-kind-mismatch'
  | 'ledger-account-nonzero-balance'
  | 'ledger-account-has-history'
  | 'ledger-archived-account'
  | 'ledger-archived-category'
  | 'ledger-category-has-history'
  | 'ledger-duplicate-category'
  | 'ledger-timezone-locked'
  | 'ledger-base-currency-locked'
  | 'ledger-version-conflict'
  | 'ledger-transaction-type-immutable'
  | 'ledger-transaction-deleted'
  | 'ledger-adjustment-immutable'
  | 'ledger-balance-conflict'
  | 'ledger-idempotency-conflict'
  | 'ledger-write-busy'

export type LedgerErrorDetail =
  | string
  | number
  | boolean
  | null
  | readonly LedgerErrorDetail[]
  | { readonly [key: string]: LedgerErrorDetail }

export type LedgerErrorDetails = Readonly<Record<string, LedgerErrorDetail>>

/**
 * A safe domain error. Callers may expose code/status/details through the API;
 * messages and details are intentionally kept independent of SQL internals.
 */
export class LedgerError extends Error {
  readonly code: LedgerErrorCode
  readonly status: number
  readonly details?: LedgerErrorDetails

  constructor(
    code: LedgerErrorCode,
    status: number,
    message: string,
    details?: LedgerErrorDetails,
  ) {
    super(message)
    this.name = 'LedgerError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function isLedgerError(error: unknown): error is LedgerError {
  return error instanceof LedgerError
}

export function ledgerValidationError(
  message: string,
  details?: LedgerErrorDetails,
): LedgerError {
  return new LedgerError('ledger-validation-failed', 400, message, details)
}
