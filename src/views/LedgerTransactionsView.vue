<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NPagination,
  NSelect,
  NSpin,
  type SelectOption,
} from 'naive-ui'
import { useRoute } from 'vue-router'
import type {
  LedgerCategoryDto,
  LedgerTransactionDto,
  LedgerTransactionFilterType,
  LedgerTransactionQuery,
} from '../../shared/ledgerProtocol'
import LedgerTransactionDetailSheet from '../components/ledger/LedgerTransactionDetailSheet.vue'
import LedgerPendingCreateGate from '../components/ledger/LedgerPendingCreateGate.vue'
import LedgerTransactionSheet from '../components/ledger/LedgerTransactionSheet.vue'
import { ledgerErrorMessage } from '../features/ledger/ledgerErrors'
import { formatLedgerMoney } from '../features/ledger/money'
import { instantFromLedgerDate, formatLedgerDateTime } from '../features/ledger/time'
import { useLedgerStore } from '../features/ledger/ledgerStore'
import { ledgerSelectNodeProps } from '../features/ledger/naiveControls'
import LedgerDatePicker from '../components/ledger/LedgerDatePicker.vue'

const store = useLedgerStore()
const route = useRoute()
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
const tablePage = ref(1)
const tablePageSize = 10

const typeOptions: SelectOption[] = [
  { value: 'all', label: '全部类型' },
  { value: 'income', label: '收入' },
  { value: 'expense', label: '支出' },
  { value: 'transfer', label: '转账' },
]
const accountOptions = computed<SelectOption[]>(() => [
  { value: '', label: '全部账户' },
  ...store.accounts.value.map((account) => ({
    value: account.id,
    label: `${account.name}${account.archivedAt !== null ? '（已归档）' : ''}`,
  })),
])
const categoryOptions = computed<SelectOption[]>(() => [
  { value: '', label: '全部分类' },
  ...store.categories.value.map((category) => ({
    value: category.id,
    label: categoryLabel(category),
  })),
])

const loading = computed(() => store.workspaceState.value === 'BOOTSTRAPPING' || filtersLoading.value)
const page = computed(() => store.transactions.value)
const transactions = computed(() => page.value?.transactions ?? [])
const tablePageCount = computed(() => Math.ceil(transactions.value.length / tablePageSize) + (page.value?.page.nextCursor ? 1 : 0))
const visibleTransactions = computed(() => transactions.value.slice((tablePage.value - 1) * tablePageSize, tablePage.value * tablePageSize))
const hasFilters = computed(() => filterType.value !== 'all' || Boolean(filterAccountId.value || filterCategoryId.value || filterFrom.value || filterTo.value))

function queryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function initializeFiltersFromRoute(): void {
  filterAccountId.value = queryValue(route.query.accountId)
  filterCategoryId.value = queryValue(route.query.categoryId)
  const type = queryValue(route.query.type)
  if (type === 'income' || type === 'expense' || type === 'transfer' || type === 'all') {
    filterType.value = type
  }
  filterFrom.value = queryValue(route.query.from)
  filterTo.value = queryValue(route.query.to)
}

