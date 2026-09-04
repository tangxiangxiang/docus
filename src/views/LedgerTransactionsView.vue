<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  LedgerCategoryDto,
  LedgerTransactionDto,
  LedgerTransactionFilterType,
  LedgerTransactionQuery,
} from '../../shared/ledgerProtocol'
import LedgerTransactionDetailSheet from '../components/ledger/LedgerTransactionDetailSheet.vue'
import LedgerTransactionSheet from '../components/ledger/LedgerTransactionSheet.vue'
import { ledgerErrorMessage } from '../features/ledger/ledgerErrors'
import { formatLedgerMoney } from '../features/ledger/money'
import { instantFromLedgerDate, formatLedgerDateTime } from '../features/ledger/time'
import { useLedgerStore } from '../features/ledger/ledgerStore'

const store = useLedgerStore()
const transactionSheetOpen = ref(false)
const detailOpen = ref(false)
const selectedTransaction = ref<LedgerTransactionDto | null>(null)
const filterType = ref<LedgerTransactionFilterType | 'all'>('all')
const filterAccountId = ref('')
const filterCategoryId = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const filtersLoading = ref(false)
const loadMoreLoading = ref(false)
const filterError = ref('')

const loading = computed(() => store.workspaceState.value === 'BOOTSTRAPPING' || filtersLoading.value)
const page = computed(() => store.transactions.value)
const transactions = computed(() => page.value?.transactions ?? [])
const hasFilters = computed(() => filterType.value !== 'all' || Boolean(filterAccountId.value || filterCategoryId.value || filterFrom.value || filterTo.value))

onMounted(async () => {
  await store.bootstrap()
  if (store.settings.value) await loadTransactions()
})

function accountName(id: string): string {
  return store.accounts.value.find((account) => account.id === id)?.name ?? '未知账户'
}

function categoryName(id: string): string {
  return store.categories.value.find((category) => category.id === id)?.name ?? '未知分类'
}

function categoryLabel(category: LedgerCategoryDto): string {
  return `${category.name}${category.archivedAt !== null ? '（已归档）' : ''}`
}

function typeLabel(type: string): string {
  if (type === 'income') return '收入'
  if (type === 'expense') return '支出'
  if (type === 'transfer') return '转账'
  return '余额调整'
}

function transactionTitle(transaction: LedgerTransactionDto): string {
  if (transaction.type === 'income' || transaction.type === 'expense') return transaction.payee || categoryName(transaction.categoryId)
  if (transaction.type === 'transfer') return `${accountName(transaction.fromAccountId)} → ${accountName(transaction.toAccountId)}`
  return '余额调整'
}

function transactionMeta(transaction: LedgerTransactionDto): string {
  if (transaction.type === 'income' || transaction.type === 'expense') return `${categoryName(transaction.categoryId)} · ${accountName(transaction.accountId)}`
  if (transaction.type === 'transfer') return '账户之间转账'
  return accountName(transaction.accountId)
}

function transactionAmount(transaction: LedgerTransactionDto): string {
  const currency = store.settings.value?.baseCurrency ?? 'CNY'
  if (transaction.type === 'income') return `+${formatLedgerMoney(transaction.amountMinor, currency)}`
  if (transaction.type === 'expense') return `-${formatLedgerMoney(transaction.amountMinor, currency)}`
  return formatLedgerMoney(transaction.amountMinor, currency)
}

function buildQuery(): LedgerTransactionQuery {
  const timezone = store.settings.value?.timezone ?? 'UTC'
  return {
    type: filterType.value,
    limit: 25,
    ...(filterAccountId.value ? { accountId: filterAccountId.value } : {}),
    ...(filterCategoryId.value ? { categoryId: filterCategoryId.value } : {}),
    ...(filterFrom.value ? { from: instantFromLedgerDate(filterFrom.value, timezone, 'start') } : {}),
    ...(filterTo.value ? { to: instantFromLedgerDate(filterTo.value, timezone, 'end') } : {}),
  }
}

