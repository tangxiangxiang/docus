// Bills icons follow the same 16px, 1.5px outline language as the Vault icon set.
const icon = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`

export const BILLS_ICON_CALENDAR = icon('<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M5 2v3M11 2v3M2.5 6.5h11"/>')
export const BILLS_ICON_TREND = icon('<path d="M2.5 11.5 6 8l2.5 2.5L13.5 5"/><path d="M10.5 5h3v3"/>')
export const BILLS_ICON_MONTH = icon('<circle cx="8" cy="8" r="5.5"/><path d="M8 4.75V8l2.25 1.5"/>')
export const BILLS_ICON_YEAR = icon('<path d="M3 13.5h10M4 11.5V6.25L8 3l4 3.25v5.25"/><path d="M6.25 13.5V9.75h3.5v3.75"/>')
export const BILLS_ICON_COFFEE = icon('<path d="M4 5.5h6v3.25a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3z"/><path d="M10 7h1a1.75 1.75 0 0 1 0 3.5h-1M3 13h9"/>')
export const BILLS_ICON_TRAIN = icon('<rect x="3.5" y="2.5" width="9" height="9" rx="2"/><path d="M5.5 11.5 4 14M10.5 11.5 12 14M5.5 6.5h5M6 9h.01M10 9h.01"/>')
export const BILLS_ICON_SALARY = icon('<path d="M8 2.5v11M10.5 5.25c-.4-.55-1.1-.9-2.1-.9-1.2 0-2 .55-2 1.45 0 2.25 4.3 1.1 4.3 3.65 0 .95-.85 1.7-2.25 1.7-1.15 0-1.95-.4-2.4-1.05"/>')
export const BILLS_ICON_CART = icon('<path d="M2.5 3h1.25l1.1 6.1a1.5 1.5 0 0 0 1.48 1.23h5.18a1.5 1.5 0 0 0 1.47-1.2L14 5H4.25"/><circle cx="6.75" cy="13" r=".75" fill="currentColor" stroke="none"/><circle cx="11.75" cy="13" r=".75" fill="currentColor" stroke="none"/>')
export const BILLS_ICON_PLAY = icon('<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="m7 6 3 2-3 2z"/>')
export const BILLS_ICON_ARROW_RIGHT = icon('<path d="M3 8h9M9 4.75 12.25 8 9 11.25"/>')
export const BILLS_ICON_WALLET = icon('<path d="M2.5 4.5h11v8h-11z"/><path d="M2.5 6.5h11M10 9h1.5"/>')
export const BILLS_ICON_CHART = icon('<path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5H8z"/><path d="M9.5 2.7a5 5 0 0 1 3.8 3.8H9.5z"/>')

export const PERIOD_ICONS: Record<string, string> = {
  calendar: BILLS_ICON_CALENDAR,
  trend: BILLS_ICON_TREND,
  month: BILLS_ICON_MONTH,
  year: BILLS_ICON_YEAR,
}

export const TRANSACTION_ICONS: Record<string, string> = {
  coffee: BILLS_ICON_COFFEE,
  train: BILLS_ICON_TRAIN,
  salary: BILLS_ICON_SALARY,
  cart: BILLS_ICON_CART,
  play: BILLS_ICON_PLAY,
}
