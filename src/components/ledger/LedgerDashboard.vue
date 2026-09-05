<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  LedgerOverviewScope,
  LedgerPeriodName,
  LedgerTransactionDto,
} from '../../../shared/ledgerProtocol'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { formatLedgerMoney, formatLedgerSignedMoney } from '../../features/ledger/money'
import { formatLedgerDate, formatLedgerDateTime, formatLedgerPeriodLabel } from '../../features/ledger/time'
import { useLedgerStore } from '../../features/ledger/ledgerStore'

const emit = defineEmits<{
  record: []
  viewTransactions: []
  selectDate: [date: string]
  returnToday: []
}>()
const store = useLedgerStore()
const overview = computed(() => store.overview.value)
const selectedScope = ref<LedgerOverviewScope>('month')
const scopeOptions = computed<ReadonlyArray<{ value: LedgerOverviewScope; label: string }>>(() => {
  const historical = overview.value?.context.isToday === false
  return [
    { value: 'today', label: historical ? '当日' : '今天' },
    { value: 'week', label: historical ? '所在周' : '本周' },
    { value: 'month', label: historical ? '所在月' : '本月' },
    { value: 'year', label: historical ? '所在年' : '今年' },
    { value: 'all', label: '全部' },
  ]
})

const refreshing = computed(() => store.loading.value)
const scopeError = computed(() => store.error.value)
const periodDataReady = computed(() => overview.value !== null && store.overviewMatchesRequest.value)
const historicalMode = computed(() => overview.value?.context.isToday === false
  || store.overviewRequestedAnchorDate.value !== undefined)
const dateInputValue = computed(() => store.overviewRequestedAnchorDate.value
  ?? overview.value?.context.todayDate
  ?? '')
const dateMax = computed(() => overview.value?.context.todayDate ?? '')
const ledgerTimezone = computed(() => store.settings.value?.timezone ?? 'UTC')
const showReturnToday = computed(() => historicalMode.value)

watch(() => store.overviewScope.value, (scope) => {
  selectedScope.value = scope
}, { immediate: true })

watch(selectedScope, (scope, previous) => {
  if (scope !== previous && scope !== store.overviewScope.value) {
    store.setOverviewRequestContext({
      scope,
      anchorDate: store.overviewRequestedAnchorDate.value,
    })
    void store.refreshOverview()
  }
})

const transactionAccountLabels = computed(() => new Map(
  store.accounts.value.map((account) => [
    account.id,
    account.archivedAt === null ? account.name : `${account.name}（已归档）`,
  ]),
))
const categoryNames = computed(() => new Map(
  store.categories.value.map((category) => [category.id, category.name]),
))
const selectedPeriodLabel = computed(() => scopeOptions.value.find((option) => option.value === selectedScope.value)?.label ?? '本月')
const selectedPeriods = computed(() => periodDataReady.value
  ? overview.value?.categoryBreakdown ?? { income: [], expense: [] }
  : { income: [], expense: [] })
const selectedPeriodSummary = computed(() => periodDataReady.value ? overview.value?.cashflow ?? null : null)
const assetAccounts = computed(() => (overview.value?.accounts ?? []).filter((account) => account.nature === 'asset'))
const liabilityAccounts = computed(() => (overview.value?.accounts ?? []).filter((account) => account.nature === 'liability'))

const periodLabels = computed<Record<LedgerPeriodName, string>>(() => ({
  today: historicalMode.value ? '当日' : '今天',
  week: historicalMode.value ? '所在周' : '本周',
  month: historicalMode.value ? '所在月' : '本月',
  year: historicalMode.value ? '所在年' : '今年',
}))

function accountLabel(id: string): string { return transactionAccountLabels.value.get(id) ?? '未知账户' }
function categoryLabel(id: string): string { return categoryNames.value.get(id) ?? '未知分类' }

function categoryShare(items: readonly { amountMinor: number }[], amountMinor: number): string {
  const total = items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n)
  if (total === 0n) return '0%'
  const roundedPercent = (BigInt(amountMinor) * 100n + total / 2n) / total
  return `${roundedPercent.toString()}%`
}

function transactionTitle(transaction: LedgerTransactionDto): string {
  if (transaction.type === 'income' || transaction.type === 'expense') {
    return transaction.payee || categoryLabel(transaction.categoryId)
  }
  if (transaction.type === 'transfer') return `${accountLabel(transaction.fromAccountId)} → ${accountLabel(transaction.toAccountId)}`
  return '余额调整'
}