async function loadTransactions(): Promise<void> {
  if (!store.settings.value || filtersLoading.value) return
  filtersLoading.value = true
  filterError.value = ''
  try {
    await store.refreshTransactions(buildQuery())
    if (store.error.value) filterError.value = ledgerErrorMessage(store.error.value, '交易列表暂时无法加载。')
  } catch (cause) {
    filterError.value = ledgerErrorMessage(cause, '交易列表暂时无法加载。')
  } finally {
    filtersLoading.value = false
  }
}

async function applyFilters(): Promise<void> {
  try {
    buildQuery()
  } catch {
    filterError.value = '请选择有效的日期范围。'
    return
  }
  await loadTransactions()
}

async function clearFilters(): Promise<void> {
  filterType.value = 'all'
  filterAccountId.value = ''
  filterCategoryId.value = ''
  filterFrom.value = ''
  filterTo.value = ''
  await loadTransactions()
}

async function loadMore(): Promise<void> {
  if (!page.value?.page.nextCursor || loadMoreLoading.value) return
  loadMoreLoading.value = true
  filterError.value = ''
  try {
    await store.loadMoreTransactions()
    if (store.error.value) filterError.value = ledgerErrorMessage(store.error.value, '更多交易暂时无法加载。')
  } catch (cause) {
    filterError.value = ledgerErrorMessage(cause, '更多交易暂时无法加载。')
  } finally {
    loadMoreLoading.value = false
  }
}

function inspect(transaction: LedgerTransactionDto): void {
  selectedTransaction.value = transaction
  detailOpen.value = true
}

function onTransactionUpdated(transaction: LedgerTransactionDto): void {
  selectedTransaction.value = transaction
}

function onTransactionDeleted(): void {
  selectedTransaction.value = null
}
</script>

