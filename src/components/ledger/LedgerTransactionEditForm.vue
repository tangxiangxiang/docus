<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NForm, NFormItem, NInput, NSelect, type SelectOption } from 'naive-ui'
import type { LedgerTransactionDto } from '../../../shared/ledgerProtocol'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { ledgerDecimalFromMinor, parseLedgerMoney } from '../../features/ledger/money'
import { ledgerSelectNodeProps } from '../../features/ledger/naiveControls'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import { instantFromLocalDateTime, localDateTimeInputFromInstant } from '../../features/ledger/time'
import LedgerDateTimePicker from './LedgerDateTimePicker.vue'

const props = withDefaults(defineProps<{
  transaction: LedgerTransactionDto
  cancelable?: boolean
}>(), { cancelable: true })

const emit = defineEmits<{
  saved: [transaction: LedgerTransactionDto]
  cancel: []
  dirty: [value: boolean]
}>()
const store = useLedgerStore()

const amount = ref('')
const accountId = ref('')
const categoryId = ref('')
const fromAccountId = ref('')
const toAccountId = ref('')
const occurredAt = ref('')
const location = ref('')
const payee = ref('')
const note = ref('')
const error = ref('')
const saving = ref(false)
type FormSnapshot = {
  amount: string
  accountId: string
  categoryId: string
  fromAccountId: string
  toAccountId: string
  occurredAt: string
  location: string
  payee: string
  note: string
}
const initialSnapshot = ref<FormSnapshot | null>(null)

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
const accountOptions = computed<SelectOption[]>(() => store.activeAccounts.value.map((account) => ({
  value: account.id,
  label: account.name,
})))
const categoryOptions = computed<SelectOption[]>(() => categories.value.map((category) => ({
  value: category.id,
  label: `${category.name}${category.archivedAt !== null ? '（已归档）' : ''}`,
})))

function associatedAccountIds(): string[] {
  const value = transaction.value
  if (value.type === 'transfer') return [value.fromAccountId, value.toAccountId]
  return [value.accountId]
}

async function refreshAssociatedAccounts(): Promise<void> {
  await Promise.all([...new Set(associatedAccountIds())].map((id) => store.getAccount(id)))
}

function reset(): void {
  const value = transaction.value
  amount.value = value.type === 'adjustment' ? '' : ledgerDecimalFromMinor(value.amountMinor, store.settings.value?.baseCurrency ?? 'CNY')
  occurredAt.value = store.settings.value?.timezone
    ? localDateTimeInputFromInstant(value.occurredAt, store.settings.value.timezone)
    : ''
  location.value = value.location ?? ''
  payee.value = value.type === 'income' || value.type === 'expense' ? value.payee : ''
  note.value = value.note
  accountId.value = value.type === 'income' || value.type === 'expense' ? value.accountId : ''
  categoryId.value = value.type === 'income' || value.type === 'expense' ? value.categoryId : ''
  fromAccountId.value = value.type === 'transfer' ? value.fromAccountId : ''
  toAccountId.value = value.type === 'transfer' ? value.toAccountId : ''
  error.value = ''
  initialSnapshot.value = snapshot()
}

watch(() => props.transaction, reset, { immediate: true })
watch([amount, accountId, categoryId, fromAccountId, toAccountId, occurredAt, location, payee, note], () => {
  if (!initialSnapshot.value) return
  emit('dirty', JSON.stringify(snapshot()) !== JSON.stringify(initialSnapshot.value))
})

