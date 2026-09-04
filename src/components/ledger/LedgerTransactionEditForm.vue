<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LedgerTransactionDto } from '../../../shared/ledgerProtocol'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { ledgerDecimalFromMinor, parseLedgerMoney } from '../../features/ledger/money'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import { instantFromLocalDateTime, localDateTimeInputFromInstant } from '../../features/ledger/time'

const props = withDefaults(defineProps<{
  transaction: LedgerTransactionDto
  cancelable?: boolean
}>(), { cancelable: true })

const emit = defineEmits<{ saved: [transaction: LedgerTransactionDto]; cancel: [] }>()
const store = useLedgerStore()

const amount = ref('')
const accountId = ref('')
const categoryId = ref('')
const fromAccountId = ref('')
const toAccountId = ref('')
const occurredAt = ref('')
const payee = ref('')
const note = ref('')
const error = ref('')
const saving = ref(false)

const transaction = computed(() => props.transaction)
const associatedAccounts = computed(() => {
  const value = transaction.value
  if (value.type === 'income' || value.type === 'expense' || value.type === 'adjustment') {
    return store.accounts.value.filter((account) => account.id === value.accountId)
  }
  return store.accounts.value.filter((account) => account.id === value.fromAccountId || account.id === value.toAccountId)
})
const hasArchivedAccount = computed(() => associatedAccounts.value.some((account) => account.archivedAt !== null))
const financialFieldsEditable = computed(() => transaction.value.type !== 'adjustment' && !hasArchivedAccount.value && transaction.value.deletedAt === null)
const categories = computed(() => {
  const value = transaction.value
  if (value.type !== 'income' && value.type !== 'expense') return []
  const currentId = value.categoryId
  const current = store.categories.value.find((category) => category.id === currentId)
  const active = store.activeCategories.value.filter((category) => category.kind === value.type)
  if (current && !active.some((category) => category.id === current.id)) return [current, ...active]
  return active
})

function reset(): void {
  const value = transaction.value
  amount.value = value.type === 'adjustment' ? '' : ledgerDecimalFromMinor(value.amountMinor, store.settings.value?.baseCurrency ?? 'CNY')
  occurredAt.value = store.settings.value?.timezone
    ? localDateTimeInputFromInstant(value.occurredAt, store.settings.value.timezone)
    : ''
  payee.value = value.type === 'income' || value.type === 'expense' ? value.payee : ''
  note.value = value.note
  accountId.value = value.type === 'income' || value.type === 'expense' ? value.accountId : ''
  categoryId.value = value.type === 'income' || value.type === 'expense' ? value.categoryId : ''
  fromAccountId.value = value.type === 'transfer' ? value.fromAccountId : ''
  toAccountId.value = value.type === 'transfer' ? value.toAccountId : ''
  error.value = ''
}

watch(() => props.transaction, reset, { immediate: true })

function validateFinancialFields(): { amountMinor: number; occurredAtMs: number } | null {
  const settings = store.settings.value
  if (!settings) {
    error.value = 'Ledger 设置尚未加载完成。'
    return null
  }
  let amountMinor: number
  try {
    amountMinor = parseLedgerMoney(amount.value, settings.baseCurrency)
  } catch {
    error.value = `请输入有效的${settings.baseCurrency}金额。`
    return null
  }
  if (amountMinor <= 0) {
    error.value = '金额必须大于 0。'
    return null
  }
  if (!occurredAt.value) {
    error.value = '请选择发生时间。'
    return null
  }
  let occurredAtMs: number
  try {
    occurredAtMs = instantFromLocalDateTime(occurredAt.value, settings.timezone)
  } catch {
    error.value = '请选择有效的发生时间。'
    return null
  }
  if (transaction.value.type === 'transfer') {
    if (!fromAccountId.value || !toAccountId.value) {
      error.value = '请选择转出账户和转入账户。'
      return null
    }
    if (fromAccountId.value === toAccountId.value) {
      error.value = '转出账户和转入账户必须不同。'
      return null
    }
  } else if (!accountId.value || !categoryId.value) {
    error.value = '请选择账户和分类。'
    return null
  }
  return { amountMinor, occurredAtMs }
}

