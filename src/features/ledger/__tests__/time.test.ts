// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  formatLedgerDateTime,
  formatLedgerPeriodLabel,
  instantFromLocalDateTime,
  localDateTimeInputFromInstant,
} from '../time'

describe('Ledger timezone presentation boundary', () => {
  it('round-trips a Ledger-local datetime through a UTC instant', () => {
    const instant = instantFromLocalDateTime('2026-08-20T09:30', 'Asia/Shanghai')
    expect(localDateTimeInputFromInstant(instant, 'Asia/Shanghai')).toBe('2026-08-20T09:30')
    expect(localDateTimeInputFromInstant(instant, 'UTC')).toBe('2026-08-20T01:30')
  })

  it('formats using the explicit Ledger timezone rather than the browser default', () => {
    const instant = instantFromLocalDateTime('2026-08-20T00:30', 'Asia/Shanghai')
    expect(formatLedgerDateTime(instant, 'Asia/Shanghai')).toContain('2026')
  })

  it('formats today at calendar-date granularity', () => {
    const startAt = instantFromLocalDateTime('2026-09-05T00:00', 'Asia/Shanghai')
    const endAt = instantFromLocalDateTime('2026-09-06T00:00', 'Asia/Shanghai')

    expect(formatLedgerPeriodLabel('today', startAt, endAt, 'Asia/Shanghai')).toBe('2026年9月5日')
    expect(formatLedgerPeriodLabel('today', startAt, endAt, 'Asia/Shanghai')).not.toMatch(/00:00|23:59/)
  })

  it('formats week, month, and year at their period granularity', () => {
    const shanghaiMidnight = (date: string) => instantFromLocalDateTime(`${date}T00:00`, 'Asia/Shanghai')

    expect(formatLedgerPeriodLabel('week', shanghaiMidnight('2026-08-31'), shanghaiMidnight('2026-09-07'), 'Asia/Shanghai'))
      .toBe('2026年8月31日 – 9月6日')
    expect(formatLedgerPeriodLabel('week', shanghaiMidnight('2026-12-28'), shanghaiMidnight('2027-01-04'), 'Asia/Shanghai'))
      .toBe('2026年12月28日 – 2027年1月3日')
    expect(formatLedgerPeriodLabel('month', shanghaiMidnight('2026-09-01'), shanghaiMidnight('2026-10-01'), 'Asia/Shanghai'))
      .toBe('2026年9月')
    expect(formatLedgerPeriodLabel('year', shanghaiMidnight('2026-01-01'), shanghaiMidnight('2027-01-01'), 'Asia/Shanghai'))
      .toBe('2026年')
  })

  it('uses the Ledger timezone when determining the displayed calendar date', () => {
    const instant = Date.UTC(2026, 8, 4, 16, 30)

    expect(formatLedgerPeriodLabel('today', instant, instant + 86_400_000, 'Asia/Shanghai')).toBe('2026年9月5日')
    expect(formatLedgerPeriodLabel('today', instant, instant + 86_400_000, 'America/Los_Angeles')).toBe('2026年9月4日')
  })
})
