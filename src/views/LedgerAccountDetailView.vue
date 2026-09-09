<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NCard, NModal, NResult, NSpin, NStatistic, NTooltip } from 'naive-ui'
import { useRoute } from 'vue-router'
import { useConfirm } from '../composables/useConfirm'
import LedgerAnimatedMoney from '../components/ledger/LedgerAnimatedMoney.vue'
import LedgerAccountIcon from '../components/ledger/LedgerAccountIcon.vue'
import LedgerAccountEditForm from '../components/ledger/LedgerAccountEditForm.vue'
import LedgerPendingCreateGate from '../components/ledger/LedgerPendingCreateGate.vue'
import { ledgerAccountTypeOptionsForNature } from '../features/ledger/accountPresentation'
import { ledgerErrorMessage } from '../features/ledger/ledgerErrors'
import { formatLedgerMoney, formatLedgerSignedMoney } from '../features/ledger/money'
import { formatLedgerDateTime } from '../features/ledger/time'
import { useLedgerStore } from '../features/ledger/ledgerStore'
import type { LedgerAccountDto, LedgerMovementSummary, LedgerTransactionDto } from '../../shared/ledgerProtocol'

const route = useRoute()
const store = useLedgerStore()
const { confirm } = useConfirm()

const account = ref<LedgerAccountDto | null>(null)
const hasHistory = ref(false)
const transactionCount = ref(0)
const recentTransactions = ref<readonly LedgerTransactionDto[]>([])
const movement = ref<LedgerMovementSummary | null>(null)
const loading = ref(false)
const editing = ref(false)
const actionError = ref('')
let loadSequence = 0

const accountId = computed(() => String(route.params.id ?? ''))
const returnFromOverview = computed(() => route.query.from === 'overview')
const returnLabel = computed(() => returnFromOverview.value ? '返回总览' : '返回列表')
const returnRoute = computed(() => ({ name: returnFromOverview.value ? 'ledger' : 'ledger-accounts' }))
const typeLabels = new Map(
  ledgerAccountTypeOptionsForNature('asset').concat(ledgerAccountTypeOptionsForNature('liability'))
    .map((option) => [option.value, option.label]),
)

function typeLabel(type: string): string { return typeLabels.get(type as never) ?? type }

