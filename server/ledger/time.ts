import { Temporal } from '@js-temporal/polyfill'
import { LedgerError } from './errors.js'

export const LEDGER_FUTURE_SKEW_MS = 60_000

/** First-pass grammar: named IANA candidates only, never offset expressions. */
export const IANA_TIME_ZONE_ID_RE = /^[A-Za-z_][A-Za-z0-9_.+-]*(?:\/[A-Za-z0-9_.+-]+)*$/

export type LedgerPeriodName = 'today' | 'week' | 'month' | 'year'

export interface LedgerTimeRange {
  readonly startMs: number
  readonly endMs: number
}

export interface LedgerCalendarMonthRange extends LedgerTimeRange {
  readonly month: string
}

function validationError(field: string, message: string): LedgerError {
  return new LedgerError('ledger-validation-failed', 400, message, { field })
}

/** Validate an epoch-millisecond UTC instant without using the host timezone. */
export function assertUtcMilliseconds(value: unknown, field = 'timestamp'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw validationError(field, `${field} must be a safe integer UTC millisecond timestamp`)
  }
  try {
    Temporal.Instant.fromEpochMilliseconds(value)
  } catch {
    throw validationError(field, `${field} is outside the supported UTC instant range`)
  }
  return value
}

/**
 * Validate an actual named IANA timezone identifier.
 *
 * Temporal accepts a broader TimeZoneLike grammar (including fixed offsets
 * and date-time expressions), so the named-zone grammar must run first. The
 * fixed Instant conversion is the final tzdb/existence authority.
 */
export function assertIanaTimeZoneId(value: unknown): string {
  if (typeof value !== 'string' || !IANA_TIME_ZONE_ID_RE.test(value)) {
    throw new LedgerError('ledger-invalid-timezone', 400, 'timezone must be a named IANA timezone identifier')
  }
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(value)
  } catch {
    throw new LedgerError('ledger-invalid-timezone', 400, 'timezone is not recognized by the timezone database')
  }
  return value
}

export const validateIanaTimeZone = assertIanaTimeZoneId

export function isIanaTimeZoneId(value: unknown): value is string {
  try {
    assertIanaTimeZoneId(value)
    return true
  } catch {
    return false
  }
}

const OPENING_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Validate a strict Gregorian YYYY-MM-DD local date. */
export function assertOpeningDate(value: unknown): string {
  if (typeof value !== 'string' || !OPENING_DATE_RE.test(value)) {
    throw new LedgerError('ledger-invalid-opening-date', 400, 'openingDate must use YYYY-MM-DD')
  }
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' })
  } catch {
    throw new LedgerError('ledger-invalid-opening-date', 400, 'openingDate is not a valid Gregorian date')
  }
  return value
}

export const validateOpeningDate = assertOpeningDate

function toEpochMilliseconds(zonedDateTime: Temporal.ZonedDateTime, field: string): number {
  const milliseconds = zonedDateTime.toInstant().epochMilliseconds
  return assertUtcMilliseconds(milliseconds, field)
}

function startOfLocalDate(date: Temporal.PlainDate, timezone: string, field = 'period'): number {
  const zonedDateTime = date.toZonedDateTime({ timeZone: timezone, plainTime: '00:00' })
  return toEpochMilliseconds(zonedDateTime, field)
}

function plainDateForInstant(instantMs: number, timezone: string): Temporal.PlainDate {
  const instant = Temporal.Instant.fromEpochMilliseconds(assertUtcMilliseconds(instantMs, 'instant'))
  return instant.toZonedDateTimeISO(timezone).toPlainDate()
}

/** Convert a local Ledger date's midnight to a UTC epoch millisecond. */
export function openingBoundaryMs(openingDate: string, timezone: string): number {
  const date = Temporal.PlainDate.from(assertOpeningDate(openingDate), { overflow: 'reject' })
  const zone = assertIanaTimeZoneId(timezone)
  return startOfLocalDate(date, zone, 'openingDate')
}

/** Return the half-open local-calendar-day interval for a YYYY-MM-DD date. */
export function localDateRange(localDate: string, timezone: string): LedgerTimeRange {
  const date = Temporal.PlainDate.from(assertOpeningDate(localDate), { overflow: 'reject' })
  const zone = assertIanaTimeZoneId(timezone)
  const startMs = startOfLocalDate(date, zone)
  const endMs = startOfLocalDate(date.add({ days: 1 }), zone)
  return { startMs, endMs }
}

