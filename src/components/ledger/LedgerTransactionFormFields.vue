<script setup lang="ts">
import { computed, ref, type VNodeChild } from 'vue'
import { NFormItem, NInput, NRadioButton, NRadioGroup, NSelect, type InputInst, type SelectGroupOption, type SelectOption } from 'naive-ui'
import type { LedgerTransferFeeMode, LedgerTransferKind } from '../../../shared/ledgerProtocol'
import { formatLedgerMoney, parseLedgerMoney } from '../../features/ledger/money'
import { ledgerSelectNodeProps } from '../../features/ledger/naiveControls'
import LedgerDateTimePicker from './LedgerDateTimePicker.vue'

type TransactionFormType = 'income' | 'expense' | 'transfer'
type AccountOptionRenderer = (option: SelectOption | SelectGroupOption) => VNodeChild
type CategoryOptionRenderer = (option: SelectOption) => VNodeChild

const props = withDefaults(defineProps<{
  mode: 'create' | 'edit'
  type: TransactionFormType
  currency: string
  saving: boolean
  financialFieldsEditable?: boolean
  accountOptions: Array<SelectOption | SelectGroupOption>
  transferAccountOptions?: Array<SelectOption | SelectGroupOption>
  transferFromAccountOptions?: Array<SelectOption | SelectGroupOption>
  transferToAccountOptions?: Array<SelectOption | SelectGroupOption>
  categoryOptions: SelectOption[]
  renderAccountLabel?: AccountOptionRenderer
  renderCategoryLabel?: CategoryOptionRenderer
  allowAmountInput?: (value: string) => boolean
  readonlyAmount?: string
  readonlyOccurredAt?: string
  showPayee?: boolean
}>(), {
  financialFieldsEditable: true,
  transferAccountOptions: () => [],
  transferFromAccountOptions: undefined,
  transferToAccountOptions: undefined,
  readonlyAmount: '—',
  readonlyOccurredAt: '—',
  showPayee: true,
})

const amount = defineModel<string>('amount', { required: true })
const accountId = defineModel<string>('accountId', { required: true })
const categoryId = defineModel<string>('categoryId', { required: true })
const fromAccountId = defineModel<string>('fromAccountId', { required: true })
const toAccountId = defineModel<string>('toAccountId', { required: true })
const transferKind = defineModel<LedgerTransferKind>('transferKind', { default: 'general' })
const transferFeeAmount = defineModel<string>('transferFeeAmount', { default: '' })
const transferFeeMode = defineModel<LedgerTransferFeeMode>('transferFeeMode', { default: 'extra' })
const occurredAt = defineModel<string>('occurredAt', { required: true })
const location = defineModel<string>('location', { required: true })
const payee = defineModel<string>('payee', { required: true })
const note = defineModel<string>('note', { required: true })

const amountInput = ref<InputInst | null>(null)
const idPrefix = props.mode === 'create' ? 'ledger-transaction' : 'ledger-edit-transaction'

const parsedTransferAmount = computed(() => {
  try {
    return parseLedgerMoney(amount.value, props.currency)
  } catch {
    return null
  }
})
const parsedTransferFee = computed(() => {
  if (!transferFeeAmount.value.trim()) return 0
  try {
    return parseLedgerMoney(transferFeeAmount.value, props.currency)
  } catch {
    return null
  }
})
const transferSummary = computed(() => {
  if (props.type !== 'transfer' || transferKind.value === 'general'
    || parsedTransferAmount.value === null || parsedTransferFee.value === null) return null
  const transferAmount = transferKind.value === 'withdrawal' && transferFeeMode.value === 'deducted'
    ? parsedTransferAmount.value - parsedTransferFee.value
    : parsedTransferAmount.value
  return {
    transferAmount,
    fee: parsedTransferFee.value,
    total: transferAmount + parsedTransferFee.value,
  }
})

function moneyLabel(value: number): string {
  return formatLedgerMoney(value, props.currency)
}

defineExpose({
  focusAmount: () => amountInput.value?.focus(),
})
</script>