async function load(): Promise<void> {
  const id = accountId.value
  const sequence = ++loadSequence
  loading.value = true
  actionError.value = ''
  editing.value = false
  try {
    const [nextAccount, history] = await Promise.all([
      store.getAccount(id),
      loadAccountHistory(id),
    ])
    if (sequence !== loadSequence) return
    account.value = nextAccount
    hasHistory.value = history.transactions.length > 0
    transactionCount.value = history.transactionCount
    recentTransactions.value = history.transactions
    movement.value = history.movement
  } catch (cause) {
    if (sequence !== loadSequence) return
    account.value = null
    actionError.value = ledgerErrorMessage(cause, '账户详情暂时无法加载。')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function loadAccountHistory(id: string): Promise<{
  readonly transactions: readonly LedgerTransactionDto[]
  readonly movement: LedgerMovementSummary
  readonly transactionCount: number
}> {
  const page = await store.getAccountTransactions(id, { limit: 5 })
  let transactionCount = page.transactions.length
  let cursor = page.page.nextCursor
  while (cursor) {
    const nextPage = await store.getAccountTransactions(id, { limit: 200, cursor })
    transactionCount += nextPage.transactions.length
    cursor = nextPage.page.nextCursor
  }
  return { transactions: page.transactions, movement: page.movement, transactionCount }
}

watch(accountId, () => { void load() }, { immediate: true })
onMounted(() => { void store.bootstrap() })

async function archive(): Promise<void> {
  const current = account.value
  if (!current || current.archivedAt !== null || current.currentBalanceMinor !== 0) return
  const confirmed = await confirm(
    `归档账户“${current.name}”？`,
    '归档后不会删除历史记录；如需继续记账，可以随时恢复。',
  )
  if (!confirmed) return
  actionError.value = ''
  try {
    account.value = await store.archiveAccount(current.id, current.version)
  } catch (cause) {
    actionError.value = ledgerErrorMessage(cause, '账户没有归档，请刷新后重试。')
  }
}

async function restore(): Promise<void> {
  const current = account.value
  if (!current || current.archivedAt === null) return
  actionError.value = ''
  try {
    account.value = await store.restoreAccount(current.id, current.version)
  } catch (cause) {
    actionError.value = ledgerErrorMessage(cause, '账户没有恢复，请刷新后重试。')
  }
}

function onSaved(next: LedgerAccountDto): void {
  account.value = next
  editing.value = false
}

function transactionTitle(transaction: LedgerTransactionDto): string {
  if (transaction.type === 'income' || transaction.type === 'expense') return transaction.payee || store.categories.value.find((item) => item.id === transaction.categoryId)?.name || '未分类'
  if (transaction.type === 'transfer') {
    const from = store.accounts.value.find((item) => item.id === transaction.fromAccountId)?.name ?? '未知账户'
    const to = store.accounts.value.find((item) => item.id === transaction.toAccountId)?.name ?? '未知账户'
    return `${from} → ${to}`
  }
  return '余额调整'
}

function transactionTypeLabel(type: LedgerTransactionDto['type']): string {
  if (type === 'income') return '收入'
  if (type === 'expense') return '支出'
  if (type === 'transfer') return '转账'
  return '调整'
}

function transactionAmount(transaction: LedgerTransactionDto): string {
  const currency = account.value?.currency ?? 'CNY'
  if (!Number.isSafeInteger(transaction.amountMinor)) return '—'
  if (transaction.type === 'income') return `+${formatLedgerMoney(transaction.amountMinor, currency)}`
  if (transaction.type === 'expense' || (transaction.type === 'transfer' && transaction.fromAccountId === accountId.value)) return `-${formatLedgerMoney(transaction.amountMinor, currency)}`
  return formatLedgerSignedMoney(transaction.amountMinor, currency)
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  return formatLedgerDateTime(timestamp, store.settings.value?.timezone ?? 'UTC')
}

function maskCardNumber(cardNumber: string | undefined): string {
  const value = cardNumber?.trim() ?? ''
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`
}

const netMovement = computed(() => {
  if (!movement.value) return 0
  return movement.value.balanceIncreaseMinor - movement.value.balanceDecreaseMinor
})
</script>

<template>
  <main class="ledger-page ledger-account-page" data-testid="ledger-account-page">
    <LedgerPendingCreateGate v-if="store.recoveryGateVisible.value" />

    <div v-else-if="loading" class="ledger-state-panel ledger-loading-state" data-testid="ledger-account-loading" role="status"><NSpin size="medium" description="正在加载账户…" /></div>
    <section v-else-if="!account" class="ledger-state-panel ledger-result-state" data-testid="ledger-account-error" role="alert">
      <NResult status="error" title="账户详情无法加载" :description="actionError">
        <template #footer>
          <div class="ledger-page-actions">
            <NButton class="ledger-primary-button" attr-type="button" type="primary" size="medium" :bordered="false" @click="load">重新加载</NButton>
            <RouterLink class="ledger-secondary-button" :to="{ name: 'ledger-accounts' }">返回账户</RouterLink>
          </div>
        </template>
      </NResult>
    </section>

    <NModal
      v-else-if="editing"
      :show="editing"
      :mask-closable="false"
      :close-on-esc="false"
      :auto-focus="false"
      :trap-focus="true"
      :on-esc="() => { editing = false }"
      :on-update-show="(show) => { if (!show) editing = false }"
    >
      <NCard
        class="ledger-account-edit-modal-card"
        :bordered="false"
        size="small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ledger-account-edit-title"
      >
        <LedgerAccountEditForm :account="account" :has-history="hasHistory" @saved="onSaved" @cancel="editing = false" />
      </NCard>
    </NModal>

    <section v-else class="ledger-account-detail" aria-labelledby="ledger-account-detail-title">
      <header class="ledger-detail-header">
        <div class="ledger-account-identity">
          <span class="ledger-detail-account-icon" :class="account.nature === 'asset' ? 'is-asset' : 'is-liability'" aria-hidden="true"><LedgerAccountIcon :icon="account.icon" :size="34" /></span>
          <div>
          <h1 id="ledger-account-detail-title">{{ account.name }}</h1>
          <p>{{ account.nature === 'asset' ? '资产' : '负债' }} · {{ typeLabel(account.type) }} · {{ account.currency }}</p>
          </div>
        </div>
        <div class="ledger-page-actions">
          <RouterLink class="ledger-secondary-button ledger-return-button" :to="returnRoute">{{ returnLabel }}</RouterLink>
          <span class="ledger-action-trigger"><NButton class="ledger-secondary-button" attr-type="button" size="small" :bordered="false" @click="editing = true">编辑账户</NButton></span>
          <NTooltip v-if="account.archivedAt === null && account.currentBalanceMinor !== 0" placement="bottom">
            <template #trigger>
              <span class="ledger-action-trigger"><NButton class="ledger-secondary-button" attr-type="button" size="small" :bordered="false" disabled>归档账户</NButton></span>
            </template>
            当前余额需调整为 0 后才能归档账户。
          </NTooltip>
          <span v-else-if="account.archivedAt === null" class="ledger-action-trigger"><NButton class="ledger-secondary-button" attr-type="button" size="small" :bordered="false" @click="archive">归档账户</NButton></span>
          <span v-else class="ledger-action-trigger"><NButton class="ledger-primary-button" attr-type="button" type="primary" size="small" :bordered="false" @click="restore">恢复账户</NButton></span>
        </div>
      </header>

      <NAlert v-if="actionError" class="ledger-form-error" type="error" :show-icon="false" role="alert">{{ actionError }}</NAlert>
      <div class="ledger-summary-grid">
        <NCard class="ledger-detail-card" :bordered="false" size="small"><NStatistic label="当前余额" tabular-nums><LedgerAnimatedMoney :minor="account.currentBalanceMinor" :currency="account.currency" /></NStatistic><p class="ledger-section-description">该账户的最新余额。</p></NCard>
        <NCard class="ledger-detail-card" :bordered="false" size="small"><NStatistic label="交易笔数" :value="transactionCount"><template #suffix>笔</template></NStatistic><p class="ledger-section-description">该账户关联的历史交易总数。</p></NCard>
        <NCard class="ledger-detail-card" :bordered="false" size="small"><span class="ledger-summary-label">当前状态</span><strong class="ledger-summary-value" :class="{ 'is-positive': account.archivedAt === null }">{{ account.archivedAt === null ? '可用' : '已归档' }}</strong><p class="ledger-section-description">{{ account.archivedAt === null ? '可用于新增交易。' : '历史记录仍然保留。' }}</p></NCard>
        <NCard class="ledger-detail-card" :bordered="false" size="small"><span class="ledger-summary-label">本月净变动</span><strong class="ledger-summary-value" :class="netMovement < 0 ? 'is-negative' : 'is-positive'">{{ formatLedgerSignedMoney(netMovement, account.currency) }}</strong><p class="ledger-section-description">本月余额增加与减少的差额。</p></NCard>
      </div>
      <NCard class="ledger-detail-movement" :bordered="false" size="small" data-testid="ledger-account-movement" aria-labelledby="ledger-account-movement-title">
        <div class="ledger-section-heading">
          <h2 id="ledger-account-movement-title">本月资金变化</h2>
        </div>
        <p class="ledger-section-description">本月该账户的资金变化情况。</p>
        <div v-if="movement" class="ledger-movement-grid">
          <div>
            <span>{{ account.nature === 'asset' ? '流入' : '新增负债' }}</span>
            <strong><LedgerAnimatedMoney :minor="movement.balanceIncreaseMinor" :currency="account.currency" /></strong>
          </div>
          <div>
            <span>{{ account.nature === 'asset' ? '流出' : '减少负债' }}</span>
            <strong><LedgerAnimatedMoney :minor="movement.balanceDecreaseMinor" :currency="account.currency" /></strong>
          </div>
          <div><span>净变动</span><strong :class="{ 'is-negative': netMovement < 0 }">{{ formatLedgerSignedMoney(netMovement, account.currency) }}</strong></div>
        </div>
      </NCard>
      <div class="ledger-detail-grid">
      <div class="ledger-detail-main-column">
      <NCard class="ledger-detail-card ledger-recent-transactions" :bordered="false" size="small" aria-labelledby="ledger-recent-title">
        <div class="ledger-section-heading"><h2 id="ledger-recent-title">最近交易</h2><RouterLink :to="{ name: 'ledger-transactions', query: { accountId: account.id } }">查看全部 →</RouterLink></div>
        <p class="ledger-section-description">该账户的最近 5 笔交易记录。</p>
        <div v-if="recentTransactions.length" class="ledger-recent-list">
          <div v-for="transaction in recentTransactions" :key="transaction.id" class="ledger-recent-row">
            <i class="ledger-transaction-symbol" :class="`is-${transaction.type}`" aria-hidden="true">{{ transaction.type === 'income' ? '↑' : transaction.type === 'expense' ? '↓' : transaction.type === 'transfer' ? '→' : '≈' }}</i>
            <span><strong>{{ transactionTitle(transaction) }}</strong><small>{{ formatTimestamp(transaction.occurredAt) }} · {{ transactionTypeLabel(transaction.type) }}</small></span>
            <strong :class="[`is-${transaction.type}`]">{{ transactionAmount(transaction) }}</strong>
          </div>
        </div>
        <p v-else class="ledger-empty-copy">暂无交易记录</p>
      </NCard>
      </div>
      <aside class="ledger-detail-side-column">
      <NCard class="ledger-detail-card ledger-account-info" :bordered="false" size="small" aria-labelledby="ledger-account-info-title">
        <h2 id="ledger-account-info-title">账户信息</h2>
        <dl>
          <div><dt>账户类型</dt><dd>{{ typeLabel(account.type) }}</dd></div><div><dt>账户性质</dt><dd>{{ account.nature === 'asset' ? '资产' : '负债' }}</dd></div><div><dt>币种</dt><dd>{{ account.currency }}</dd></div>
          <div><dt>期初余额</dt><dd>{{ formatLedgerMoney(account.openingBalanceMinor, account.currency) }}</dd></div><div><dt>开户日期</dt><dd>{{ account.openingDate }}</dd></div>
          <div v-if="account.cardNumber"><dt>卡号</dt><dd>{{ maskCardNumber(account.cardNumber) }}</dd></div>
          <div><dt>创建时间</dt><dd>{{ formatTimestamp(account.createdAt) }}</dd></div><div><dt>最后更新</dt><dd>{{ formatTimestamp(account.updatedAt) }}</dd></div>
        </dl>
      </NCard>
      <NCard class="ledger-detail-note" :bordered="false" size="small" aria-labelledby="ledger-account-note-title">
        <h2 id="ledger-account-note-title">备注</h2>
        <p>{{ account.note || '暂无备注' }}</p>
      </NCard>
      </aside>
      </div>
    </section>
  </main>
</template>

<style scoped>
.ledger-page { min-height: calc(100vh - 52px); background: var(--bg); }
.ledger-account-page { width: min(100%, 1240px); margin: 0 auto; padding: 30px 28px 64px; box-sizing: border-box; }
.ledger-detail-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 26px; margin-bottom: 24px; }
.ledger-account-identity { display: flex; align-items: center; gap: 15px; min-width: 0; }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-detail-header h1 { margin: 0; color: var(--text-h); font-size: 2rem; line-height: 1.2; }
.ledger-detail-header p:not(.ledger-eyebrow) { margin: 8px 0 0; color: var(--text-muted); font-size: .84rem; }
.ledger-account-identity .ledger-account-status { display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--text-muted); font-size: .76rem; }
.ledger-account-status i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.ledger-page-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.ledger-detail-header .ledger-page-actions .ledger-secondary-button,
.ledger-detail-header .ledger-page-actions .ledger-primary-button { min-height: 32px; padding: 6px 12px; font-size: .78rem; }
.ledger-detail-header .ledger-page-actions { gap: 9px; }
.ledger-account-edit-modal-card {
  width: min(620px, calc(100vw - 32px));
  max-height: min(90vh, 760px);
  overflow: auto;
  scrollbar-width: none;
  border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
  border-radius: 16px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 3%, transparent), transparent 52%),
    color-mix(in srgb, var(--bg-soft) 82%, transparent);
  box-shadow: 0 18px 55px color-mix(in srgb, var(--text-h) 20%, transparent), inset 0 1px 0 color-mix(in srgb, var(--text-h) 9%, transparent);
  -webkit-backdrop-filter: saturate(145%) blur(18px);
  backdrop-filter: saturate(145%) blur(18px);
}
.ledger-account-edit-modal-card::-webkit-scrollbar { display: none; }
.ledger-account-edit-modal-card :deep(.n-card__content) { padding: 28px; }
.ledger-account-edit-modal-card :deep(.ledger-account-edit-form) { width: 100%; padding: 0; border: 0; background: transparent; }
.ledger-primary-button,
.ledger-secondary-button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; box-sizing: border-box; padding: 7px 13px; border-radius: 7px; font: inherit; font-size: .84rem; font-weight: 650; text-decoration: none; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-return-button { min-height: 32px; padding: 6px 12px; color: var(--text-h); font-size: .78rem; }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
.ledger-form-error { margin: 0 0 14px; color: #b42318; font-size: .82rem; }
.ledger-form-error :deep(.n-alert-body) { color: #b42318; }
.ledger-action-trigger { display: inline-flex; margin: 0; padding: 0; }
.ledger-detail-account-icon { display: grid; flex: 0 0 auto; width: 58px; height: 58px; place-items: center; border-radius: 15px; background: color-mix(in srgb, var(--accent) 11%, var(--bg)); color: var(--accent); }
.ledger-detail-account-icon.is-liability { background: color-mix(in srgb, var(--ledger-expense, #dc3f4d) 11%, var(--bg)); color: var(--ledger-expense, #dc3f4d); }
.ledger-account-hero-balance { min-width: 190px; text-align: right; }
.ledger-account-hero-balance :deep(.n-statistic-label) { color: var(--text-muted); font-size: .78rem; }
.ledger-account-hero-balance :deep(.n-statistic-value) { color: var(--text-h); font-size: 2.15rem; font-weight: 700; }
.ledger-detail-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr); gap: 16px; align-items: stretch; }
.ledger-detail-main-column, .ledger-detail-side-column { display: grid; gap: 16px; min-width: 0; align-content: start; }
.ledger-detail-side-column { grid-template-rows: auto minmax(0, 1fr); }
.ledger-detail-card, .ledger-detail-movement { box-sizing: border-box; border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--bg-soft) 86%, transparent); }
.ledger-detail-card :deep(.n-card__content), .ledger-detail-movement :deep(.n-card__content) { padding: 20px; box-sizing: border-box; }
.ledger-detail-movement { margin: 0 0 16px; }
.ledger-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.ledger-section-heading h2 { margin: 0; color: var(--text-h); font-size: .98rem; }
.ledger-section-heading a { color: var(--accent); font-size: .78rem; text-decoration: none; }
.ledger-movement-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.ledger-movement-grid > div { display: grid; gap: 7px; }
.ledger-movement-grid span { color: var(--text-muted); font-size: .76rem; }
.ledger-movement-grid strong { color: var(--text-h); font-size: 1rem; }
.ledger-movement-grid strong.is-negative, .ledger-recent-row strong.is-expense { color: var(--ledger-expense, #dc3f4d); }
.ledger-recent-transactions { min-height: 250px; }
.ledger-recent-list { display: grid; }
.ledger-recent-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent); }
.ledger-recent-row > span { display: grid; gap: 4px; min-width: 0; }
.ledger-recent-row strong { color: var(--text-h); font-size: .86rem; }
.ledger-recent-row small { overflow: hidden; color: var(--text-muted); font-size: .74rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-recent-row > strong { flex: 0 0 auto; }
.ledger-recent-row strong.is-income { color: var(--docus-positive, #15803d); }
.ledger-empty-copy { margin: 34px 0; color: var(--text-muted); font-size: .82rem; text-align: center; }
.ledger-account-info h2 { margin: 0 0 17px; color: var(--text-h); font-size: .98rem; }
.ledger-account-info dl { display: grid; gap: 12px; margin: 0; }
.ledger-account-info dl div { display: flex; justify-content: space-between; gap: 12px; font-size: .78rem; }
.ledger-account-info dt { color: var(--text-muted); }
.ledger-account-info dd { margin: 0; color: var(--text-h); text-align: right; }
.ledger-detail-note { margin: 0; }
.ledger-detail-note :deep(.n-card__content) { padding: 20px; }
.ledger-detail-note h2 { margin: 0 0 7px; color: var(--text-h); font-size: .95rem; }
.ledger-detail-note p { margin: 0; color: var(--text-muted); font-size: .84rem; white-space: pre-wrap; }
.ledger-state-panel { display: grid; min-height: 300px; align-content: center; gap: 10px; color: var(--text-muted); }
.ledger-loading-state { place-items: center; text-align: center; }
.ledger-result-state { place-items: center start; text-align: left; }
.ledger-loading-state :deep(.n-spin-container) { display: grid; place-items: center; }
.ledger-result-state :deep(.n-result) { display: grid; place-items: center start; width: min(100%, 620px); padding: 0; text-align: left; }
.ledger-result-state :deep(.n-result-header__title),
.ledger-result-state :deep(.n-result-header__description),
.ledger-result-state :deep(.n-result-footer) { text-align: left; }
.ledger-state-panel h1,
.ledger-state-panel p { margin: 0; }
.ledger-state-panel h1 { color: var(--text-h); font-size: 1.35rem; }
.ledger-state-panel :deep(.n-result-header__title) { color: var(--text-h); }
.ledger-state-panel :deep(.n-result-footer) { margin-top: 18px; }
.ledger-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.ledger-summary-grid :deep(.n-statistic-value), .ledger-summary-value { display: block; margin-top: 8px; font-size: 1.55rem; line-height: 1.4; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ledger-summary-label { color: var(--text-muted); font-size: .88rem; }
.ledger-section-description { margin: 6px 0 12px; color: var(--text-muted); font-size: .78rem; }
.ledger-summary-grid .ledger-section-description { margin: 8px 0 0; }
.ledger-section-heading { margin-bottom: 4px; }
.ledger-detail-card :deep(.n-card__content), .ledger-detail-movement :deep(.n-card__content), .ledger-detail-note :deep(.n-card__content) { padding: 16px; }
.ledger-movement-grid { padding: 14px; border-radius: 8px; background: var(--bg); }
.ledger-movement-grid > div + div { padding-left: 18px; border-left: 1px solid var(--border); }
.ledger-movement-grid > div:last-child strong, .is-positive { color: var(--docus-positive, #15803d); }
.ledger-movement-grid > div:last-child strong.is-negative, .is-negative { color: var(--ledger-expense, #dc3f4d); }
.ledger-recent-list { padding: 0 12px; border-radius: 8px; background: var(--bg); }
.ledger-recent-row { gap: 12px; padding: 10px 0; }
.ledger-recent-row:first-child { border-top: 0; }
.ledger-recent-row > span { flex: 1; overflow-wrap: anywhere; }
.ledger-transaction-symbol { flex: 0 0 30px; height: 30px; display: grid; place-items: center; border-radius: 9px; font-size: 1.2rem; font-style: normal; color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.ledger-transaction-symbol.is-income { color: var(--docus-positive, #15803d); background: color-mix(in srgb, var(--docus-positive, #15803d) 10%, transparent); }
.ledger-transaction-symbol.is-expense { color: var(--ledger-expense, #dc3f4d); background: color-mix(in srgb, var(--ledger-expense, #dc3f4d) 10%, transparent); }
.ledger-account-info dl { gap: 0; }
.ledger-account-info dl div { padding: 6px 0; border-bottom: 1px solid var(--border); }
.ledger-account-info dl div:last-child { border-bottom: 0; }
.ledger-detail-note { min-height: 0; box-sizing: border-box; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-soft); }
.ledger-detail-header h1, .ledger-account-info dd, .ledger-detail-note p { overflow-wrap: anywhere; }
.ledger-detail-note p { text-align: left; }
@media (max-width: 900px) {
  .ledger-detail-grid { grid-template-columns: 1fr; }
  .ledger-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 650px) {
  .ledger-summary-grid { grid-template-columns: 1fr; }
  .ledger-movement-grid > div + div { padding: 12px 0 0; border-left: 0; border-top: 1px solid var(--border); }
  .ledger-account-page { padding: 24px 16px 48px; }
  .ledger-detail-header { grid-template-columns: 1fr; align-items: stretch; gap: 16px; }
  .ledger-account-hero-balance { text-align: left; }
  .ledger-account-hero-balance :deep(.n-statistic-value) { font-size: 1.85rem; }
  .ledger-page-actions > * { flex: 1 1 150px; }
  .ledger-detail-grid, .ledger-movement-grid { grid-template-columns: 1fr; }
  .ledger-detail-movement :deep(.n-card__content) { padding: 16px 13px; }
  .ledger-account-edit-modal-card { width: calc(100vw - 24px); max-height: 92vh; }
  .ledger-account-edit-modal-card :deep(.n-card__content) { padding: 21px 17px; }
}
</style>
