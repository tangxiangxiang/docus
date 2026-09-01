import { aggregateAssetSummary } from './aggregations'

export type BillsTransactionType = 'expense' | 'income'
export type BillsAccountType = 'asset' | 'liability'
export interface BillsAccount { id: string; name: string; kind: string; balance: number; accent: string; accountType?: BillsAccountType }
export interface BillsAccountBalanceSummary { accountCount: number; totalBalance: number }
export interface BillsAssetSummary { accountCount: number; assets: number; debt: number; netAssets: number }

export interface BillsCashflowSummary { income: number; expense: number; balance: number }

export interface BillsCategorySlice {
  id: string
  label: string
  amount: number
  color: string
}

export interface BillsCategoryBreakdown {
  income: BillsCategorySlice[]
  expense: BillsCategorySlice[]
}

export type BillsLedgerScope = 'all' | 'year' | 'month'

export interface BillsPeriodSummary {
  id: string
  title: string
  dateLabel: string
  expense: number
  income: number
  icon: string
  tone: 'blue' | 'violet' | 'amber' | 'teal'
}

export interface BillsTrendPoint {
  label: string
  income: number
  expense: number
}

export interface BillsTransaction {
  id: string
  merchant: string
  category: string
  account: string
  date: string
  amount: number
  type: BillsTransactionType
  icon: string
}

/**
 * Stable client-side fixtures for the first Bills UI slice.
 * Labels and amounts are intentionally fixed so screenshots and UI tests are
 * repeatable while the UI remains entirely local and persistence-free.
 */
const billsAccounts = [
  { id: 'cash', name: '现金', kind: '现金账户', balance: 2860.5, accent: '#f59e0b', accountType: 'asset' },
  { id: 'boc', name: '中国银行', kind: '储蓄卡 · 8824', balance: 89420, accent: '#3b82f6', accountType: 'asset' },
  { id: 'alipay', name: '支付宝', kind: '数字钱包', balance: 12640, accent: '#14b8a6', accountType: 'asset' },
  { id: 'wechat', name: '微信钱包', kind: '数字钱包', balance: 81500, accent: '#8b5cf6', accountType: 'asset' },
  { id: 'cmb-credit', name: '招商银行信用卡', kind: '信用卡 · 5566', balance: 18000, accent: '#d97706', accountType: 'liability' },
  { id: 'huabei', name: '花呗', kind: '消费信贷', balance: 8800, accent: '#c45555', accountType: 'liability' },
  { id: 'jd-baitiao', name: '京东白条', kind: '消费信贷', balance: 6000, accent: '#e76f51', accountType: 'liability' },
] satisfies BillsAccount[]

const billsPeriods = [
  { id: 'today', title: '今天', dateLabel: '8月28日', expense: 268.4, income: 0, icon: 'calendar', tone: 'blue' },
  { id: 'week', title: '本周', dateLabel: '8月24日 – 28日', expense: 1842.7, income: 1200, icon: 'trend', tone: 'violet' },
  { id: 'month', title: '本月', dateLabel: '8月1日 – 28日', expense: 12486.2, income: 21800, icon: 'month', tone: 'amber' },
  { id: 'year', title: '今年', dateLabel: '1月1日 – 8月28日', expense: 84290.6, income: 168400, icon: 'year', tone: 'teal' },
] satisfies BillsPeriodSummary[]

const monthIncomeCategories = [
  { id: 'salary', label: '工资', amount: 17876, color: '#0f9d8e' },
  { id: 'other-income', label: '其他', amount: 3924, color: '#bfe9e3' },
] satisfies BillsCategorySlice[]

const monthExpenseCategories = [
  { id: 'living', label: '生活', amount: 5743.65, color: '#7c5ce6' },
  { id: 'transport', label: '交通', amount: 3870.72, color: '#c3b6ed' },
  { id: 'other-expense', label: '其他', amount: 2871.83, color: '#e3def5' },
] satisfies BillsCategorySlice[]

const yearIncomeCategories = [
  { id: 'salary', label: '工资', amount: 138088, color: '#0f9d8e' },
  { id: 'other-income', label: '其他', amount: 30312, color: '#bfe9e3' },
] satisfies BillsCategorySlice[]

const yearExpenseCategories = [
  { id: 'living', label: '生活', amount: 38773.68, color: '#7c5ce6' },
  { id: 'transport', label: '交通', amount: 26130.09, color: '#c3b6ed' },
  { id: 'other-expense', label: '其他', amount: 19386.83, color: '#e3def5' },
] satisfies BillsCategorySlice[]

export const billsMockData = {
  accounts: billsAccounts,
  assetSummary: aggregateAssetSummary(billsAccounts),
  periods: billsPeriods,
  categoryBreakdowns: {
    all: { income: yearIncomeCategories, expense: yearExpenseCategories },
    year: { income: yearIncomeCategories, expense: yearExpenseCategories },
    month: { income: monthIncomeCategories, expense: monthExpenseCategories },
  } satisfies Record<BillsLedgerScope, BillsCategoryBreakdown>,
  trend: [
    { label: '3月', income: 16800, expense: 10280 },
    { label: '4月', income: 18400, expense: 11860 },
    { label: '5月', income: 19200, expense: 13640 },
    { label: '6月', income: 20800, expense: 12820 },
    { label: '7月', income: 21400, expense: 13632.8 },
    { label: '8月', income: 21800, expense: 12486.2 },
  ] satisfies BillsTrendPoint[],
  recentTransactions: [
    { id: 'tx-1', merchant: '星巴克咖啡', category: '餐饮', account: '支付宝', date: '今天 09:18', amount: 38, type: 'expense', icon: 'coffee' },
    { id: 'tx-2', merchant: '通勤地铁', category: '交通', account: '微信钱包', date: '昨天 08:42', amount: 6, type: 'expense', icon: 'train' },
    { id: 'tx-3', merchant: '八月工资', category: '工资', account: '中国银行', date: '8月25日', amount: 21800, type: 'income', icon: 'salary' },
    { id: 'tx-4', merchant: '生活超市', category: '日用', account: '中国银行', date: '8月24日', amount: 326.8, type: 'expense', icon: 'cart' },
    { id: 'tx-5', merchant: '流媒体会员', category: '娱乐', account: '微信钱包', date: '8月22日', amount: 68, type: 'expense', icon: 'play' },
  ] satisfies BillsTransaction[],
}