<template>
  <main class="ledger-page ledger-transactions-page" data-testid="ledger-transactions-page">
    <header class="ledger-transactions-header">
      <div>
        <p class="ledger-eyebrow">Ledger</p>
        <h1>交易记录</h1>
        <p>查看真实交易历史，或快速记下一笔。</p>
      </div>
      <button class="ledger-primary-button" type="button" :disabled="loading || !store.activeAccounts.value.length" data-testid="ledger-transactions-record-button" @click="transactionSheetOpen = true">＋ 记一笔</button>
    </header>

    <section v-if="store.settings.value" class="ledger-filters" aria-labelledby="ledger-filters-title">
      <div class="ledger-filters-heading">
        <h2 id="ledger-filters-title">筛选</h2>
        <button v-if="hasFilters" class="ledger-link-button" type="button" @click="clearFilters">清除筛选</button>
      </div>
      <div class="ledger-filters-grid">
        <label><span>类型</span><select v-model="filterType" name="type"><option value="all">全部类型</option><option value="income">收入</option><option value="expense">支出</option><option value="transfer">转账</option></select></label>
        <label><span>账户</span><select v-model="filterAccountId" name="accountId"><option value="">全部账户</option><option v-for="account in store.accounts.value" :key="account.id" :value="account.id">{{ account.name }}{{ account.archivedAt !== null ? '（已归档）' : '' }}</option></select></label>
        <label><span>分类</span><select v-model="filterCategoryId" name="categoryId"><option value="">全部分类</option><option v-for="category in store.categories.value" :key="category.id" :value="category.id">{{ categoryLabel(category) }}</option></select></label>
        <label><span>从日期</span><input v-model="filterFrom" name="from" type="date" /></label>
        <label><span>到日期</span><input v-model="filterTo" name="to" type="date" /></label>
        <button class="ledger-secondary-button ledger-filter-submit" data-testid="ledger-filter-submit" type="button" :disabled="filtersLoading" @click="applyFilters">{{ filtersLoading ? '正在加载…' : '应用筛选' }}</button>
      </div>
    </section>

    <div v-if="loading && !page" class="ledger-transactions-state" data-testid="ledger-transactions-loading" role="status">正在加载交易…</div>
    <section v-else-if="!store.settings.value" class="ledger-transactions-state" data-testid="ledger-transactions-needs-settings">
      <h2>请先完成 Ledger 初始化</h2>
      <p>设置基础货币、时区并创建账户后，交易记录才会出现在这里。</p>
    </section>
    <section v-else-if="!store.activeAccounts.value.length" class="ledger-transactions-state" data-testid="ledger-transactions-no-account">
      <h2>还没有可用账户</h2>
      <p>请先创建或恢复一个账户，再新增交易。</p>
    </section>
    <section v-else class="ledger-transaction-history" aria-labelledby="ledger-history-title">
      <div class="ledger-history-heading">
        <div><h2 id="ledger-history-title">历史记录</h2><p>{{ transactions.length }} 笔当前结果</p></div>
        <span v-if="store.settings.value" class="ledger-timezone-note">按 {{ store.settings.value.timezone }} 显示</span>
      </div>

      <div v-if="filterError" class="ledger-inline-error" role="alert"><span>{{ filterError }}</span><button class="ledger-link-button" type="button" @click="loadTransactions">重试</button></div>
      <div v-if="transactions.length" class="ledger-transaction-list" data-testid="ledger-transaction-list">
        <button v-for="transaction in transactions" :key="transaction.id" :data-testid="`ledger-transaction-row-${transaction.id}`" class="ledger-transaction-row" type="button" @click="inspect(transaction)">
          <span class="ledger-transaction-main"><strong>{{ transactionTitle(transaction) }}</strong><small>{{ typeLabel(transaction.type) }} · {{ transactionMeta(transaction) }}</small></span>
          <span class="ledger-transaction-date">{{ formatLedgerDateTime(transaction.occurredAt, store.settings.value?.timezone ?? 'UTC') }}</span>
          <strong :class="['ledger-transaction-amount', `is-${transaction.type}`]">{{ transactionAmount(transaction) }}</strong>
        </button>
      </div>
      <div v-else class="ledger-transactions-empty" data-testid="ledger-transactions-empty" role="status">
        <h3>{{ hasFilters ? '没有符合筛选条件的交易' : '还没有交易记录' }}</h3>
        <p>{{ hasFilters ? '可以清除筛选，或换一个日期和账户。' : '保存第一笔收入、支出或转账后，它会显示在这里。' }}</p>
        <button v-if="hasFilters" class="ledger-secondary-button" type="button" @click="clearFilters">清除筛选</button>
        <button v-else class="ledger-primary-button" type="button" :disabled="!store.activeAccounts.value.length" @click="transactionSheetOpen = true">记下第一笔</button>
      </div>
      <button v-if="page?.page.nextCursor" class="ledger-load-more" data-testid="ledger-load-more" type="button" :disabled="loadMoreLoading" @click="loadMore">{{ loadMoreLoading ? '正在加载…' : '加载更多' }}</button>
    </section>

    <LedgerTransactionSheet :open="transactionSheetOpen" @close="transactionSheetOpen = false" />
    <LedgerTransactionDetailSheet :open="detailOpen" :transaction="selectedTransaction" @close="detailOpen = false" @updated="onTransactionUpdated" @deleted="onTransactionDeleted" />
  </main>
</template>

