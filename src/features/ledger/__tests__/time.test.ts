// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  formatLedgerDateTime,
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
})