function snapshot(): FormSnapshot {
  return {
    amount: amount.value,
    accountId: accountId.value,
    categoryId: categoryId.value,
    fromAccountId: fromAccountId.value,
    toAccountId: toAccountId.value,
    occurredAt: occurredAt.value,
    location: location.value,
    payee: payee.value,
    note: note.value,
  }
}

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

  saving.value = true
  try {
    if (financialFieldsEditable.value) {
      // An Account can be archived in another session while this form is
      // open. Re-read the server-owned Account state immediately before
      // constructing a financial patch; do not rely on the old snapshot or
      // let an avoidable generic 409 decide the UX.
      await refreshAssociatedAccounts()
      if (!financialFieldsEditable.value) {
        error.value = '关联账户已归档，无法保存财务字段。请先恢复账户；当前只允许修改交易对象和备注。'
        return
      }
    }

    const financial = financialFieldsEditable.value ? validateFinancialFields() : null
    if (financialFieldsEditable.value && !financial) return
    const body = financialFieldsEditable.value && financial
      ? transaction.value.type === 'income'
        ? {
            expectedVersion: transaction.value.version,
            amountMinor: financial.amountMinor,
            accountId: accountId.value,
            ...categoryPatchField(),
            occurredAt: financial.occurredAtMs,
            location: location.value.trim(),
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
              location: location.value.trim(),
              payee: payee.value.trim(),
              note: note.value.trim(),
            }
          : {
              expectedVersion: transaction.value.version,
              amountMinor: financial.amountMinor,
              fromAccountId: fromAccountId.value,
              toAccountId: toAccountId.value,
              occurredAt: financial.occurredAtMs,
              location: location.value.trim(),
              note: note.value.trim(),
            }
      : transaction.value.type === 'income' || transaction.value.type === 'expense'
        ? { expectedVersion: transaction.value.version, location: location.value.trim(), payee: payee.value.trim(), note: note.value.trim() }
        : { expectedVersion: transaction.value.version, location: location.value.trim(), note: note.value.trim() }
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
  <NForm class="ledger-transaction-edit-form" data-testid="ledger-transaction-edit-form" :aria-busy="saving ? 'true' : undefined" @submit.prevent="submit">
    <div>
      <p class="ledger-eyebrow">编辑交易</p>
      <h2>{{ transaction.type === 'income' ? '编辑收入' : transaction.type === 'expense' ? '编辑支出' : '编辑转账' }}</h2>
      <p v-if="hasArchivedAccount" class="ledger-form-info">关联账户已归档；当前只能修改{{ transaction.type === 'income' || transaction.type === 'expense' ? '交易对象和备注' : '备注' }}。恢复账户后才能修改财务字段。</p>
    </div>

    <template v-if="financialFieldsEditable">
      <NFormItem class="ledger-form-field" label="金额" :show-feedback="false" required>
        <NInput
          v-model:value="amount"
          class="ledger-form-control"
          type="text"
          size="medium"
          :input-props="{ id: 'ledger-edit-transaction-amount', name: 'amount', inputmode: 'decimal', required: true }"
          :disabled="saving"
        />
      </NFormItem>

      <template v-if="transaction.type === 'income' || transaction.type === 'expense'">
        <NFormItem class="ledger-form-field" label="账户" :show-feedback="false" required>
          <NSelect
            v-model:value="accountId"
            class="ledger-form-control"
            size="medium"
            :options="accountOptions"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: 'ledger-edit-transaction-account', name: 'accountId' }"
            aria-label="账户"
            aria-haspopup="listbox"
            role="combobox"
            :disabled="saving"
          />
        </NFormItem>
        <NFormItem class="ledger-form-field" label="分类" :show-feedback="false" required>
          <NSelect
            v-model:value="categoryId"
            class="ledger-form-control"
            size="medium"
            :options="categoryOptions"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: 'ledger-edit-transaction-category', name: 'categoryId' }"
            aria-label="分类"
            aria-haspopup="listbox"
            role="combobox"
            :disabled="saving"
          />
        </NFormItem>
      </template>

      <div v-else class="ledger-form-grid">
        <NFormItem class="ledger-form-field" label="转出账户" :show-feedback="false" required>
          <NSelect
            v-model:value="fromAccountId"
            class="ledger-form-control"
            size="medium"
            :options="accountOptions"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: 'ledger-edit-transaction-from', name: 'fromAccountId' }"
            aria-label="转出账户"
            aria-haspopup="listbox"
            role="combobox"
            :disabled="saving"
          />
        </NFormItem>
        <NFormItem class="ledger-form-field" label="转入账户" :show-feedback="false" required>
          <NSelect
            v-model:value="toAccountId"
            class="ledger-form-control"
            size="medium"
            :options="accountOptions"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: 'ledger-edit-transaction-to', name: 'toAccountId' }"
            aria-label="转入账户"
            aria-haspopup="listbox"
            role="combobox"
            :disabled="saving"
          />
        </NFormItem>
      </div>

      <div class="ledger-form-grid">
        <NFormItem class="ledger-form-field" label="发生时间" :show-feedback="false" required>
          <LedgerDateTimePicker
            v-model="occurredAt"
            label="发生时间"
            test-id="ledger-edit-transaction-occurred-at"
            :disabled="saving"
          />
        </NFormItem>
        <NFormItem class="ledger-form-field" label="交易地点（可选）" :show-feedback="false">
          <NInput v-model:value="location" class="ledger-form-control" type="text" size="medium" maxlength="200" :disabled="saving" />
        </NFormItem>
      </div>
    </template>

    <div v-else class="ledger-readonly-fields" aria-label="交易财务字段只读">
      <span>金额：{{ transaction.type === 'adjustment' ? '由余额调整维护' : ledgerDecimalFromMinor(transaction.amountMinor, store.settings.value?.baseCurrency ?? 'CNY') }}</span>
      <span>发生时间：{{ occurredAt || '—' }}</span>
    </div>

    <NFormItem v-if="!financialFieldsEditable" class="ledger-form-field" label="交易地点（可选）" :show-feedback="false">
      <NInput v-model:value="location" class="ledger-form-control" type="text" size="medium" maxlength="200" :disabled="saving" />
    </NFormItem>

    <NFormItem v-if="transaction.type === 'income' || transaction.type === 'expense'" class="ledger-form-field" label="交易对象（可选）" :show-feedback="false">
      <NInput
        v-model:value="payee"
        class="ledger-form-control"
        type="text"
        size="medium"
        :input-props="{ id: 'ledger-edit-transaction-payee', name: 'payee', autocomplete: 'off' }"
        :disabled="saving"
      />
    </NFormItem>
    <NFormItem class="ledger-form-field" label="备注（可选）" :show-feedback="false">
      <NInput
        v-model:value="note"
        class="ledger-form-control"
        type="textarea"
        size="medium"
        :input-props="{ id: 'ledger-edit-transaction-note', name: 'note', rows: 3 }"
        :disabled="saving"
      />
    </NFormItem>

    <p v-if="error" class="ledger-form-error" role="alert">{{ error }}</p>
    <div class="ledger-form-actions">
      <NButton v-if="props.cancelable" class="ledger-secondary-button" attr-type="button" size="medium" :bordered="false" :disabled="saving" @click="emit('cancel')">取消</NButton>
      <NButton class="ledger-primary-button" attr-type="submit" type="primary" size="medium" :bordered="false" :disabled="saving">{{ saving ? '正在保存…' : '保存交易' }}</NButton>
    </div>
  </NForm>
