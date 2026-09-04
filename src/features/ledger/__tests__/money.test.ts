// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { formatLedgerMoney, parseLedgerMoney } from '../money'

describe('Ledger money presentation boundary', () => {
  it.each([
    ['CNY', '38', 3800],
    ['JPY', '38', 38],
    ['KWD', '38', 38000],
  ])('parses %s using shared currency exponent metadata', (currency, input, expected) => {
    expect(parseLedgerMoney(input, currency)).toBe(expected)
  })

  it('rejects invalid and over-precise input without floating point rounding', () => {
    expect(() => parseLedgerMoney('', 'CNY')).toThrow()
    expect(() => parseLedgerMoney('38.001', 'CNY')).toThrow()
    expect(() => parseLedgerMoney('38.0001', 'KWD')).toThrow()
    expect(() => parseLedgerMoney('1.1', 'JPY')).toThrow()
  })

  it('formats normal currency amounts with the correct exponent', () => {
    expect(formatLedgerMoney(3800, 'CNY')).toContain('38.00')
    expect(formatLedgerMoney(38, 'JPY')).not.toContain('.00')
    expect(formatLedgerMoney(38000, 'KWD')).toContain('38.000')
  })
})