function categoryPatchField(): { categoryId?: string } {
  const value = transaction.value
  if (value.type !== 'income' && value.type !== 'expense') return {}
  const current = store.categories.value.find((category) => category.id === value.categoryId)
  // The server permits an existing archived Category to remain attached to a
  // historical transaction, but rejects it as a new candidate. Omit the
  // unchanged archived identity from a partial edit; selecting an active
  // replacement still sends the new categoryId.
  if (current && current.archivedAt !== null && categoryId.value === current.id) return {}
  return { categoryId: categoryId.value }
}

async function submit(): Promise<void> {
  if (saving.value) return
  error.value = ''
  if (transaction.value.type === 'adjustment' || transaction.value.deletedAt !== null) {
    error.value = '这笔记录当前不可编辑。'
    return
  }

  const financial = financialFieldsEditable.value ? validateFinancialFields() : null
  if (financialFieldsEditable.value && !financial) return
  saving.value = true
  try {
    const body = financialFieldsEditable.value && financial
      ? transaction.value.type === 'income'
        ? {
            expectedVersion: transaction.value.version,
            amountMinor: financial.amountMinor,
            accountId: accountId.value,
            ...categoryPatchField(),
            occurredAt: financial.occurredAtMs,
            payee: payee.value.trim(),
            note: note.value.trim(),
          }
        : transaction.value.type === 'expense'
          ? {
            expectedVersion: transaction.value.version,
            amountMinor: financial.amountMinor,
            accountId: accountId.value,
            ...categoryPatchField(),
            occurredAt: financial.occurredAtMs,
              payee: payee.value.trim(),
              note: note.value.trim(),
            }
          : {
              expectedVersion: transaction.value.version,
              amountMinor: financial.amountMinor,
              fromAccountId: fromAccountId.value,
              toAccountId: toAccountId.value,
              occurredAt: financial.occurredAtMs,
              note: note.value.trim(),
            }
      : transaction.value.type === 'income' || transaction.value.type === 'expense'
        ? { expectedVersion: transaction.value.version, payee: payee.value.trim(), note: note.value.trim() }
        : { expectedVersion: transaction.value.version, note: note.value.trim() }
    const updated = await store.patchTransaction(transaction.value.id, body)
    emit('saved', updated)
  } catch (cause) {
    error.value = ledgerErrorMessage(cause, '交易没有保存，请刷新后重试。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="ledger-transaction-edit-form" data-testid="ledger-transaction-edit-form" :aria-busy="saving ? 'true' : undefined" @submit.prevent="submit">
    <div>
      <p class="ledger-eyebrow">编辑交易</p>
      <h2>{{ transaction.type === 'income' ? '编辑收入' : transaction.type === 'expense' ? '编辑支出' : '编辑转账' }}</h2>
      <p v-if="hasArchivedAccount" class="ledger-form-info">关联账户已归档；当前只能修改{{ transaction.type === 'income' || transaction.type === 'expense' ? '交易对象和备注' : '备注' }}。恢复账户后才能修改财务字段。</p>
    </div>

    <template v-if="financialFieldsEditable">
      <div class="ledger-form-field">
        <label for="ledger-edit-transaction-amount">金额</label>
        <input id="ledger-edit-transaction-amount" v-model="amount" name="amount" type="text" inputmode="decimal" required :disabled="saving" />
      </div>

      <template v-if="transaction.type === 'income' || transaction.type === 'expense'">
        <div class="ledger-form-field">
          <label for="ledger-edit-transaction-account">账户</label>
          <select id="ledger-edit-transaction-account" v-model="accountId" name="accountId" :disabled="saving">
            <option v-for="account in store.activeAccounts.value" :key="account.id" :value="account.id">{{ account.name }}</option>
          </select>
        </div>
        <div class="ledger-form-field">
          <label for="ledger-edit-transaction-category">分类</label>
          <select id="ledger-edit-transaction-category" v-model="categoryId" name="categoryId" :disabled="saving">
            <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}{{ category.archivedAt !== null ? '（已归档）' : '' }}</option>
          </select>
        </div>
      </template>

      <div v-else class="ledger-form-grid">
        <div class="ledger-form-field">
          <label for="ledger-edit-transaction-from">转出账户</label>
          <select id="ledger-edit-transaction-from" v-model="fromAccountId" name="fromAccountId" :disabled="saving"><option v-for="account in store.activeAccounts.value" :key="account.id" :value="account.id">{{ account.name }}</option></select>
        </div>
        <div class="ledger-form-field">
          <label for="ledger-edit-transaction-to">转入账户</label>
          <select id="ledger-edit-transaction-to" v-model="toAccountId" name="toAccountId" :disabled="saving"><option v-for="account in store.activeAccounts.value" :key="account.id" :value="account.id">{{ account.name }}</option></select>
        </div>
      </div>

      <div class="ledger-form-field">
        <label for="ledger-edit-transaction-occurred-at">发生时间</label>
        <input id="ledger-edit-transaction-occurred-at" v-model="occurredAt" name="occurredAt" type="datetime-local" required :disabled="saving" />
      </div>
    </template>

    <div v-else class="ledger-readonly-fields" aria-label="交易财务字段只读">
      <span>金额：{{ transaction.type === 'adjustment' ? '由余额调整维护' : ledgerDecimalFromMinor(transaction.amountMinor, store.settings.value?.baseCurrency ?? 'CNY') }}</span>
      <span>发生时间：{{ occurredAt || '—' }}</span>
    </div>

    <div v-if="transaction.type === 'income' || transaction.type === 'expense'" class="ledger-form-field">
      <label for="ledger-edit-transaction-payee">交易对象（可选）</label>
      <input id="ledger-edit-transaction-payee" v-model="payee" name="payee" type="text" autocomplete="off" :disabled="saving" />
    </div>
    <div class="ledger-form-field">
      <label for="ledger-edit-transaction-note">备注（可选）</label>
      <textarea id="ledger-edit-transaction-note" v-model="note" name="note" rows="3" :disabled="saving" />
    </div>

    <p v-if="error" class="ledger-form-error" role="alert">{{ error }}</p>
    <div class="ledger-form-actions">
      <button v-if="props.cancelable" class="ledger-secondary-button" type="button" :disabled="saving" @click="emit('cancel')">取消</button>
      <button class="ledger-primary-button" type="submit" :disabled="saving">{{ saving ? '正在保存…' : '保存交易' }}</button>
    </div>
  </form>
</template>

<style scoped>
.ledger-transaction-edit-form { display: grid; gap: 16px; width: min(100%, 620px); padding: 26px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 14px; background: var(--bg); }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .72rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.ledger-transaction-edit-form h2 { margin: 0; color: var(--text-h); font-size: 1.3rem; }
.ledger-form-info { margin: 8px 0 0; color: var(--text-muted); font-size: .8rem; line-height: 1.5; }
.ledger-form-field { display: grid; gap: 6px; }
.ledger-form-field label { color: var(--text-h); font-size: .81rem; font-weight: 650; }
.ledger-form-field input,
.ledger-form-field select,
.ledger-form-field textarea { width: 100%; min-height: 38px; padding: 7px 10px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text-h); font: inherit; font-size: .86rem; }
.ledger-form-field textarea { resize: vertical; }
.ledger-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ledger-readonly-fields { display: flex; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: .78rem; }
.ledger-readonly-fields span { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-soft); }
.ledger-form-error { margin: 0; color: #b42318; font-size: .81rem; }
.ledger-form-actions { display: flex; justify-content: flex-end; gap: 9px; }
.ledger-primary-button,
.ledger-secondary-button { min-height: 39px; padding: 7px 14px; border-radius: 7px; font: inherit; font-size: .83rem; font-weight: 650; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
@media (max-width: 620px) {
  .ledger-transaction-edit-form { padding: 22px 17px; }
  .ledger-form-grid { grid-template-columns: 1fr; }
  .ledger-form-actions > * { flex: 1 1 140px; }
}
</style>
