export type BillsTransactionType = 'expense' | 'income'
export interface BillsAccount { id: string; name: string; kind: string; balance: number; accent: string }
export interface BillsAssetSummary { accountCount: number; assets: number; debt: number; netAssets: number }

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
export const billsMockData = {
  assetSummary: { accountCount: 4, assets: 186420.5, debt: 32800, netAssets: 153620.5 } satisfies BillsAssetSummary,
  accounts: [
    { id: 'cash', name: '现金', kind: '现金账户', balance: 2860.5, accent: '#f59e0b' },
    { id: 'boc', name: '中国银行', kind: '储蓄卡 · 8824', balance: 89420, accent: '#3b82f6' },
    { id: 'alipay', name: '支付宝', kind: '数字钱包', balance: 12640, accent: '#14b8a6' },
    { id: 'wechat', name: '微信钱包', kind: '数字钱包', balance: 81500, accent: '#8b5cf6' },
  ] satisfies BillsAccount[],
  periods: [
    { id: 'today', title: '今天', dateLabel: '8月28日', expense: 268.4, income: 0, icon: 'calendar', tone: 'blue' },
    { id: 'week', title: '本周', dateLabel: '8月24日 – 28日', expense: 1842.7, income: 1200, icon: 'trend', tone: 'violet' },
    { id: 'month', title: '本月', dateLabel: '8月1日 – 28日', expense: 12486.2, income: 21800, icon: 'month', tone: 'amber' },
    { id: 'year', title: '今年', dateLabel: '1月1日 – 8月28日', expense: 84290.6, income: 168400, icon: 'year', tone: 'teal' },
  ] satisfies BillsPeriodSummary[],
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