onMounted(async () => {
  initializeFiltersFromRoute()
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
  tablePage.value = 1
  filterError.value = ''
  try {
    await store.refreshTransactions(buildQuery())
    if (store.transactionsError.value) filterError.value = ledgerErrorMessage(store.transactionsError.value, '交易列表暂时无法加载。')
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

async function changeTablePage(nextPage: number): Promise<void> {
  if (nextPage > Math.ceil(transactions.value.length / tablePageSize) && page.value?.page.nextCursor) {
    await loadMore()
  }
  tablePage.value = nextPage
}

async function loadMore(): Promise<void> {
  if (!page.value?.page.nextCursor || loadMoreLoading.value) return
  loadMoreLoading.value = true
  filterError.value = ''
  try {
    await store.loadMoreTransactions()
    if (store.transactionsError.value) filterError.value = ledgerErrorMessage(store.transactionsError.value, '更多交易暂时无法加载。')
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

function onRecoveryResolved(): void {
  transactionSheetOpen.value = false
  detailOpen.value = false
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
      <div class="ledger-transactions-header-actions">
        <RouterLink class="ledger-secondary-button" :to="{ name: 'ledger' }" data-testid="ledger-transactions-overview-button">返回总览</RouterLink>
        <NButton class="ledger-primary-button" attr-type="button" type="primary" size="medium" :bordered="false" :disabled="loading || store.hasUnresolvedCreate.value || !store.activeAccounts.value.length" data-testid="ledger-transactions-record-button" @click="transactionSheetOpen = true">＋ 记一笔</NButton>
      </div>
    </header>

    <LedgerPendingCreateGate v-if="store.recoveryGateVisible.value" @resolved="onRecoveryResolved" />

    <NCard v-else-if="store.settings.value" class="ledger-filters" :bordered="false" size="small" aria-labelledby="ledger-filters-title">
      <NForm class="ledger-filters-form" data-testid="ledger-filters-form" @submit.prevent="applyFilters">
        <div class="ledger-filters-heading">
          <h2 id="ledger-filters-title">筛选</h2>
          <NButton v-if="hasFilters" class="ledger-link-button" attr-type="button" size="small" text :bordered="false" @click="clearFilters">清除筛选</NButton>
        </div>
        <div class="ledger-filters-grid">
          <NFormItem class="ledger-filter-item" label="类型" :show-feedback="false">
            <NSelect v-model:value="filterType" class="ledger-filter-control" size="small" :options="typeOptions" :node-props="ledgerSelectNodeProps" :input-props="{ id: 'ledger-filter-type', name: 'type' }" role="combobox" aria-haspopup="listbox" aria-label="类型" />
          </NFormItem>
          <NFormItem class="ledger-filter-item" label="账户" :show-feedback="false">
            <NSelect v-model:value="filterAccountId" class="ledger-filter-control" size="small" :options="accountOptions" :node-props="ledgerSelectNodeProps" :input-props="{ id: 'ledger-filter-account', name: 'accountId' }" role="combobox" aria-haspopup="listbox" aria-label="账户" />
          </NFormItem>
          <NFormItem class="ledger-filter-item" label="分类" :show-feedback="false">
            <NSelect v-model:value="filterCategoryId" class="ledger-filter-control" size="small" :options="categoryOptions" :node-props="ledgerSelectNodeProps" :input-props="{ id: 'ledger-filter-category', name: 'categoryId' }" role="combobox" aria-haspopup="listbox" aria-label="分类" />
          </NFormItem>
          <NFormItem class="ledger-filter-item" label="从日期" :show-feedback="false">
            <LedgerDatePicker v-model="filterFrom" label="从日期" test-id="ledger-filter-from" clearable placeholder="开始日期" />
          </NFormItem>
          <NFormItem class="ledger-filter-item" label="到日期" :show-feedback="false">
            <LedgerDatePicker v-model="filterTo" label="到日期" test-id="ledger-filter-to" clearable placeholder="结束日期" />
          </NFormItem>
          <NButton class="ledger-secondary-button ledger-filter-submit" attr-type="submit" size="small" :bordered="false" data-testid="ledger-filter-submit" :disabled="filtersLoading">{{ filtersLoading ? '正在加载…' : '应用筛选' }}</NButton>
        </div>
      </NForm>
    </NCard>

    <div v-if="!store.hasUnresolvedCreate.value && loading && !page && !store.settings.value" class="ledger-transactions-state ledger-loading-state" data-testid="ledger-transactions-loading" role="status"><NSpin size="medium" description="正在加载交易…" /></div>
    <NEmpty v-else-if="!store.hasUnresolvedCreate.value && !store.settings.value" class="ledger-transactions-state ledger-empty-state" data-testid="ledger-transactions-needs-settings" :show-icon="false" description="请先完成 Ledger 初始化">
      <template #extra><div class="ledger-state-extra">设置基础货币、时区并创建账户后，交易记录才会出现在这里。</div></template>
    </NEmpty>
    <NCard v-else-if="!store.hasUnresolvedCreate.value && store.settings.value" class="ledger-transaction-history" :bordered="false" size="small" aria-labelledby="ledger-history-title">
      <div v-if="!store.activeAccounts.value.length" class="ledger-no-active-account-notice" data-testid="ledger-transactions-no-account" role="status">
        <div>
          <strong>当前没有可用于新增交易的账户。</strong>
          <p>历史记录仍然可以查看；恢复账户或创建新账户后即可继续记账。</p>
        </div>
        <div class="ledger-notice-actions">
          <RouterLink class="ledger-secondary-button" :to="{ name: 'ledger-accounts' }">恢复账户</RouterLink>
          <RouterLink class="ledger-secondary-button" :to="{ name: 'ledger-accounts' }">创建新账户</RouterLink>
        </div>
      </div>
      <div class="ledger-history-heading">
        <div><h2 id="ledger-history-title">历史记录</h2><p>{{ transactions.length }} 笔当前结果</p></div>
        <span v-if="store.settings.value" class="ledger-timezone-note">按 {{ store.settings.value.timezone }} 显示</span>
      </div>

      <NAlert v-if="filterError" class="ledger-inline-error" type="error" :show-icon="false" role="alert"><span>{{ filterError }}</span><NButton class="ledger-link-button" attr-type="button" size="small" text :bordered="false" @click="loadTransactions">重试</NButton></NAlert>
      <div v-if="loading && !page" class="ledger-transactions-inline-loading" data-testid="ledger-transactions-inline-loading" role="status"><NSpin size="medium" description="正在加载交易…" /></div>
      <table
        v-else-if="transactions.length"
        class="ledger-transaction-table"
        data-testid="ledger-transaction-list"
      >
        <thead>
          <tr>
            <th scope="col">交易</th>
            <th scope="col">类型</th>
            <th scope="col">备注</th>
            <th scope="col">时间</th>
            <th scope="col">金额</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="transaction in visibleTransactions"
            :key="transaction.id"
            class="ledger-transaction-row"
            :data-testid="`ledger-transaction-row-${transaction.id}`"
            tabindex="0"
            @click="inspect(transaction)"
            @keydown.enter="inspect(transaction)"
            @keydown.space.prevent="inspect(transaction)"
          >
            <td>
              <span class="ledger-table-primary"><strong>{{ transactionTitle(transaction) }}</strong><small>{{ transactionMeta(transaction) }}</small></span>
            </td>
            <td><span :class="['ledger-transaction-type', `is-${transaction.type}`]">{{ typeLabel(transaction.type) }}</span></td>
            <td><span class="ledger-transaction-note" :title="transaction.note || undefined">{{ transaction.note || '—' }}</span></td>
            <td><span class="ledger-transaction-date">{{ formatLedgerDateTime(transaction.occurredAt, store.settings.value?.timezone ?? 'UTC') }}</span></td>
            <td><strong :class="['ledger-transaction-amount', `is-${transaction.type}`]">{{ transactionAmount(transaction) }}</strong></td>
          </tr>
        </tbody>
      </table>
      <NEmpty v-else class="ledger-transactions-empty" data-testid="ledger-transactions-empty" :show-icon="false" :description="hasFilters ? '没有符合筛选条件的交易' : '还没有交易记录'">
        <template #extra>
          <div class="ledger-empty-extra">
            <p>{{ hasFilters ? '可以清除筛选，或换一个日期和账户。' : '保存第一笔收入、支出或转账后，它会显示在这里。' }}</p>
            <NButton v-if="hasFilters" class="ledger-secondary-button" attr-type="button" size="medium" :bordered="false" @click="clearFilters">清除筛选</NButton>
            <NButton v-else class="ledger-primary-button" attr-type="button" type="primary" size="medium" :bordered="false" :disabled="!store.activeAccounts.value.length" @click="transactionSheetOpen = true">记下第一笔</NButton>
          </div>
        </template>
      </NEmpty>
      <div v-if="transactions.length" class="ledger-transaction-pagination">
        <NPagination
          :page="tablePage"
          :page-count="tablePageCount"
          :page-size="tablePageSize"
          :disabled="loadMoreLoading"
          show-quick-jumper
          @update:page="changeTablePage"
        />
        <span v-if="loadMoreLoading" class="ledger-pagination-loading">正在加载…</span>
      </div>
      <NButton v-if="page?.page.nextCursor" class="ledger-load-more" attr-type="button" size="small" :bordered="false" data-testid="ledger-load-more" :disabled="loadMoreLoading" @click="loadMore">{{ loadMoreLoading ? '正在加载…' : '加载更多' }}</NButton>
    </NCard>

    <LedgerTransactionSheet v-if="!store.recoveryGateVisible.value" :open="transactionSheetOpen" @close="transactionSheetOpen = false" />
    <LedgerTransactionDetailSheet :open="detailOpen" :transaction="selectedTransaction" @close="detailOpen = false" @updated="onTransactionUpdated" @deleted="onTransactionDeleted" />
  </main>
</template>

<style scoped>
.ledger-page { min-height: calc(100vh - 52px); background: var(--bg); }
.ledger-transactions-page { width: min(100%, 1120px); margin: 0 auto; padding: 34px 28px 64px; box-sizing: border-box; }
.ledger-transactions-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; margin-bottom: 22px; }
.ledger-transactions-header-actions { display: flex; align-items: center; gap: 10px; }
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
.ledger-filters :deep(.n-card__content),
.ledger-transaction-history :deep(.n-card__content) { padding: 0; }
.ledger-filters-form { display: grid; gap: 12px; }
.ledger-filters-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ledger-filters-heading h2 { margin: 0; color: var(--text-h); font-size: .92rem; }
.ledger-filters-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto; gap: 10px; align-items: end; }
.ledger-filter-item { min-width: 0; }
.ledger-filter-item :deep(.n-form-item-label) { color: var(--text-muted); font-size: .72rem; }
.ledger-filter-control { width: 100%; }
.ledger-filters-grid :deep(.ledger-filter-control .n-base-selection),
.ledger-filters-grid :deep(.ledger-date-picker),
.ledger-filters-grid :deep(.ledger-date-picker .n-date-picker) { width: 100%; }
.ledger-filters-grid :deep(.ledger-date-picker .n-input) { width: 100%; }
.ledger-filter-submit { white-space: nowrap; }
.ledger-transactions-state { display: grid; min-height: 340px; align-content: center; gap: 9px; padding: 30px 18px; color: var(--text-muted); }
.ledger-loading-state { place-items: center; text-align: center; }
.ledger-empty-state { place-items: center start; text-align: left; }
.ledger-loading-state :deep(.n-spin-container) { display: grid; place-items: center; }
.ledger-empty-state :deep(.n-empty__extra) { text-align: left; }
.ledger-transactions-state :deep(.n-empty__description) { color: var(--text-h); font-size: 1.1rem; }
.ledger-transactions-state :deep(.n-empty__extra) { max-width: 34rem; color: var(--text-muted); font-size: .82rem; line-height: 1.5; }
.ledger-transactions-state h2,
.ledger-transactions-state p { margin: 0; }
.ledger-transactions-state h2 { color: var(--text-h); font-size: 1.2rem; }
.ledger-transaction-history { padding: 20px; border: 1px solid var(--border); border-radius: 11px; background: var(--bg); }
.ledger-history-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 13px; }
.ledger-history-heading h2 { margin: 0; color: var(--text-h); font-size: 1rem; }
.ledger-history-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: .75rem; }
.ledger-timezone-note { color: var(--text-muted); font-size: .73rem; }
.ledger-inline-error { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: #b42318; font-size: .78rem; }
.ledger-inline-error :deep(.n-alert-body) { width: 100%; }
.ledger-inline-error :deep(.n-alert__content) { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
.ledger-transactions-inline-loading { display: grid; min-height: 220px; place-items: center; color: var(--text-muted); }
.ledger-transaction-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ledger-transaction-table th { padding: 0 8px 9px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: .73rem; font-weight: 650; text-align: left; }
.ledger-transaction-table th:nth-child(2),
.ledger-transaction-table th:nth-child(4),
.ledger-transaction-table th:nth-child(5) { text-align: right; }
.ledger-transaction-table td { padding: 13px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); vertical-align: middle; }
.ledger-transaction-table th:first-child,
.ledger-transaction-table td:first-child { width: 34%; }
.ledger-transaction-table th:nth-child(2),
.ledger-transaction-table td:nth-child(2) { width: 13%; }
.ledger-transaction-table th:nth-child(3),
.ledger-transaction-table td:nth-child(3) { width: 20%; }
.ledger-transaction-table th:nth-child(4),
.ledger-transaction-table td:nth-child(4) { width: 20%; }
.ledger-transaction-table th:nth-child(5),
.ledger-transaction-table td:nth-child(5) { width: 13%; }
.ledger-transaction-row { cursor: pointer; }
.ledger-transaction-row:hover td { background: var(--bg-soft); }
.ledger-table-primary { display: grid; gap: 3px; min-width: 0; }
.ledger-table-primary strong { overflow: hidden; color: var(--text-h); font-size: .84rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-table-primary small,
.ledger-transaction-date { overflow: hidden; color: var(--text-muted); font-size: .72rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-transaction-date { display: block; text-align: right; }
.ledger-transaction-type { color: var(--text-muted); font-size: .78rem; }
.ledger-transaction-type.is-income { color: #18794e; }
.ledger-transaction-type.is-expense { color: #b42318; }
.ledger-transaction-note { display: block; overflow: hidden; color: var(--text-muted); font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-transaction-amount { text-align: right; color: var(--text-h); font-size: .83rem; }
.ledger-transaction-amount.is-income { color: #18794e; }
.ledger-transaction-amount.is-expense { color: #b42318; }
.ledger-transactions-empty { display: grid; min-height: 240px; place-items: center start; align-content: center; gap: 8px; color: var(--text-muted); text-align: left; }
.ledger-transactions-empty :deep(.n-empty__description) { color: var(--text-h); font-size: 1rem; }
.ledger-transactions-empty :deep(.n-empty__extra) { display: grid; gap: 8px; color: var(--text-muted); font-size: .8rem; text-align: left; }
.ledger-empty-extra { display: grid; justify-items: start; gap: 8px; text-align: left; }
.ledger-transactions-empty p { margin: 0; }
.ledger-no-active-account-notice { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 18px; padding: 12px 13px; border: 1px solid color-mix(in srgb, #b7791f 30%, var(--border)); border-radius: 8px; background: color-mix(in srgb, #f6ad55 7%, var(--bg-soft)); }
.ledger-no-active-account-notice strong { color: var(--text-h); font-size: .8rem; }
.ledger-no-active-account-notice p { margin: 4px 0 0; color: var(--text-muted); font-size: .75rem; }
.ledger-notice-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ledger-load-more { display: block; min-height: 36px; margin: 16px auto 0; padding: 6px 16px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-soft); color: var(--text-h); font: inherit; font-size: .8rem; cursor: pointer; }
.ledger-load-more:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-load-more:disabled { cursor: wait; opacity: .65; }
.ledger-transaction-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 18px; }
.ledger-pagination-loading { color: var(--text-muted); font-size: .75rem; }
@media (max-width: 850px) {
  .ledger-filters-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ledger-filter-submit { grid-column: span 3; }
}
@media (max-width: 620px) {
  .ledger-transactions-page { padding: 28px 16px 48px; }
  .ledger-transactions-header { align-items: stretch; flex-direction: column; }
  .ledger-transactions-header-actions { width: 100%; }
  .ledger-transactions-header-actions > * { flex: 1; }
  .ledger-no-active-account-notice { align-items: stretch; flex-direction: column; }
  .ledger-notice-actions > * { flex: 1 1 140px; }
  .ledger-filters-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ledger-filter-submit { grid-column: span 2; }
  .ledger-transaction-history { padding: 16px 13px; }
  .ledger-transaction-table th,
  .ledger-transaction-table td { padding-right: 6px; padding-left: 6px; }
  .ledger-transaction-table th:nth-child(4),
  .ledger-transaction-table td:nth-child(4) { display: none; }
  .ledger-transaction-table th:first-child,
  .ledger-transaction-table td:first-child { width: 42%; }
  .ledger-transaction-table th:nth-child(2),
  .ledger-transaction-table td:nth-child(2) { width: 18%; }
  .ledger-transaction-table th:nth-child(3),
  .ledger-transaction-table td:nth-child(3) { width: 18%; }
  .ledger-transaction-table th:nth-child(5),
  .ledger-transaction-table td:nth-child(5) { width: 22%; }
}
</style>
