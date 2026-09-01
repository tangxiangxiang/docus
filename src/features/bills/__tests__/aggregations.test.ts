import { describe, expect, it } from 'vitest'
import {
  aggregateAccountBalances,
  aggregateAssetSummary,
  percentageOf,
  summarizeCashflow,
} from '../aggregations'
import type { BillsAccount, BillsCategorySlice } from '../mockData'
import { billsMockData } from '../mockData'

const account = (id: string, balance: number): BillsAccount => ({
  id,
  name: id,
  kind: '数字钱包',
  balance,
  accent: '#0f9d8e',
})

const category = (id: string, amount: number): BillsCategorySlice => ({
  id,
  label: id,
  amount,
  color: '#0f9d8e',
})

describe('Bills aggregation contracts', () => {
  it('derives the headline balance from every displayed account', () => {
    const accounts = [account('bank', 38520), account('alipay', 12680.26), account('wechat', 6581), account('cash', 2500)]
    const summary = aggregateAccountBalances(accounts)

    expect(summary.accountCount).toBe(accounts.length)
    expect(summary.totalBalance).toBe(60281.26)
  })

  it('derives the restored asset metrics from the same displayed account set', () => {
    const accounts = [account('bank', 38520), account('alipay', 12680.26), account('wechat', 6581), account('cash', 2500)]

    expect(aggregateAssetSummary(accounts, 32800)).toEqual({
      accountCount: 4,
      assets: 60281.26,
      debt: 32800,
      netAssets: 27481.26,
    })
  })

  it('does not hide an extra account in the aggregate', () => {
    const visibleAccounts = [account('bank', 38520), account('cash', 2500)]
    const withHiddenAccount = [...visibleAccounts, account('archived', 15000)]

    expect(aggregateAccountBalances(visibleAccounts).totalBalance).toBe(41020)
    expect(aggregateAccountBalances(withHiddenAccount).totalBalance).toBe(56020)
  })

  it('derives balance as income minus expense from the same category source', () => {
    const summary = summarizeCashflow([category('salary', 17876), category('other', 3924)], [
      category('living', 5743.65),
      category('transport', 3870.72),
      category('other', 2871.83),
    ])

    expect(summary).toEqual({ income: 21800, expense: 12486.2, balance: 9313.8 })
  })

  it('rounds category percentages for readable labels', () => {
    expect(percentageOf(17876, 21800)).toBe(82)
    expect(percentageOf(5743.65, 12486.2)).toBe(46)
    expect(percentageOf(0, 0)).toBe(0)
  })

  it('keeps month and year category totals aligned with their period summaries', () => {
    for (const periodId of ['month', 'year'] as const) {
      const period = billsMockData.periods.find((candidate) => candidate.id === periodId)
      const breakdown = billsMockData.categoryBreakdowns[periodId]
      expect(period).toBeDefined()
      expect(summarizeCashflow(breakdown.income, breakdown.expense)).toEqual({
        income: period!.income,
        expense: period!.expense,
        balance: Math.round((period!.income - period!.expense) * 100) / 100,
      })
    }
  })

  it('keeps the mock asset summary aligned with its rendered accounts', () => {
    expect(aggregateAssetSummary(billsMockData.accounts, billsMockData.assetSummary.debt)).toEqual(
      billsMockData.assetSummary,
    )
  })
})