</template>

<style scoped>
.ledger-transaction-edit-form { display: grid; gap: 14px; width: 100%; padding: 4px 10px 8px; box-sizing: border-box; border: 1px solid color-mix(in srgb, var(--border) 48%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--bg) 24%, transparent); }
.ledger-transaction-edit-form > div:first-child { padding: 10px 4px 12px; border-bottom: 1px solid color-mix(in srgb, var(--border) 42%, transparent); }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .72rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.ledger-transaction-edit-form h2 { margin: 0; color: var(--text-h); font-size: 1.2rem; letter-spacing: -.015em; }
.ledger-form-info { margin: 8px 0 0; color: var(--text-muted); font-size: .8rem; line-height: 1.5; }
.ledger-form-field { display: grid; gap: 6px; }
.ledger-form-field :deep(.n-form-item-label) { color: var(--text-h); font-size: .78rem; font-weight: 650; }
.ledger-form-control { width: 100%; }
.ledger-form-field :deep(.ledger-form-control .n-input),
.ledger-form-field :deep(.ledger-form-control .n-base-selection),
.ledger-form-field :deep(.ledger-date-time-picker) { width: 100%; }
.ledger-form-field :deep(.n-input),
.ledger-form-field :deep(.n-base-selection) { border-radius: 9px; }
.ledger-form-field :deep(.n-input),
.ledger-form-field :deep(.n-base-selection) { background: color-mix(in srgb, var(--bg-soft) 54%, transparent); }
.ledger-form-field :deep(.n-input--focus),
.ledger-form-field :deep(.n-base-selection--focus) { box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent); }
.ledger-form-field :deep(.n-input__input-el) { min-height: 38px; }
.ledger-form-field :deep(.n-input--textarea) { min-height: 82px; }
.ledger-form-field :deep(.ledger-date-time-picker .n-date-picker),
.ledger-form-field :deep(.ledger-date-time-picker .n-time-picker) { min-width: 0; flex: 1 1 0; }
.ledger-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ledger-readonly-fields { display: flex; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: .78rem; }
.ledger-readonly-fields span { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-soft); }
.ledger-form-error { margin: 0; color: #b42318; font-size: .81rem; }
.ledger-form-actions { display: flex; justify-content: flex-end; gap: 9px; padding: 12px 4px 0; border-top: 1px solid color-mix(in srgb, var(--border) 42%, transparent); }
.ledger-primary-button,
.ledger-secondary-button { min-height: 39px; padding: 7px 14px; border-radius: 7px; font: inherit; font-size: .83rem; font-weight: 650; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid color-mix(in srgb, var(--border) 86%, transparent); background: color-mix(in srgb, var(--bg) 34%, transparent); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
@media (max-width: 620px) {
  .ledger-transaction-edit-form { padding: 4px 6px 8px; }
  .ledger-form-grid { grid-template-columns: 1fr; }
  .ledger-form-actions > * { flex: 1 1 140px; }
}
</style>