<template>
  <div class="ledger-transaction-form-fields" :data-mode="mode">
    <template v-if="financialFieldsEditable">
      <div :class="type === 'transfer' && transferKind !== 'general' ? 'ledger-transfer-amount-grid' : undefined">
        <NFormItem
          class="ledger-form-field ledger-amount-field"
          :label="type === 'transfer' && transferKind === 'repayment' ? '还款本金' : type === 'transfer' && transferKind === 'withdrawal' ? '提现金额' : '金额'"
          :show-feedback="false"
          required
        >
          <div class="ledger-money-input">
            <span>{{ currency }}</span>
            <NInput
              ref="amountInput"
              v-model:value="amount"
              class="ledger-money-control"
              type="text"
              size="small"
              :allow-input="allowAmountInput"
              :bordered="false"
              :input-props="{ id: `${idPrefix}-amount`, name: 'amount', inputmode: 'decimal', autocomplete: 'off', required: true }"
              placeholder="0.00"
              :disabled="saving"
            />
          </div>
        </NFormItem>

        <NFormItem v-if="type === 'transfer' && transferKind !== 'general'" class="ledger-form-field" :label="transferKind === 'repayment' ? '利息（可选）' : '手续费（可选）'" :show-feedback="false">
          <div class="ledger-money-input">
            <span>{{ currency }}</span>
            <NInput
              v-model:value="transferFeeAmount"
              class="ledger-money-control"
              type="text"
              size="small"
              :allow-input="allowAmountInput"
              :bordered="false"
              :input-props="{ id: `${idPrefix}-fee-amount`, name: 'feeAmount', inputmode: 'decimal', autocomplete: 'off' }"
              placeholder="0.00"
              :disabled="saving"
            />
          </div>
        </NFormItem>
      </div>

      <div v-if="transferKind === 'withdrawal' && transferSummary" class="ledger-transfer-fee-mode">
        <span class="ledger-transfer-summary-label">手续费方式</span>
        <NRadioGroup v-model:value="transferFeeMode" size="small" :disabled="saving" aria-label="手续费方式">
          <NRadioButton value="extra">额外扣除</NRadioButton>
          <NRadioButton value="deducted">从提现金额中扣除</NRadioButton>
        </NRadioGroup>
      </div>

      <div v-if="transferSummary" class="ledger-transfer-summary" aria-label="转账金额明细">
        <span>{{ transferKind === 'repayment' ? '总扣款' : transferFeeMode === 'deducted' ? '实际扣款' : '实际扣款' }}</span>
        <strong>{{ moneyLabel(transferSummary.total) }}</strong>
        <template v-if="transferKind === 'withdrawal'">
          <span>到账金额</span>
          <strong>{{ moneyLabel(transferSummary.transferAmount) }}</strong>
        </template>
      </div>

      <div v-if="type !== 'transfer'" class="ledger-form-grid">
        <NFormItem class="ledger-form-field" label="账户" :show-feedback="false" required>
          <NSelect
            v-model:value="accountId"
            class="ledger-form-control"
            size="medium"
            :options="accountOptions"
            :render-label="renderAccountLabel"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: `${idPrefix}-account`, name: 'accountId', required: true }"
            aria-label="账户"
            aria-haspopup="listbox"
            role="combobox"
            placeholder="请选择账户"
            :disabled="saving"
          />
        </NFormItem>

        <NFormItem class="ledger-form-field" label="分类" :show-feedback="false" required>
          <NSelect
            v-model:value="categoryId"
            class="ledger-form-control"
            size="medium"
            :options="categoryOptions"
            :render-label="renderCategoryLabel"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: `${idPrefix}-category`, name: 'categoryId', required: true }"
            aria-label="分类"
            aria-haspopup="listbox"
            role="combobox"
            :placeholder="categoryOptions.length ? '请选择分类' : '暂无可用分类'"
            :disabled="saving"
          />
        </NFormItem>
      </div>

      <div v-else class="ledger-form-grid">
        <NFormItem class="ledger-form-field ledger-transfer-kind-field" label="转账类型" :show-feedback="false">
          <NRadioGroup v-model:value="transferKind" class="ledger-transfer-kinds" size="small" :disabled="saving" aria-label="转账类型">
            <NRadioButton value="general">普通转账</NRadioButton>
            <NRadioButton value="repayment">还款</NRadioButton>
            <NRadioButton value="withdrawal">提现</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem class="ledger-form-field" label="转出账户" :show-feedback="false" required>
          <NSelect
            v-model:value="fromAccountId"
            class="ledger-form-control"
            size="medium"
            :options="transferFromAccountOptions ?? transferAccountOptions"
            :render-label="renderAccountLabel"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: `${idPrefix}-from-account`, name: 'fromAccountId', required: true }"
            aria-label="转出账户"
            aria-haspopup="listbox"
            role="combobox"
            placeholder="请选择转出账户"
            :disabled="saving"
          />
        </NFormItem>
        <NFormItem class="ledger-form-field" label="转入账户" :show-feedback="false" required>
          <NSelect
            v-model:value="toAccountId"
            class="ledger-form-control"
            size="medium"
            :options="transferToAccountOptions ?? transferAccountOptions"
            :render-label="renderAccountLabel"
            :node-props="ledgerSelectNodeProps"
            :input-props="{ id: `${idPrefix}-to-account`, name: 'toAccountId', required: true }"
            aria-label="转入账户"
            aria-haspopup="listbox"
            role="combobox"
            placeholder="请选择转入账户"
            :disabled="saving"
          />
        </NFormItem>
      </div>

      <div class="ledger-form-grid">
        <NFormItem class="ledger-form-field" label="发生时间" :show-feedback="false" required>
          <LedgerDateTimePicker
            v-model="occurredAt"
            label="发生时间"
            :test-id="`${idPrefix}-occurred-at`"
            :disabled="saving"
          />
        </NFormItem>
        <NFormItem class="ledger-form-field" label="交易地点（可选）" :show-feedback="false">
          <NInput
            v-model:value="location"
            class="ledger-form-control"
            type="text"
            size="medium"
            maxlength="200"
            :input-props="{ id: `${idPrefix}-location`, name: 'location', autocomplete: 'off' }"
            :disabled="saving"
          />
        </NFormItem>
      </div>
    </template>

    <template v-else>
      <div class="ledger-readonly-fields" aria-label="交易财务字段只读">
        <span>金额：{{ readonlyAmount }}</span>
        <span>发生时间：{{ readonlyOccurredAt }}</span>
      </div>
      <NFormItem class="ledger-form-field" label="交易地点（可选）" :show-feedback="false">
        <NInput v-model:value="location" class="ledger-form-control" type="text" size="medium" maxlength="200" :disabled="saving" />
      </NFormItem>
    </template>

    <NFormItem v-if="showPayee" class="ledger-form-field" label="交易对象（可选）" :show-feedback="false">
      <NInput
        v-model:value="payee"
        class="ledger-form-control"
        type="text"
        size="medium"
        :input-props="{ id: `${idPrefix}-payee`, name: 'payee', autocomplete: 'off' }"
        :disabled="saving"
      />
    </NFormItem>

    <NFormItem class="ledger-form-field" label="备注（可选）" :show-feedback="false">
      <NInput
        v-model:value="note"
        class="ledger-form-control"
        type="textarea"
        size="medium"
        :input-props="{ id: `${idPrefix}-note`, name: 'note', rows: 3 }"
        :disabled="saving"
      />
    </NFormItem>
  </div>
