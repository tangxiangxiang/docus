import { Temporal } from '@js-temporal/polyfill'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Convert a UTC instant into the Ledger timezone for datetime-local input. */
export function localDateTimeInputFromInstant(instantMs: number, timezone: string): string {
  const local = Temporal.Instant.fromEpochMilliseconds(instantMs).toZonedDateTimeISO(timezone)
  return `${String(local.year).padStart(4, '0')}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`
}

/** Convert a Ledger-local datetime-local value to the authoritative UTC instant. */
export function instantFromLocalDateTime(value: string, timezone: string): number {
  const plain = Temporal.PlainDateTime.from(value)
  return plain.toZonedDateTime(timezone).toInstant().epochMilliseconds
}

export function openingDateInputFromInstant(instantMs: number, timezone: string): string {
  const local = Temporal.Instant.fromEpochMilliseconds(instantMs).toZonedDateTimeISO(timezone)
  return `${String(local.year).padStart(4, '0')}-${pad(local.month)}-${pad(local.day)}`
}

/** Convert a Ledger-local calendar date into an exclusive/inclusive query boundary. */
export function instantFromLedgerDate(
  value: string,
  timezone: string,
  boundary: 'start' | 'end' = 'start',
): number {
  const date = Temporal.PlainDate.from(value)
  const boundaryDate = boundary === 'end' ? date.add({ days: 1 }) : date
  return boundaryDate.toZonedDateTime({
    timeZone: timezone,
    plainTime: Temporal.PlainTime.from('00:00'),
  }).toInstant().epochMilliseconds
}

export function formatLedgerDateTime(
  instantMs: number,
  timezone: string,
  locale = 'zh-CN',
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instantMs))
}

export function formatLedgerDate(
  date: string,
  timezone: string,
  locale = 'zh-CN',
): string {
  const plain = Temporal.PlainDate.from(date)
  const instant = plain.toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from('00:00') })
    .toInstant().epochMilliseconds
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    dateStyle: 'medium',
  }).format(new Date(instant))
}

export function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}