function transactionMeta(transaction: LedgerTransactionDto): string {
  if (transaction.type === 'income' || transaction.type === 'expense') {
    return `${categoryLabel(transaction.categoryId)} · ${accountLabel(transaction.accountId)}`
  }
  if (transaction.type === 'transfer') return '账户之间转账'
  return accountLabel(transaction.accountId)
}

function transactionAmount(transaction: LedgerTransactionDto): string {
  if (transaction.type === 'income') return formatLedgerSignedMoney(transaction.amountMinor, store.settings.value?.baseCurrency ?? 'CNY')
  if (transaction.type === 'expense') return formatLedgerSignedMoney(-transaction.amountMinor, store.settings.value?.baseCurrency ?? 'CNY')
  return formatLedgerMoney(transaction.amountMinor, store.settings.value?.baseCurrency ?? 'CNY')
}

function periodSummary(period: LedgerPeriodName) {
  if (!periodDataReady.value) return null
  return overview.value?.periods.find((item) => item.period === period) ?? null
}

function retryScope(): void {
  void store.refreshOverview()
}

function onDateChange(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  if (value) emit('selectDate', value)
}
</script>

<template>
  <section class="ledger-dashboard" data-testid="ledger-dashboard" :aria-busy="refreshing ? 'true' : undefined">
    <header class="ledger-dashboard-header">
      <div>
        <p class="ledger-eyebrow">Ledger</p>
        <h1>你的财务概览</h1>
        <p v-if="store.settings.value">{{ store.settings.value.baseCurrency }} · {{ store.settings.value.timezone }}</p>
      </div>
      <div class="ledger-dashboard-actions">
        <RouterLink class="ledger-secondary-button" :to="{ name: 'ledger-accounts' }">管理账户</RouterLink>
        <button class="ledger-primary-button" type="button" :disabled="!store.activeAccounts.value.length" data-testid="ledger-record-button" @click="emit('record')">＋ 记一笔</button>
      </div>
    </header>

    <div v-if="refreshing" class="ledger-refreshing" role="status" aria-live="polite">正在更新 Ledger 数据…</div>
    <div v-if="scopeError" class="ledger-inline-error" role="alert">
      <span>{{ ledgerErrorMessage(scopeError, '这段期间的数据暂时无法加载。') }}</span>
      <button class="ledger-link-button" type="button" @click="retryScope">重试</button>
    </div>

    <template v-if="overview">
      <section class="ledger-metric-grid" aria-label="资产概览">
        <article class="ledger-metric-card" data-testid="ledger-total-assets">
          <span>总资产</span>
          <strong>{{ formatLedgerMoney(overview.assetTotalMinor, overview.currency) }}</strong>
          <small>当前所有资产账户余额</small>
        </article>
        <article class="ledger-metric-card" data-testid="ledger-total-liabilities">
          <span>总负债</span>
          <strong>{{ formatLedgerMoney(overview.liabilityTotalMinor, overview.currency) }}</strong>
          <small>当前所有负债账户余额</small>
        </article>
        <article class="ledger-metric-card is-primary" data-testid="ledger-net-worth">
          <span>净资产</span>
          <strong>{{ formatLedgerMoney(overview.netWorthMinor, overview.currency) }}</strong>
          <small>由 Ledger projection 提供</small>
        </article>
      </section>

      <section class="ledger-dashboard-section" aria-labelledby="ledger-dashboard-accounts-title">
        <div class="ledger-section-heading">
          <div>
            <h2 id="ledger-dashboard-accounts-title">账户</h2>
            <p>按资产与负债区分，余额直接来自账户 projection。</p>
          </div>
          <RouterLink :to="{ name: 'ledger-accounts' }">查看全部</RouterLink>
        </div>
        <div class="ledger-dashboard-account-groups" data-testid="ledger-dashboard-accounts">
          <section class="ledger-dashboard-account-group" data-testid="ledger-dashboard-assets" aria-labelledby="ledger-dashboard-assets-title">
            <h3 id="ledger-dashboard-assets-title">资产账户</h3>
            <div v-if="assetAccounts.length" class="ledger-dashboard-accounts">
              <RouterLink v-for="account in assetAccounts" :key="account.id" class="ledger-dashboard-account" :to="{ name: 'ledger-account', params: { id: account.id } }">
                <span>
                  <strong>{{ account.name }}</strong>
                  <small>资产 · {{ account.currency }}</small>
                </span>
                <strong>{{ formatLedgerMoney(account.currentBalanceMinor, account.currency) }}</strong>
              </RouterLink>
            </div>
            <p v-else class="ledger-inline-empty">还没有资产账户。</p>
          </section>
          <section class="ledger-dashboard-account-group" data-testid="ledger-dashboard-liabilities" aria-labelledby="ledger-dashboard-liabilities-title">
            <h3 id="ledger-dashboard-liabilities-title">负债账户</h3>
            <div v-if="liabilityAccounts.length" class="ledger-dashboard-accounts">
              <RouterLink v-for="account in liabilityAccounts" :key="account.id" class="ledger-dashboard-account" :to="{ name: 'ledger-account', params: { id: account.id } }">
                <span>
                  <strong>{{ account.name }}</strong>
                  <small>负债 · {{ account.currency }}</small>
                </span>
                <strong>{{ formatLedgerMoney(account.currentBalanceMinor, account.currency) }}</strong>
              </RouterLink>
            </div>
            <p v-else class="ledger-inline-empty">还没有负债账户。</p>
          </section>
        </div>
      </section>

      <section class="ledger-dashboard-section ledger-period-navigation" aria-labelledby="ledger-period-navigation-title">
        <div class="ledger-section-heading">
          <div>
            <h2 id="ledger-period-navigation-title">期间分析</h2>
            <p>选择日期查看完整自然期间；资产、负债和账户余额保持当前值。</p>
          </div>
          <button v-if="showReturnToday" class="ledger-secondary-button" type="button" data-testid="ledger-return-today" @click="emit('returnToday')">回到今天</button>
        </div>
        <div class="ledger-period-navigation-controls">
          <label>
            <span>查看日期</span>
            <input
              type="date"
              data-testid="ledger-period-date"
              aria-label="查看日期"
              :value="dateInputValue"
              :max="dateMax || undefined"
              @change="onDateChange"
            >
          </label>
          <label>
            <span>收支范围</span>
            <select v-model="selectedScope" aria-label="选择收支期间">
              <option v-for="option in scopeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
        </div>
        <p v-if="historicalMode && periodDataReady" class="ledger-historical-hint" role="note">
          当前资产与账户余额保持实时；以下期间数据按 {{ formatLedgerDate(dateInputValue, ledgerTimezone) }} 浏览。
        </p>
      </section>

      <div v-if="!periodDataReady" class="ledger-period-analysis-loading" data-testid="ledger-period-analysis-loading" role="status" aria-live="polite">
        正在加载所选期间…
      </div>

      <template v-if="periodDataReady">
      <section class="ledger-dashboard-section ledger-cashflow-section" aria-labelledby="ledger-dashboard-cashflow-title">
        <div class="ledger-section-heading ledger-section-heading-with-control">
          <div>
            <h2 id="ledger-dashboard-cashflow-title">{{ selectedPeriodLabel }}收支</h2>
            <p>选择期间只影响收支与分类 breakdown；资产、负债和账户余额保持当前值。</p>
          </div>
        </div>
        <div v-if="selectedPeriodSummary" class="ledger-cashflow-grid" data-testid="ledger-dashboard-cashflow">
          <div><span>收入</span><strong class="is-income">{{ formatLedgerMoney(selectedPeriodSummary.incomeMinor, overview.currency) }}</strong></div>
          <div><span>支出</span><strong class="is-expense">{{ formatLedgerMoney(selectedPeriodSummary.expenseMinor, overview.currency) }}</strong></div>
          <div><span>收支结余</span><strong>{{ formatLedgerSignedMoney(selectedPeriodSummary.balanceMinor, overview.currency) }}</strong></div>
        </div>
      </section>

      <div class="ledger-dashboard-two-column">
        <section class="ledger-dashboard-section" aria-labelledby="ledger-category-breakdown-title">
          <div class="ledger-section-heading">
            <div>
              <h2 id="ledger-category-breakdown-title">{{ selectedPeriodLabel }}分类</h2>
              <p>收入与支出分类金额（服务端 projection）。</p>
            </div>
          </div>
          <div class="ledger-breakdown-columns" data-testid="ledger-category-breakdown">
            <div>
              <h3>收入</h3>
              <div v-if="selectedPeriods.income.length" class="ledger-breakdown-list">
                <div v-for="item in selectedPeriods.income" :key="item.categoryId" class="ledger-breakdown-row">
                  <span class="ledger-breakdown-label">
                    <span class="ledger-breakdown-name">{{ item.name }}</span>
                    <span class="ledger-breakdown-share"> · {{ categoryShare(selectedPeriods.income, item.amountMinor) }}</span>
                  </span>
                  <strong class="ledger-breakdown-amount">{{ formatLedgerMoney(item.amountMinor, overview.currency) }}</strong>
                </div>
              </div>
              <p v-else class="ledger-inline-empty">这段期间还没有收入分类。</p>
            </div>
            <div>
              <h3>支出</h3>
              <div v-if="selectedPeriods.expense.length" class="ledger-breakdown-list">
                <div v-for="item in selectedPeriods.expense" :key="item.categoryId" class="ledger-breakdown-row">
                  <span class="ledger-breakdown-label">
                    <span class="ledger-breakdown-name">{{ item.name }}</span>
                    <span class="ledger-breakdown-share"> · {{ categoryShare(selectedPeriods.expense, item.amountMinor) }}</span>
                  </span>
                  <strong class="ledger-breakdown-amount">{{ formatLedgerMoney(item.amountMinor, overview.currency) }}</strong>
                </div>
              </div>
              <p v-else class="ledger-inline-empty">这段期间还没有支出分类。</p>
            </div>
          </div>
        </section>

        <section class="ledger-dashboard-section" aria-labelledby="ledger-recent-title">
          <div class="ledger-section-heading">
            <div>
              <h2 id="ledger-recent-title">最近交易</h2>
              <p>{{ historicalMode ? '截至选择日期的最近 5 笔记录。' : '最近 5 笔真实记录。' }}</p>
            </div>
            <button class="ledger-link-button" type="button" @click="emit('viewTransactions')">查看全部</button>
          </div>
          <div v-if="overview.recentTransactions.length" class="ledger-recent-list" data-testid="ledger-recent-transactions">
              <div v-for="transaction in overview.recentTransactions" :key="transaction.id" class="ledger-recent-row">
              <span class="ledger-recent-info"><strong>{{ transactionTitle(transaction) }}</strong><small>{{ transactionMeta(transaction) }} · {{ formatLedgerDateTime(transaction.occurredAt, store.settings.value?.timezone ?? 'UTC') }}</small></span>
              <strong :class="['ledger-recent-amount', `is-${transaction.type}`]">{{ transactionAmount(transaction) }}</strong>
            </div>
          </div>
          <div v-else class="ledger-inline-empty" data-testid="ledger-recent-empty">
            <p v-if="historicalMode">截至该日期还没有交易记录。</p>
            <template v-else>
              <p>还没有交易记录。</p>
              <button class="ledger-secondary-button" type="button" @click="emit('record')">记下第一笔</button>
            </template>
          </div>
        </section>
      </div>

      <section class="ledger-dashboard-section" aria-labelledby="ledger-periods-title">
        <div class="ledger-section-heading">
          <div>
            <h2 id="ledger-periods-title">期间摘要</h2>
            <p>期间边界和金额均由 Ledger timezone 与服务端 projection 决定。</p>
          </div>
        </div>
        <div class="ledger-period-grid" data-testid="ledger-period-summaries">
          <article v-for="period in (['today', 'week', 'month', 'year'] as const)" :key="period" class="ledger-period-card" :data-testid="`ledger-period-${period}`">
            <h3>{{ periodLabels[period] }}</h3>
            <small v-if="periodSummary(period)">{{ formatLedgerPeriodLabel(period, periodSummary(period)!.startAt, periodSummary(period)!.endAt, store.settings.value?.timezone ?? 'UTC') }}</small>
              <div v-if="periodSummary(period)" class="ledger-period-values">
                <span>收入 <strong>{{ formatLedgerMoney(periodSummary(period)!.incomeMinor, overview.currency) }}</strong></span>
                <span>支出 <strong>{{ formatLedgerMoney(periodSummary(period)!.expenseMinor, overview.currency) }}</strong></span>
                <span>收支结余 <strong>{{ formatLedgerSignedMoney(periodSummary(period)!.balanceMinor, overview.currency) }}</strong></span>
              </div>
          </article>
        </div>
      </section>

      <section class="ledger-dashboard-section" aria-labelledby="ledger-trend-title">
        <div class="ledger-section-heading">
          <div>
            <h2 id="ledger-trend-title">收支趋势</h2>
            <p>最近月份的服务端趋势 projection。</p>
          </div>
        </div>
        <div v-if="overview.trend.length" class="ledger-trend-table-wrap">
          <table class="ledger-trend-table" data-testid="ledger-trend">
            <thead><tr><th>月份</th><th>收入</th><th>支出</th><th>结余</th></tr></thead>
            <tbody><tr v-for="point in overview.trend" :key="point.month"><th scope="row">{{ point.month }}</th><td>{{ formatLedgerMoney(point.incomeMinor, overview.currency) }}</td><td>{{ formatLedgerMoney(point.expenseMinor, overview.currency) }}</td><td>{{ formatLedgerSignedMoney(point.balanceMinor, overview.currency) }}</td></tr></tbody>
          </table>
        </div>
        <div v-else class="ledger-inline-empty"><p>还没有趋势数据，开始记账后这里会逐步出现变化。</p></div>
      </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.ledger-dashboard { width: min(100%, 1120px); margin: 0 auto; padding: 34px 28px 64px; box-sizing: border-box; }
