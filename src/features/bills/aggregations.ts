import type {
  BillsAccount,
  BillsAssetSummary,
  BillsCategorySlice,
  BillsCashflowSummary,
} from './mockData'

/**
 * Sum monetary values at cent precision. Keeping this in the Bills domain
 * avoids tiny floating-point differences leaking into card totals and tests.
 */
export function sumMoney(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100
}

/** The total balance is always derived from the accounts rendered in the UI. */
export function aggregateAccountBalances(accounts: readonly BillsAccount[]): BillsAssetSummary {
  return {
    accountCount: accounts.length,
    totalBalance: sumMoney(accounts.map((account) => account.balance)),
  }
}

export function sumCategoryAmounts(categories: readonly BillsCategorySlice[]): number {
  return sumMoney(categories.map((category) => category.amount))
}

export function summarizeCashflow(
  incomeCategories: readonly BillsCategorySlice[],
  expenseCategories: readonly BillsCategorySlice[],
): BillsCashflowSummary {
  const income = sumCategoryAmounts(incomeCategories)
  const expense = sumCategoryAmounts(expenseCategories)
  return { income, expense, balance: sumMoney([income, -expense]) }
}

export function percentageOf(amount: number, total: number): number {
  if (total <= 0 || amount <= 0) return 0
  return Math.round((amount / total) * 100)
}