</template>

<style scoped>
.ledger-transaction-form-fields { display: grid; gap: 12px; min-width: 0; }
.ledger-form-field { display: grid; gap: 4px; min-width: 0; }
.ledger-amount-field { margin-top: 12px; }
.ledger-form-field :deep(.n-form-item-label) { color: var(--text-h); font-size: .8rem; font-weight: 700; letter-spacing: .01em; }
.ledger-form-field :deep(.n-form-item-blank) { min-width: 0; }
.ledger-form-control { width: 100%; }
.ledger-form-field :deep(.ledger-form-control .n-input),
.ledger-form-field :deep(.ledger-form-control .n-base-selection),
.ledger-form-field :deep(.ledger-date-time-picker),
.ledger-form-field :deep(.ledger-date-time-picker .n-input-group) { width: 100%; }
.ledger-form-field :deep(.ledger-date-time-picker .n-date-picker),
.ledger-form-field :deep(.ledger-date-time-picker .n-time-picker) { min-width: 0; flex: 1 1 0; }
.ledger-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ledger-transfer-amount-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.ledger-transfer-amount-grid .ledger-amount-field { margin-top: 0; }
.ledger-transfer-kind-field { grid-column: 1 / -1; }
.ledger-transfer-kinds { display: flex; width: 100%; }
.ledger-transfer-kinds :deep(.n-radio-button) { display: flex; min-width: 0; flex: 1 1 0; justify-content: center; }
.ledger-transfer-kinds :deep(.n-radio-button__label) { width: 100%; text-align: center; }
.ledger-transfer-fee-mode { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--border) 66%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--bg-soft) 54%, transparent); }
.ledger-transfer-summary { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--accent) 5%, transparent); color: var(--text-muted); font-size: .78rem; }
.ledger-transfer-summary strong { color: var(--text-h); font-variant-numeric: tabular-nums; text-align: right; }
.ledger-transfer-summary-label { color: var(--text-muted); font-size: .78rem; font-weight: 650; }
.ledger-money-input { display: flex; align-items: center; width: 100%; min-height: 34px; box-sizing: border-box; gap: 8px; padding: 2px 10px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--bg) 78%, transparent); box-shadow: 0 3px 12px color-mix(in srgb, var(--accent) 5%, transparent); }
.ledger-money-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent); }
.ledger-money-input > span { color: var(--accent); font-size: .78rem; font-weight: 750; }
.ledger-money-control { flex: 1; min-width: 0; font-size: .95rem; font-weight: 650; }
.ledger-readonly-fields { display: flex; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: .78rem; }
.ledger-readonly-fields span { padding: 6px 9px; border: 1px solid color-mix(in srgb, var(--border) 68%, transparent); border-radius: 7px; background: color-mix(in srgb, var(--bg-soft) 60%, transparent); }
.ledger-transaction-form-fields :deep(.ledger-account-select-option),
.ledger-transaction-form-fields :deep(.ledger-category-select-option) { display: inline-flex; width: 100%; min-width: 0; align-items: center; gap: 8px; }
.ledger-transaction-form-fields :deep(.n-base-selection-label__render-label),
.ledger-transaction-form-fields :deep(.n-base-selection-input__content),
.ledger-transaction-form-fields :deep(.n-base-selection-overlay__wrapper) { width: 100%; min-width: 0; }
.ledger-transaction-form-fields :deep(.n-base-selection-label__render-label),
.ledger-transaction-form-fields :deep(.n-base-selection-overlay__wrapper),
.ledger-transaction-form-fields :deep(.n-base-selection-input),
.ledger-transaction-form-fields :deep(.n-base-selection-input__content) { display: flex; height: 100%; align-items: center; }
.ledger-transaction-form-fields :deep(.ledger-account-select-icon),
.ledger-transaction-form-fields :deep(.ledger-category-select-icon) { display: inline-grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; color: var(--accent); line-height: 0; }
.ledger-transaction-form-fields :deep(.ledger-category-select-icon img) { display: block; width: 18px; height: 18px; object-fit: contain; }
.ledger-transaction-form-fields :deep(.ledger-account-select-label) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ledger-transaction-form-fields :deep(.ledger-account-select-balance) { flex: 0 0 auto; margin-left: auto; color: var(--text-muted); font-variant-numeric: tabular-nums; text-align: right; }
.ledger-transaction-form-fields :deep(.ledger-account-select-group) { color: var(--text-muted); font-size: .72rem; font-weight: 700; letter-spacing: .02em; }
@media (max-width: 600px) {
  .ledger-form-grid,
  .ledger-transfer-amount-grid { grid-template-columns: 1fr; }
  .ledger-transfer-fee-mode { align-items: flex-start; flex-direction: column; }
}
</style>
