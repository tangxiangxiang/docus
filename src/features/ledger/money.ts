import {
  currencyExponentFor,
  formatMinorToDecimal,
  parseDecimalToMinor,
} from '../../../shared/ledgerCurrency'

export { currencyExponentFor }

/** Parse the decimal string users understand at the UI boundary. */
export function parseLedgerMoney(value: string, currency: string): number {
  return parseDecimalToMinor(value.trim(), currency)
}

export function ledgerDecimalFromMinor(value: number, currency: string): string {
  return formatMinorToDecimal(value, currency)
}

/**
 * Formatting is presentation only. Financial calculations remain integer
 * minor-unit values from the server; Intl is used only to localize the exact
 * decimal representation already produced by the shared currency helper.
 */
export function formatLedgerMoney(
  minor: number,
  currency: string,
  locale = 'zh-CN',
): string {
  const exponent = currencyExponentFor(currency)
  const decimal = formatMinorToDecimal(minor, currency)
  const numeric = Number(decimal)
  if (!Number.isFinite(numeric)) return `${currency} ${decimal}`

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(numeric)
  } catch {
    return `${currency} ${decimal}`
  }
}

export function formatLedgerSignedMoney(
  minor: number,
  currency: string,
  locale = 'zh-CN',
): string {
  if (minor === 0) return formatLedgerMoney(0, currency, locale)
  return `${minor > 0 ? '+' : '-'}${formatLedgerMoney(Math.abs(minor), currency, locale)}`
}