.ledger-dashboard-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 26px; }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.ledger-dashboard-header h1 { margin: 0; color: var(--text-h); font-size: clamp(1.7rem, 3vw, 2.25rem); line-height: 1.2; }
.ledger-dashboard-header p:not(.ledger-eyebrow) { margin: 8px 0 0; color: var(--text-muted); font-size: .82rem; }
.ledger-dashboard-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.ledger-primary-button,
.ledger-secondary-button { display: inline-flex; min-height: 39px; align-items: center; justify-content: center; box-sizing: border-box; padding: 7px 14px; border-radius: 7px; font: inherit; font-size: .84rem; font-weight: 650; text-decoration: none; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
.ledger-link-button { padding: 0; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: .78rem; cursor: pointer; }
.ledger-link-button:hover { text-decoration: underline; }
.ledger-refreshing { margin: -12px 0 14px; color: var(--text-muted); font-size: .76rem; }
.ledger-inline-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 0 0 16px; padding: 10px 12px; border: 1px solid color-mix(in srgb, #b42318 30%, var(--border)); border-radius: 8px; color: #b42318; font-size: .8rem; }
.ledger-metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.ledger-metric-card { display: grid; gap: 8px; min-height: 122px; padding: 18px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 11px; background: var(--bg-soft); }
.ledger-metric-card.is-primary { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
.ledger-metric-card span { color: var(--text-muted); font-size: .8rem; }
.ledger-metric-card strong { color: var(--text-h); font-size: 1.35rem; line-height: 1.2; }
.ledger-metric-card small { color: var(--text-muted); font-size: .72rem; }
.ledger-dashboard-section { margin-top: 24px; padding: 20px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg); }
.ledger-section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.ledger-section-heading h2 { margin: 0; color: var(--text-h); font-size: 1rem; }
.ledger-section-heading p { margin: 5px 0 0; color: var(--text-muted); font-size: .76rem; line-height: 1.45; }
.ledger-section-heading > a { flex: 0 0 auto; color: var(--accent); font-size: .78rem; text-decoration: none; }
.ledger-section-heading-with-control { align-items: center; }
.ledger-period-navigation-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
.ledger-period-navigation-controls label { display: grid; gap: 5px; color: var(--text-muted); font-size: .75rem; }
.ledger-period-navigation-controls input,
.ledger-period-navigation-controls select { min-height: 34px; padding: 5px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text-h); font: inherit; font-size: .8rem; }
.ledger-period-navigation-controls input:focus,
.ledger-period-navigation-controls select:focus { border-color: var(--accent); outline: 2px solid color-mix(in srgb, var(--accent) 25%, transparent); outline-offset: 1px; }
.ledger-historical-hint { margin: 13px 0 0; color: var(--text-muted); font-size: .76rem; line-height: 1.45; }
.ledger-period-analysis-loading { display: grid; min-height: 160px; margin-top: 24px; place-items: center; border: 1px dashed var(--border); border-radius: 11px; color: var(--text-muted); font-size: .82rem; }
.ledger-dashboard-account-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.ledger-dashboard-account-group { min-width: 0; }
.ledger-dashboard-account-group h3 { margin: 0 0 8px; color: var(--text-muted); font-size: .78rem; }
.ledger-dashboard-accounts { display: grid; gap: 8px; }
.ledger-dashboard-account { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 65px; padding: 11px 13px; border: 1px solid var(--border); border-radius: 8px; color: inherit; text-decoration: none; }
.ledger-dashboard-account:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.ledger-dashboard-account > span { display: grid; gap: 3px; min-width: 0; }
.ledger-dashboard-account strong { overflow: hidden; color: var(--text-h); font-size: .85rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-dashboard-account small { color: var(--text-muted); font-size: .73rem; }
.ledger-cashflow-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ledger-cashflow-grid > div { display: grid; gap: 5px; padding: 12px; border-radius: 8px; background: var(--bg-soft); }
.ledger-cashflow-grid span { color: var(--text-muted); font-size: .75rem; }
.ledger-cashflow-grid strong { color: var(--text-h); font-size: 1rem; }
.ledger-cashflow-grid .is-income { color: #18794e; }
.ledger-cashflow-grid .is-expense { color: #b42318; }
.ledger-dashboard-two-column { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 14px; }
.ledger-dashboard-two-column .ledger-dashboard-section { min-width: 0; }
.ledger-breakdown-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.ledger-breakdown-columns h3 { margin: 0 0 8px; color: var(--text-muted); font-size: .78rem; }
.ledger-breakdown-list { display: grid; gap: 6px; }
.ledger-breakdown-row { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); font-size: .8rem; }
.ledger-breakdown-label { display: flex; min-width: 0; overflow: hidden; }
.ledger-breakdown-name { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
.ledger-breakdown-share { flex: 0 0 auto; color: var(--text-muted); font-weight: 400; white-space: nowrap; }
.ledger-breakdown-amount { flex: 0 0 auto; color: var(--text-h); text-align: right; white-space: nowrap; }
.ledger-inline-empty { margin: 0; color: var(--text-muted); font-size: .78rem; line-height: 1.45; }
.ledger-inline-empty:has(button) { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ledger-recent-list { display: grid; gap: 0; }
.ledger-recent-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 57px; border-bottom: 1px solid var(--border); }
.ledger-recent-row:last-child { border-bottom: 0; }
.ledger-recent-info { display: grid; gap: 3px; min-width: 0; }
.ledger-recent-info strong { overflow: hidden; color: var(--text-h); font-size: .82rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-recent-info small { overflow: hidden; color: var(--text-muted); font-size: .7rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-recent-amount { flex: 0 0 auto; color: var(--text-h); font-size: .83rem; }
.ledger-recent-amount.is-income { color: #18794e; }
.ledger-recent-amount.is-expense { color: #b42318; }
.ledger-period-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; }
.ledger-period-card { display: grid; gap: 7px; min-height: 110px; padding: 13px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-soft); }
.ledger-period-card h3 { margin: 0; color: var(--text-h); font-size: .82rem; }
.ledger-period-card small { color: var(--text-muted); font-size: .68rem; }
.ledger-period-values { display: grid; gap: 3px; margin-top: auto; color: var(--text-muted); font-size: .7rem; }
.ledger-period-values span { display: flex; justify-content: space-between; gap: 7px; }
.ledger-period-values strong { color: var(--text-h); font-size: .75rem; }
.ledger-trend-table-wrap { overflow-x: auto; }
.ledger-trend-table { width: 100%; border-collapse: collapse; color: var(--text); font-size: .78rem; }
.ledger-trend-table th,
.ledger-trend-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
.ledger-trend-table th:first-child,
.ledger-trend-table td:first-child { text-align: left; }
.ledger-trend-table thead th { color: var(--text-muted); font-size: .72rem; font-weight: 600; }
.ledger-trend-table tbody th { color: var(--text-h); font-weight: 600; }
@media (max-width: 760px) {
  .ledger-dashboard { padding: 28px 16px 48px; }
  .ledger-dashboard-header { align-items: stretch; flex-direction: column; }
  .ledger-dashboard-actions > * { flex: 1 1 150px; }
  .ledger-metric-grid,
  .ledger-dashboard-account-groups,
  .ledger-dashboard-two-column { grid-template-columns: 1fr; }
  .ledger-cashflow-grid { grid-template-columns: 1fr; }
  .ledger-period-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 420px) {
  .ledger-dashboard-section { padding: 16px 13px; }
  .ledger-breakdown-columns { grid-template-columns: 1fr; gap: 18px; }
  .ledger-section-heading-with-control { align-items: flex-start; flex-direction: column; }
  .ledger-period-navigation-controls { align-items: stretch; flex-direction: column; }
  .ledger-period-navigation-controls label,
  .ledger-period-navigation-controls input,
  .ledger-period-navigation-controls select { width: 100%; box-sizing: border-box; }
}
</style>