/** Calculate a DST-safe period from the local date containing an instant. */
export function periodRange(
  period: LedgerPeriodName,
  instantMs: number,
  timezone: string,
): LedgerTimeRange {
  const zone = assertIanaTimeZoneId(timezone)
  const date = plainDateForInstant(instantMs, zone)
  let startDate: Temporal.PlainDate
  let endDate: Temporal.PlainDate

  switch (period) {
    case 'today':
      startDate = date
      endDate = date.add({ days: 1 })
      break
    case 'week':
      startDate = date.subtract({ days: date.dayOfWeek - 1 })
      endDate = startDate.add({ days: 7 })
      break
    case 'month':
      startDate = Temporal.PlainDate.from({ year: date.year, month: date.month, day: 1 })
      endDate = startDate.add({ months: 1 })
      break
    case 'year':
      startDate = Temporal.PlainDate.from({ year: date.year, month: 1, day: 1 })
      endDate = startDate.add({ years: 1 })
      break
    default:
      return assertNeverPeriod(period)
  }

  return {
    startMs: startOfLocalDate(startDate, zone),
    endMs: startOfLocalDate(endDate, zone),
  }
}

function assertNeverPeriod(value: never): never {
  throw validationError('period', `unsupported Ledger period: ${String(value)}`)
}

export const getPeriodRange = periodRange
export const periodForInstant = periodRange

export function todayRange(instantMs: number, timezone: string): LedgerTimeRange {
  return periodRange('today', instantMs, timezone)
}

export function weekRange(instantMs: number, timezone: string): LedgerTimeRange {
  return periodRange('week', instantMs, timezone)
}

export function monthRange(instantMs: number, timezone: string): LedgerTimeRange {
  return periodRange('month', instantMs, timezone)
}

export function yearRange(instantMs: number, timezone: string): LedgerTimeRange {
  return periodRange('year', instantMs, timezone)
}

export function periodRangesForInstant(
  instantMs: number,
  timezone: string,
): Readonly<Record<LedgerPeriodName, LedgerTimeRange>> {
  return {
    today: todayRange(instantMs, timezone),
    week: weekRange(instantMs, timezone),
    month: monthRange(instantMs, timezone),
    year: yearRange(instantMs, timezone),
  }
}

/** Return consecutive Ledger-local calendar months ending with the current month. */
export function calendarMonthRanges(
  months: number,
  instantMs: number,
  timezone: string,
): readonly LedgerCalendarMonthRange[] {
  if (!Number.isSafeInteger(months) || months < 1) {
    throw validationError('months', 'months must be a positive safe integer')
  }

  const zone = assertIanaTimeZoneId(timezone)
  const date = plainDateForInstant(instantMs, zone)
  try {
    const currentMonth = Temporal.PlainDate.from({ year: date.year, month: date.month, day: 1 })
    const firstMonth = currentMonth.subtract({ months: months - 1 })
    return Array.from({ length: months }, (_, index) => {
      const startDate = firstMonth.add({ months: index })
      const endDate = startDate.add({ months: 1 })
      return {
        month: startDate.toString().slice(0, 7),
        startMs: startOfLocalDate(startDate, zone, 'trend.startAt'),
        endMs: startOfLocalDate(endDate, zone, 'trend.endAt'),
      }
    })
  } catch (error) {
    if (error instanceof LedgerError) throw error
    throw validationError('months', 'months cannot be represented by the Ledger calendar range')
  }
}

/** Enforce the Accepted future-record tolerance with an injectable clock. */
export function validateOccurredAt(value: unknown, nowMs = Date.now()): number {
  const occurredAt = assertUtcMilliseconds(value, 'occurredAt')
  const now = assertUtcMilliseconds(nowMs, 'nowMs')
  const futureLimit = now + LEDGER_FUTURE_SKEW_MS
  if (!Number.isSafeInteger(futureLimit)) {
    throw validationError('nowMs', 'nowMs plus Ledger future tolerance is outside the safe range')
  }
  if (occurredAt > futureLimit) {
    throw new LedgerError(
      'ledger-validation-failed',
      400,
      'occurredAt is beyond the allowed future tolerance',
      { field: 'occurredAt' },
    )
  }
  return occurredAt
}

export const assertOccurredAt = validateOccurredAt
