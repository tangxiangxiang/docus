<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { LedgerTransactionDto } from '../../../shared/ledgerProtocol'
import { useConfirm } from '../../composables/useConfirm'
import { useFocusTrap } from '../../composables/useFocusTrap'
import { useToast } from '../../composables/useToast'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { formatLedgerMoney } from '../../features/ledger/money'
import { formatLedgerDateTime } from '../../features/ledger/time'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import LedgerTransactionEditForm from './LedgerTransactionEditForm.vue'

const props = defineProps<{
  open: boolean
  transaction: LedgerTransactionDto | null
}>()
const emit = defineEmits<{
  close: []
  updated: [transaction: LedgerTransactionDto]
  deleted: [transaction: LedgerTransactionDto]
}>()

const store = useLedgerStore()
const toast = useToast()
const { confirm } = useConfirm()
const trap = useFocusTrap()
const dialogRef = ref<HTMLElement | null>(null)
const currentTransaction = ref<LedgerTransactionDto | null>(null)
const editing = ref(false)
const actionError = ref('')
const restoringId = ref<string | null>(null)

const transaction = computed(() => currentTransaction.value ?? props.transaction)
const associatedAccounts = computed(() => {
  const value = transaction.value
  if (!value) return []
  const ids = value.type === 'transfer'
    ? [value.fromAccountId, value.toAccountId]
    : [value.accountId]
  return store.accounts.value.filter((account) => ids.includes(account.id))
})
const archivedAccounts = computed(() => associatedAccounts.value.filter((account) => account.archivedAt !== null))
const ordinaryTransaction = computed(() => transaction.value !== null && transaction.value.type !== 'adjustment')
const deleted = computed(() => transaction.value?.deletedAt !== null)
const canEdit = computed(() => ordinaryTransaction.value && !deleted.value)
const canDelete = computed(() => canEdit.value && archivedAccounts.value.length === 0)

function accountName(id: string): string {
  return store.accounts.value.find((account) => account.id === id)?.name ?? '未知账户'
}

function categoryName(id: string): string {
  return store.categories.value.find((category) => category.id === id)?.name ?? '未知分类'
}

function typeLabel(type: string): string {
  if (type === 'income') return '收入'
  if (type === 'expense') return '支出'
  if (type === 'transfer') return '转账'
  return '余额调整'
}

function amountLabel(value: LedgerTransactionDto): string {
  const currency = store.settings.value?.baseCurrency ?? 'CNY'
  if (value.type === 'income') return `+${formatLedgerMoney(value.amountMinor, currency)}`
  if (value.type === 'expense') return `-${formatLedgerMoney(value.amountMinor, currency)}`
  if (value.type === 'transfer') return formatLedgerMoney(value.amountMinor, currency)
  return formatLedgerMoney(value.amountMinor, currency)
}

watch(() => props.transaction, (value) => {
  currentTransaction.value = value
  editing.value = false
  actionError.value = ''
}, { immediate: true })

watch(() => props.open, async (open) => {
  if (open) {
    editing.value = false
    actionError.value = ''
    trap.activate()
    await nextTick()
    dialogRef.value?.focus()
  } else {
    void trap.deactivate()
  }
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  } else if (event.key === 'Tab') {
    trap.onTab(() => dialogRef.value, event)
  }
}

async function restoreAccount(id: string): Promise<void> {
  const current = transaction.value
  const account = store.accounts.value.find((item) => item.id === id)
  if (!current || !account || restoringId.value) return
  restoringId.value = id
  actionError.value = ''
  try {
    await store.restoreAccount(id, account.version)
    const refreshed = await store.getTransaction(current.id)
    currentTransaction.value = refreshed
    emit('updated', refreshed)
    toast.success('账户已恢复，交易信息已刷新')
  } catch (cause) {
    actionError.value = ledgerErrorMessage(cause, '账户没有恢复，请刷新后重试。')
  } finally {
    restoringId.value = null
  }
}

