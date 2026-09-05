<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useConfirm } from '../composables/useConfirm'
import LedgerAccountEditForm from '../components/ledger/LedgerAccountEditForm.vue'
import LedgerPendingCreateGate from '../components/ledger/LedgerPendingCreateGate.vue'
import { ledgerAccountTypeOptionsForNature } from '../features/ledger/accountPresentation'
import { ledgerErrorMessage } from '../features/ledger/ledgerErrors'
import { formatLedgerMoney } from '../features/ledger/money'
import { useLedgerStore } from '../features/ledger/ledgerStore'
import type { LedgerAccountDto, LedgerMovementSummary } from '../../shared/ledgerProtocol'

const route = useRoute()
const store = useLedgerStore()
const { confirm } = useConfirm()

const account = ref<LedgerAccountDto | null>(null)
const hasHistory = ref(false)
const movement = ref<LedgerMovementSummary | null>(null)
const loading = ref(false)
const editing = ref(false)
const actionError = ref('')
let loadSequence = 0

const accountId = computed(() => String(route.params.id ?? ''))
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
      store.getAccountTransactions(id, { includeDeleted: true, limit: 1 }),
    ])
    if (sequence !== loadSequence) return
    account.value = nextAccount
    hasHistory.value = history.transactions.length > 0
    movement.value = history.movement
  } catch (cause) {
    if (sequence !== loadSequence) return
    account.value = null
    actionError.value = ledgerErrorMessage(cause, '账户详情暂时无法加载。')
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
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
</script>

<template>
  <main class="ledger-page ledger-account-page" data-testid="ledger-account-page">
    <div class="ledger-detail-nav">
      <RouterLink :to="{ name: 'ledger-accounts' }">← 返回账户</RouterLink>
    </div>

    <LedgerPendingCreateGate v-if="store.recoveryGateVisible.value" />

    <div v-else-if="loading" class="ledger-state-panel" data-testid="ledger-account-loading" role="status">正在加载账户…</div>
    <section v-else-if="!account" class="ledger-state-panel" data-testid="ledger-account-error" role="alert">
      <h1>账户详情无法加载</h1>
      <p>{{ actionError }}</p>
      <div class="ledger-page-actions">
        <button class="ledger-primary-button" type="button" @click="load">重新加载</button>
        <RouterLink class="ledger-secondary-button" :to="{ name: 'ledger-accounts' }">返回账户</RouterLink>
      </div>
    </section>

    <template v-else-if="editing">
      <LedgerAccountEditForm :account="account" :has-history="hasHistory" @saved="onSaved" @cancel="editing = false" />
    </template>

    <section v-else class="ledger-account-detail" aria-labelledby="ledger-account-detail-title">
      <header class="ledger-detail-header">
        <div>
          <p class="ledger-eyebrow">{{ account.archivedAt === null ? '可用账户' : '已归档账户' }}</p>
          <h1 id="ledger-account-detail-title">{{ account.name }}</h1>
          <p>{{ account.nature === 'asset' ? '资产' : '负债' }} · {{ typeLabel(account.type) }} · {{ account.currency }}</p>
        </div>
        <div class="ledger-page-actions">
          <button class="ledger-secondary-button" type="button" @click="editing = true">编辑账户</button>
          <button v-if="account.archivedAt === null" class="ledger-secondary-button" type="button" :disabled="account.currentBalanceMinor !== 0" @click="archive">归档账户</button>
          <button v-else class="ledger-primary-button" type="button" @click="restore">恢复账户</button>
        </div>
      </header>

      <p v-if="actionError" class="ledger-form-error" role="alert">{{ actionError }}</p>
      <p v-if="account.archivedAt === null && account.currentBalanceMinor !== 0" class="ledger-action-help">
        当前余额为 {{ formatLedgerMoney(account.currentBalanceMinor, account.currency) }}；归档前需要先把余额调整为 0。
      </p>

      <div class="ledger-detail-grid">
        <article class="ledger-detail-card ledger-detail-balance">
          <span>当前余额</span>
          <strong>{{ formatLedgerMoney(account.currentBalanceMinor, account.currency) }}</strong>
          <small>{{ account.archivedAt === null ? '来自 Ledger 服务端账户投影' : '已归档，不会出现在新交易账户选择器中' }}</small>
        </article>
        <article class="ledger-detail-card">
          <span>期初余额</span>
          <strong>{{ formatLedgerMoney(account.openingBalanceMinor, account.currency) }}</strong>
          <small>期初日期：{{ account.openingDate }}</small>
        </article>
        <article class="ledger-detail-card">
          <span>历史记录</span>
          <strong>{{ hasHistory ? '已有记录' : '尚无记录' }}</strong>
          <small>{{ hasHistory ? '有历史后，财务解释字段会保持只读。' : '尚无历史时可以调整期初解释。' }}</small>
        </article>
      </div>

      <section class="ledger-detail-movement" data-testid="ledger-account-movement" aria-labelledby="ledger-account-movement-title">
        <div class="ledger-section-heading">
          <div>
            <h2 id="ledger-account-movement-title">本月变动</h2>
            <p>金额来自该账户的服务端 movement projection。</p>
          </div>
        </div>
        <div v-if="movement" class="ledger-movement-grid">
          <div>
            <span>{{ account.nature === 'asset' ? '流入' : '新增负债' }}</span>
            <strong>{{ formatLedgerMoney(movement.balanceIncreaseMinor, account.currency) }}</strong>
          </div>
          <div>
            <span>{{ account.nature === 'asset' ? '流出' : '减少负债' }}</span>
            <strong>{{ formatLedgerMoney(movement.balanceDecreaseMinor, account.currency) }}</strong>
          </div>
        </div>
      </section>

      <RouterLink class="ledger-account-history-link" :to="{ name: 'ledger-transactions', query: { accountId: account.id } }">
        查看该账户全部交易
      </RouterLink>

      <section class="ledger-detail-note" aria-labelledby="ledger-account-note-title">
        <h2 id="ledger-account-note-title">备注</h2>
        <p>{{ account.note || '暂无备注' }}</p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.ledger-page { min-height: calc(100vh - 52px); background: var(--bg); }
.ledger-account-page { width: min(100%, 1080px); margin: 0 auto; padding: 30px 28px 64px; box-sizing: border-box; }
.ledger-detail-nav { margin-bottom: 24px; font-size: .82rem; }
.ledger-detail-nav a { color: var(--text-muted); text-decoration: none; }
.ledger-detail-nav a:hover { color: var(--accent); }
.ledger-detail-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; margin-bottom: 24px; }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-detail-header h1 { margin: 0; color: var(--text-h); font-size: 2rem; line-height: 1.2; }
.ledger-detail-header p:not(.ledger-eyebrow) { margin: 8px 0 0; color: var(--text-muted); font-size: .84rem; }
.ledger-page-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.ledger-primary-button,
.ledger-secondary-button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; box-sizing: border-box; padding: 7px 13px; border-radius: 7px; font: inherit; font-size: .84rem; font-weight: 650; text-decoration: none; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
.ledger-form-error { margin: 0 0 14px; color: #b42318; font-size: .82rem; }
.ledger-action-help { margin: 0 0 14px; color: var(--text-muted); font-size: .82rem; }
.ledger-detail-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.ledger-detail-card { display: grid; gap: 7px; min-height: 130px; padding: 18px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-soft); }
.ledger-detail-card span { color: var(--text-muted); font-size: .78rem; }
.ledger-detail-card strong { color: var(--text-h); font-size: 1.22rem; }
.ledger-detail-card small { color: var(--text-muted); font-size: .75rem; line-height: 1.45; }
.ledger-detail-movement { margin-top: 22px; padding: 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-soft); }
.ledger-section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 13px; }
.ledger-section-heading h2 { margin: 0; color: var(--text-h); font-size: .98rem; }
.ledger-section-heading p { margin: 5px 0 0; color: var(--text-muted); font-size: .76rem; }
.ledger-movement-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ledger-movement-grid > div { display: grid; gap: 6px; padding: 12px; border-radius: 8px; background: var(--bg); }
.ledger-movement-grid span { color: var(--text-muted); font-size: .76rem; }
.ledger-movement-grid strong { color: var(--text-h); font-size: 1rem; }
.ledger-account-history-link { display: inline-flex; margin-top: 18px; color: var(--accent); font-size: .82rem; text-decoration: none; }
.ledger-account-history-link:hover { text-decoration: underline; }
.ledger-detail-note { margin-top: 22px; padding: 18px; border-top: 1px solid var(--border); }
.ledger-detail-note h2 { margin: 0 0 7px; color: var(--text-h); font-size: .95rem; }
.ledger-detail-note p { margin: 0; color: var(--text-muted); font-size: .84rem; white-space: pre-wrap; }
.ledger-state-panel { display: grid; min-height: 300px; place-items: center; align-content: center; gap: 10px; color: var(--text-muted); text-align: center; }
.ledger-state-panel h1,
.ledger-state-panel p { margin: 0; }
.ledger-state-panel h1 { color: var(--text-h); font-size: 1.35rem; }
@media (max-width: 720px) {
  .ledger-account-page { padding: 24px 16px 48px; }
  .ledger-detail-header { align-items: stretch; flex-direction: column; }
  .ledger-page-actions > * { flex: 1 1 150px; }
  .ledger-detail-grid { grid-template-columns: 1fr; }
  .ledger-movement-grid { grid-template-columns: 1fr; }
}
</style>
