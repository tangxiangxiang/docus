import type {
  BillsAccount,
  BillsAccountBalanceSummary,
  BillsAssetSummary,
  BillsCategorySlice,
  BillsCashflowSummary,
} from './mockData'

export function isLiabilityAccount(account: BillsAccount): boolean {
  return account.accountType === 'liability'
}

/**
 * Sum monetary values at cent precision. Keeping this in the Bills domain
 * avoids tiny floating-point differences leaking into card totals and tests.
 */
export function sumMoney(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100
}

/** Total assets are derived from every rendered account that is not a liability. */
export function aggregateAccountBalances(accounts: readonly BillsAccount[]): BillsAccountBalanceSummary {
  const totalBalance = sumMoney(accounts.filter((account) => !isLiabilityAccount(account)).map((account) => account.balance))
  return {
    accountCount: accounts.length,
    totalBalance,
  }
}

export function aggregateAssetSummary(
  accounts: readonly BillsAccount[],
  fallbackDebt = 0,
): BillsAssetSummary {
  const { accountCount, totalBalance } = aggregateAccountBalances(accounts)
  const liabilityAccounts = accounts.filter(isLiabilityAccount)
  const debt = liabilityAccounts.length > 0
    ? sumMoney(liabilityAccounts.map((account) => account.balance))
    : sumMoney([fallbackDebt])
  return {
    accountCount,
    assets: totalBalance,
    debt: sumMoney([debt]),
    netAssets: sumMoney([totalBalance, -debt]),
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