<style scoped>
.ledger-page { min-height: calc(100vh - 52px); background: var(--bg); }
.ledger-transactions-page { width: min(100%, 1120px); margin: 0 auto; padding: 34px 28px 64px; box-sizing: border-box; }
.ledger-transactions-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; margin-bottom: 22px; }
.ledger-eyebrow { margin: 0 0 5px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.ledger-transactions-header h1 { margin: 0; color: var(--text-h); font-size: 2rem; line-height: 1.2; }
.ledger-transactions-header p:not(.ledger-eyebrow) { margin: 8px 0 0; color: var(--text-muted); font-size: .84rem; }
.ledger-primary-button,
.ledger-secondary-button { display: inline-flex; min-height: 39px; align-items: center; justify-content: center; box-sizing: border-box; padding: 7px 14px; border-radius: 7px; font: inherit; font-size: .83rem; font-weight: 650; text-decoration: none; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
.ledger-link-button { padding: 0; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: .78rem; cursor: pointer; }
.ledger-link-button:hover { text-decoration: underline; }
.ledger-filters { margin-bottom: 21px; padding: 17px 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-soft); }
.ledger-filters-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ledger-filters-heading h2 { margin: 0; color: var(--text-h); font-size: .92rem; }
.ledger-filters-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto; gap: 10px; align-items: end; }
.ledger-filters-grid label { display: grid; gap: 5px; min-width: 0; }
.ledger-filters-grid label > span { color: var(--text-muted); font-size: .72rem; }
.ledger-filters-grid select,
.ledger-filters-grid input { width: 100%; min-height: 35px; padding: 5px 8px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text-h); font: inherit; font-size: .78rem; }
.ledger-filter-submit { white-space: nowrap; }
.ledger-transactions-state { display: grid; min-height: 340px; place-items: center; align-content: center; gap: 9px; padding: 30px 18px; color: var(--text-muted); text-align: center; }
.ledger-transactions-state h2,
.ledger-transactions-state p { margin: 0; }
.ledger-transactions-state h2 { color: var(--text-h); font-size: 1.2rem; }
.ledger-transaction-history { padding: 20px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg); }
.ledger-history-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 13px; }
.ledger-history-heading h2 { margin: 0; color: var(--text-h); font-size: 1rem; }
.ledger-history-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: .75rem; }
.ledger-timezone-note { color: var(--text-muted); font-size: .73rem; }
.ledger-inline-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; padding: 9px 11px; border: 1px solid color-mix(in srgb, #b42318 30%, var(--border)); border-radius: 7px; color: #b42318; font-size: .78rem; }
.ledger-transaction-list { display: grid; }
.ledger-transaction-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(150px, auto) minmax(100px, auto); align-items: center; gap: 16px; width: 100%; min-height: 68px; padding: 10px 4px; box-sizing: border-box; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: inherit; text-align: left; cursor: pointer; }
.ledger-transaction-row:hover { background: var(--bg-soft); }
.ledger-transaction-main { display: grid; gap: 3px; min-width: 0; }
.ledger-transaction-main strong { overflow: hidden; color: var(--text-h); font-size: .84rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-transaction-main small,
.ledger-transaction-date { overflow: hidden; color: var(--text-muted); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-transaction-date { text-align: right; }
.ledger-transaction-amount { text-align: right; color: var(--text-h); font-size: .83rem; }
.ledger-transaction-amount.is-income { color: #18794e; }
.ledger-transaction-amount.is-expense { color: #b42318; }
.ledger-transactions-empty { display: grid; min-height: 240px; place-items: center; align-content: center; gap: 8px; color: var(--text-muted); text-align: center; }
.ledger-transactions-empty h3,
.ledger-transactions-empty p { margin: 0; }
.ledger-transactions-empty h3 { color: var(--text-h); font-size: 1rem; }
.ledger-transactions-empty p { font-size: .8rem; }
.ledger-load-more { display: block; min-height: 36px; margin: 16px auto 0; padding: 6px 16px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-soft); color: var(--text-h); font: inherit; font-size: .8rem; cursor: pointer; }
.ledger-load-more:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-load-more:disabled { cursor: wait; opacity: .65; }
@media (max-width: 850px) {
  .ledger-filters-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ledger-filter-submit { grid-column: span 3; }
}
@media (max-width: 620px) {
  .ledger-transactions-page { padding: 28px 16px 48px; }
  .ledger-transactions-header { align-items: stretch; flex-direction: column; }
  .ledger-transactions-header > button { width: 100%; }
  .ledger-filters-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ledger-filter-submit { grid-column: span 2; }
  .ledger-transaction-history { padding: 16px 13px; }
  .ledger-transaction-row { grid-template-columns: minmax(0, 1fr) auto; gap: 5px 12px; }
  .ledger-transaction-date { grid-column: 1; grid-row: 2; text-align: left; }
  .ledger-transaction-amount { grid-column: 2; grid-row: 1 / span 2; }
}
</style>