function onSaved(updated: LedgerTransactionDto): void {
  currentTransaction.value = updated
  editing.value = false
  emit('updated', updated)
  toast.success('交易已更新')
}

async function remove(): Promise<void> {
  const current = transaction.value
  if (!current || !canDelete.value || restoringId.value) return
  const confirmed = await confirm('删除这笔交易？', '删除记录会影响账户余额和相关汇总；本次操作不会提供恢复入口。', {
    destructive: true,
    confirmLabel: '删除记录',
  })
  if (!confirmed) return
  actionError.value = ''
  try {
    const deletedTransaction = await store.deleteTransaction(current.id, current.version)
    toast.success('交易已删除')
    emit('deleted', deletedTransaction)
    emit('close')
  } catch (cause) {
    actionError.value = ledgerErrorMessage(cause, '交易没有删除，请刷新后重试。')
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open && transaction" class="ledger-sheet-backdrop" @click.self="emit('close')">
      <section ref="dialogRef" class="ledger-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="ledger-transaction-detail-title" tabindex="-1" @keydown="onKeydown">
        <header class="ledger-sheet-header">
          <div>
            <p class="ledger-eyebrow">交易详情</p>
            <h2 id="ledger-transaction-detail-title">{{ typeLabel(transaction.type) }}</h2>
          </div>
          <button class="ledger-close-button" type="button" aria-label="关闭交易详情" @click="emit('close')">×</button>
        </header>

        <LedgerTransactionEditForm v-if="editing && canEdit" :transaction="transaction" @saved="onSaved" @cancel="editing = false" />
        <template v-else>
          <div class="ledger-transaction-hero">
            <span>金额</span>
            <strong :class="`is-${transaction.type}`">{{ amountLabel(transaction) }}</strong>
            <small>{{ formatLedgerDateTime(transaction.occurredAt, store.settings.value?.timezone ?? 'UTC') }}</small>
          </div>

          <dl class="ledger-detail-list">
            <template v-if="transaction.type === 'income' || transaction.type === 'expense'">
              <div><dt>账户</dt><dd>{{ accountName(transaction.accountId) }}<em v-if="associatedAccounts.some((account) => account.archivedAt !== null)">（已归档）</em></dd></div>
              <div><dt>分类</dt><dd>{{ categoryName(transaction.categoryId) }}</dd></div>
              <div><dt>交易对象</dt><dd>{{ transaction.payee || '未填写' }}</dd></div>
            </template>
            <template v-else-if="transaction.type === 'transfer'">
              <div><dt>转出账户</dt><dd>{{ accountName(transaction.fromAccountId) }}</dd></div>
              <div><dt>转入账户</dt><dd>{{ accountName(transaction.toAccountId) }}</dd></div>
            </template>
            <template v-else>
              <div><dt>账户</dt><dd>{{ accountName(transaction.accountId) }}</dd></div>
              <div><dt>状态</dt><dd>余额调整由账户调整流程维护</dd></div>
            </template>
            <div><dt>备注</dt><dd>{{ transaction.note || '未填写' }}</dd></div>
          </dl>

          <section v-if="archivedAccounts.length" class="ledger-archived-warning" aria-labelledby="ledger-archived-warning-title">
            <h3 id="ledger-archived-warning-title">关联账户已归档</h3>
            <p>历史记录仍可查看。恢复账户后，才能修改交易的财务字段或删除这笔记录。</p>
            <div v-for="account in archivedAccounts" :key="account.id" class="ledger-restore-row">
              <span>{{ account.name }}（已归档）</span>
              <button class="ledger-secondary-button" type="button" :disabled="Boolean(restoringId)" @click="restoreAccount(account.id)">{{ restoringId === account.id ? '正在恢复…' : '恢复账户' }}</button>
            </div>
          </section>

          <p v-if="transaction.type === 'adjustment'" class="ledger-form-info">余额调整为只读记录，不能通过普通交易编辑或删除。</p>
          <p v-if="actionError" class="ledger-form-error" role="alert">{{ actionError }}</p>
          <div class="ledger-form-actions">
            <button v-if="canEdit" class="ledger-secondary-button" type="button" :disabled="Boolean(restoringId)" @click="editing = true">编辑交易</button>
            <button v-if="canDelete" class="ledger-danger-button" type="button" :disabled="Boolean(restoringId)" @click="remove">删除记录</button>
            <button v-else-if="canEdit && archivedAccounts.length" class="ledger-secondary-button" type="button" disabled>恢复账户后可删除</button>
            <button class="ledger-primary-button" type="button" @click="emit('close')">完成</button>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ledger-sheet-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; justify-content: center; padding: 20px; box-sizing: border-box; background: color-mix(in srgb, #0f172a 35%, transparent); }
.ledger-detail-sheet { display: grid; gap: 18px; width: min(100%, 620px); max-height: min(92vh, 820px); overflow: auto; padding: 24px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 16px 16px 10px 10px; background: var(--bg); color: var(--text); box-shadow: 0 20px 60px color-mix(in srgb, #0f172a 28%, transparent); }
.ledger-sheet-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ledger-eyebrow { margin: 0 0 5px; color: var(--accent); font-size: .72rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.ledger-sheet-header h2 { margin: 0; color: var(--text-h); font-size: 1.35rem; }
.ledger-close-button { width: 32px; height: 32px; padding: 0; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text-muted); font-size: 1.3rem; line-height: 1; cursor: pointer; }
.ledger-close-button:hover { border-color: var(--accent); color: var(--accent); }
.ledger-transaction-hero { display: grid; gap: 6px; padding: 16px; border-radius: 9px; background: var(--bg-soft); }
.ledger-transaction-hero span { color: var(--text-muted); font-size: .76rem; }
.ledger-transaction-hero strong { color: var(--text-h); font-size: 1.5rem; }
.ledger-transaction-hero strong.is-income { color: #18794e; }
.ledger-transaction-hero strong.is-expense { color: #b42318; }
.ledger-transaction-hero small { color: var(--text-muted); font-size: .75rem; }
.ledger-detail-list { display: grid; gap: 0; margin: 0; }
.ledger-detail-list > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border); font-size: .82rem; }
.ledger-detail-list dt { color: var(--text-muted); }
.ledger-detail-list dd { margin: 0; color: var(--text-h); white-space: pre-wrap; }
.ledger-detail-list em { color: var(--text-muted); font-style: normal; }
.ledger-archived-warning { display: grid; gap: 9px; padding: 13px; border: 1px solid color-mix(in srgb, #b7791f 35%, var(--border)); border-radius: 9px; background: color-mix(in srgb, #f6ad55 8%, var(--bg)); }
.ledger-archived-warning h3,
.ledger-archived-warning p { margin: 0; }
.ledger-archived-warning h3 { color: var(--text-h); font-size: .85rem; }
.ledger-archived-warning p { color: var(--text-muted); font-size: .77rem; line-height: 1.45; }
.ledger-restore-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--text); font-size: .8rem; }
.ledger-form-info { margin: 0; color: var(--text-muted); font-size: .79rem; line-height: 1.45; }
.ledger-form-error { margin: 0; color: #b42318; font-size: .81rem; }
.ledger-form-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 9px; }
.ledger-primary-button,
.ledger-secondary-button,
.ledger-danger-button { min-height: 39px; padding: 7px 14px; border-radius: 7px; font: inherit; font-size: .83rem; font-weight: 650; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-danger-button { border: 1px solid color-mix(in srgb, #b42318 55%, var(--border)); background: transparent; color: #b42318; }
.ledger-danger-button:hover:not(:disabled) { background: color-mix(in srgb, #b42318 8%, transparent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled,
.ledger-danger-button:disabled { cursor: wait; opacity: .65; }
@media (max-width: 600px) {
  .ledger-sheet-backdrop { align-items: stretch; padding: 0; }
  .ledger-detail-sheet { width: 100%; max-height: 100%; border-radius: 0; }
  .ledger-form-actions > * { flex: 1 1 135px; }
}
</style>

