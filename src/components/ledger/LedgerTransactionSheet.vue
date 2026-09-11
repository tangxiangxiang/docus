<script setup lang="ts">
import { computed, h, nextTick, ref, watch } from 'vue'
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NIcon,
  NInput,
  NModal,
  NSelect,
  NTab,
  NTabs,
  type InputInst,
  type SelectGroupOption,
  type SelectOption,
} from 'naive-ui'
import { Tag, X } from '@vicons/tabler'
import type {
  LedgerCategoryDto,
  LedgerTransactionDto,
} from '../../../shared/ledgerProtocol'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { DEFAULT_CATEGORY_ICON } from '../../features/ledger/categoryIconMigration'
import { currencyExponentFor, formatLedgerMoney, parseLedgerMoney } from '../../features/ledger/money'
import { ledgerSelectNodeProps } from '../../features/ledger/naiveControls'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import { instantFromLocalDateTime, localDateTimeInputFromInstant } from '../../features/ledger/time'
import LedgerDateTimePicker from './LedgerDateTimePicker.vue'
import LedgerAccountIcon from './LedgerAccountIcon.vue'
import LedgerPendingCreateRecovery from './LedgerPendingCreateRecovery.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [transaction: LedgerTransactionDto] }>()

const store = useLedgerStore()
const toast = useToast()
const { confirm } = useConfirm()
const amountInput = ref<InputInst | null>(null)

type EntryType = 'expense' | 'income' | 'transfer'
const entryTypeOptions: ReadonlyArray<readonly [EntryType, string]> = [
  ['expense', '支出'],
  ['income', '收入'],
  ['transfer', '转账'],
]
const type = ref<EntryType>('expense')
const amount = ref('')
const accountId = ref('')
const categoryId = ref('')
const fromAccountId = ref('')
const toAccountId = ref('')
const occurredAt = ref('')
const location = ref('')
const payee = ref('')
const note = ref('')
const formError = ref('')
const saving = ref(false)
const submitted = ref(false)
const dirty = ref(false)
const closeRequestPending = ref(false)
const closing = ref(false)
let resetting = false

const settings = computed(() => store.settings.value)
const activeAccounts = computed(() => store.activeAccounts.value)
const activeCategories = computed(() => store.activeCategories.value)
const applicableCategories = computed(() => activeCategories.value.filter((category) => category.kind === type.value))
const accountOptions = computed(() => groupedAccountOptions(true))
const transferAccountOptions = computed(() => groupedAccountOptions(false))
const categoryOptions = computed<SelectOption[]>(() => applicableCategories.value.map((category) => ({
  value: category.id,
  label: categoryLabel(category),
  categoryIcon: category.icon,
})))
const pendingTransaction = computed(() => {
  const pending = store.pendingCreate.value
  return store.mutationState.value === 'UNCERTAIN' && pending?.operation === 'transaction' ? pending : null
})
const recoveryBusy = computed(() => store.mutationState.value === 'SUBMITTING')
const canSubmit = computed(() => activeAccounts.value.length > 0 && !saving.value)
const formTitle = computed(() => type.value === 'expense' ? '记一笔支出' : type.value === 'income' ? '记一笔收入' : '记一笔转账')

function groupedAccountOptions(showBalance: boolean): SelectGroupOption[] {
  return (['asset', 'liability'] as const).flatMap((nature) => {
    const children: SelectOption[] = activeAccounts.value
      .filter((account) => account.nature === nature)
      .sort((left, right) => right.currentBalanceMinor - left.currentBalanceMinor
        || left.name.localeCompare(right.name, 'zh-CN'))
      .map((account) => {
        const balanceLabel = showBalance
          ? formatLedgerMoney(account.currentBalanceMinor, account.currency)
          : ''
        return {
          value: account.id,
          label: balanceLabel ? `${account.name} · ${balanceLabel}` : account.name,
          accountName: account.name,
          balanceLabel,
        }
      })
    return children.length
      ? [{ type: 'group' as const, key: nature, label: nature === 'asset' ? '资产账户' : '负债账户', children }]
      : []
  })
}

function renderAccountContent(option: SelectOption | SelectGroupOption) {
  if (option.type === 'group') {
    return h('span', { class: 'ledger-account-select-group' }, String(option.label ?? ''))
  }
  const account = activeAccounts.value.find((item) => item.id === option.value)
  const accountName = String(option.accountName ?? account?.name ?? '')
  const balanceLabel = String(option.balanceLabel ?? '')
  return h('span', { class: 'ledger-account-select-option' }, [
    h('span', { class: 'ledger-account-select-icon', 'aria-hidden': 'true' }, [
      h(LedgerAccountIcon, { icon: account?.icon, size: 18 }),
    ]),
    h('span', { class: 'ledger-account-select-label' }, accountName),
    balanceLabel ? h('span', { class: 'ledger-account-select-balance' }, balanceLabel) : null,
  ])
}

function renderAccountLabel(option: SelectOption | SelectGroupOption) {
  return renderAccountContent(option)
}

function customCategoryIconSource(icon: string | undefined): string | undefined {
  if (!icon?.startsWith('custom_category_')) return undefined
  try {
    const icons = JSON.parse(localStorage.getItem('docus.ledger.category-custom-icons') ?? '{}') as Record<string, unknown>
    const source = icons[icon]
    return typeof source === 'string'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
      : undefined
  } catch {
    return undefined
  }
}

function renderCategoryLabel(option: SelectOption) {
  const category = applicableCategories.value.find((item) => item.id === option.value)
  if (!category) {
    return h('span', { class: 'ledger-category-select-option' }, [
      h('span', { class: 'ledger-category-select-icon', 'aria-hidden': 'true' }, [
        h(NIcon, { size: 18 }, { default: () => h(Tag) }),
      ]),
    ])
  }
  const icon = category?.icon ?? DEFAULT_CATEGORY_ICON
  const customSource = customCategoryIconSource(icon)
  return h('span', { class: 'ledger-category-select-option' }, [
    h('span', { class: 'ledger-category-select-icon', 'aria-hidden': 'true' }, [
      customSource
        ? h('img', { src: customSource, alt: '', width: 18, height: 18 })
        : h(LedgerAccountIcon, { icon, size: 18 }),
    ]),
    h('span', { class: 'ledger-account-select-label' }, String(option.label ?? category?.name ?? '')),
  ])
}

function defaultOccurredAt(): string {
  return settings.value?.timezone
    ? localDateTimeInputFromInstant(Date.now(), settings.value.timezone)
    : ''
}

function resetForm(): void {
  resetting = true
  closing.value = false
  type.value = 'expense'
  amount.value = ''
  accountId.value = activeAccounts.value.length === 1 ? activeAccounts.value[0]!.id : ''
  categoryId.value = ''
  fromAccountId.value = ''
  toAccountId.value = ''
  occurredAt.value = defaultOccurredAt()
  location.value = ''
  payee.value = ''
  note.value = ''
  formError.value = ''
  submitted.value = false
  dirty.value = false
  void nextTick(() => {
    resetting = false
    dirty.value = false
  })
}

watch(() => props.open, async (open) => {
  if (open) {
    resetForm()
    // NModal owns trapping and restoration. The public NInput instance only
    // supplies the sheet's initial field focus after its content is mounted.
    await nextTick()
    amountInput.value?.focus()
  }
})

watch([amount, accountId, categoryId, fromAccountId, toAccountId, occurredAt, location, payee, note, type], () => {
  if (props.open && !resetting) dirty.value = true
})

watch(type, (nextType, previousType) => {
  if (resetting || nextType === previousType) return
  // Only the common draft survives a semantic type switch. Account and
  // category identities must never be guessed across different transaction
  // meanings.
  accountId.value = ''
  categoryId.value = ''
  payee.value = ''
  fromAccountId.value = ''
  toAccountId.value = ''
  if (nextType !== 'transfer' && activeAccounts.value.length === 1) {
    accountId.value = activeAccounts.value[0]!.id
  }
})

watch(activeAccounts, (accounts) => {
  if (type.value !== 'transfer') {
    if (accountId.value && !accounts.some((account) => account.id === accountId.value)) accountId.value = ''
    if (!accountId.value && accounts.length === 1) accountId.value = accounts[0]!.id
    return
  }
  if (fromAccountId.value && !accounts.some((account) => account.id === fromAccountId.value)) fromAccountId.value = ''
  if (toAccountId.value && !accounts.some((account) => account.id === toAccountId.value)) toAccountId.value = ''
})

function onTypeTabKeydown(event: KeyboardEvent, selectedType: EntryType): void {
  const current = event.currentTarget as HTMLElement | null
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    type.value = selectedType
    return
  }
  if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const currentIndex = entryTypeOptions.findIndex(([value]) => value === selectedType)
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? entryTypeOptions.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + entryTypeOptions.length) % entryTypeOptions.length
  const nextType = entryTypeOptions[nextIndex]![0]
  type.value = nextType
  void nextTick(() => {
    current.closest('[role="tablist"]')?.querySelector<HTMLElement>(`[data-ledger-tab="${nextType}"]`)?.focus()
  })
}

async function requestClose(): Promise<void> {
  if (saving.value || closeRequestPending.value) return
  closeRequestPending.value = true
  try {
    if (dirty.value) {
      const leave = await confirm('放弃这笔尚未保存的记录？', '已填写的内容将不会保存。')
      if (!leave) return
    }
    dirty.value = false
    closing.value = true
    emit('close')
  } finally {
    closeRequestPending.value = false
  }
}

function handleVisibilityChange(value: boolean): void {
  if (!value && props.open) void requestClose()
}

function focusInitialInput(): void {
  void nextTick(() => amountInput.value?.focus())
}

function categoryLabel(category: LedgerCategoryDto): string {
  return category.name
}

function allowAmountInput(value: string): boolean {
  const currency = settings.value?.baseCurrency
  if (!currency || value === '') return true
  const exponent = currencyExponentFor(currency)
  const pattern = exponent === 0
    ? /^\d*$/
    : new RegExp(`^\\d*(?:\\.\\d{0,${exponent}})?$`)
  if (!pattern.test(value)) return false
  if (value === '.' || value.endsWith('.')) return true
  try {
    parseLedgerMoney(value, currency)
    return true
  } catch {
    return false
  }
}

function validationFailure(message: string): null {
  formError.value = ''
  toast.error(message)
  return null
}

function validate(): { amountMinor: number; occurredAtMs: number } | null {
  submitted.value = true
  formError.value = ''
  if (!settings.value) {
    return validationFailure('Ledger 设置尚未加载完成。')
  }
  if (!amount.value.trim()) {
    return validationFailure('请输入金额。')
  }
  let amountMinor: number
  try {
    amountMinor = parseLedgerMoney(amount.value, settings.value.baseCurrency)
  } catch {
    return validationFailure(`请输入有效的${settings.value.baseCurrency}金额。`)
  }
  if (amountMinor <= 0) {
    return validationFailure('金额必须大于 0。')
  }
  if (!occurredAt.value) {
    return validationFailure('请选择发生时间。')
  }
  let occurredAtMs: number
  try {
    occurredAtMs = instantFromLocalDateTime(occurredAt.value, settings.value.timezone)
  } catch {
    return validationFailure('请选择有效的发生时间。')
  }
  if (type.value === 'transfer') {
    if (!fromAccountId.value || !toAccountId.value) {
      return validationFailure('请选择转出账户和转入账户。')
    }
    if (fromAccountId.value === toAccountId.value) {
      return validationFailure('转出账户和转入账户必须不同。')
    }
  } else {
    if (!accountId.value) {
      return validationFailure('请选择账户。')
    }
    if (!categoryId.value) {
      return validationFailure('请选择分类，或先新建一个分类。')
    }
  }
  return { amountMinor, occurredAtMs }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const parsed = validate()
  if (!parsed) return
  saving.value = true
  try {
    const payload = type.value === 'expense'
      ? {
          type: 'expense' as const,
          amountMinor: parsed.amountMinor,
          accountId: accountId.value,
          categoryId: categoryId.value,
          occurredAt: parsed.occurredAtMs,
          location: location.value.trim(),
          payee: payee.value.trim(),
          note: note.value.trim(),
        }
      : type.value === 'income'
        ? {
            type: 'income' as const,
            amountMinor: parsed.amountMinor,
            accountId: accountId.value,
            categoryId: categoryId.value,
            occurredAt: parsed.occurredAtMs,
            location: location.value.trim(),
            payee: payee.value.trim(),
            note: note.value.trim(),
          }
        : {
            type: 'transfer' as const,
            amountMinor: parsed.amountMinor,
            fromAccountId: fromAccountId.value,
            toAccountId: toAccountId.value,
            occurredAt: parsed.occurredAtMs,
            location: location.value.trim(),
            payee: payee.value.trim(),
            note: note.value.trim(),
          }
    const saved = await store.createTransaction(payload)
    toast.success('已保存这笔交易')
    emit('saved', saved)
    emit('close')
  } catch (cause) {
    formError.value = ledgerErrorMessage(cause, '交易没有保存，请检查后重试。')
  } finally {
    saving.value = false
  }
}

async function retryPending(): Promise<void> {
  try {
    const result = await store.retryPendingCreate()
    toast.success('已确认这笔交易')
    emit('saved', result as LedgerTransactionDto)
    emit('close')
  } catch (cause) {
    formError.value = ledgerErrorMessage(cause, '上一次操作仍未确认，请稍后再试。')
  }
}

</script>

<template>
  <NModal
    v-if="props.open && !closing"
    :show="props.open && !closing"
    :mask-closable="false"
    :close-on-esc="false"
    :auto-focus="false"
    :trap-focus="true"
    :on-update-show="handleVisibilityChange"
    :on-after-enter="focusInitialInput"
  >
    <NCard
      class="ledger-sheet-card ledger-sheet"
      data-testid="ledger-transaction-sheet"
      :bordered="false"
      size="small"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ledger-sheet-title"
    >
      <template #header>
          <div>
            <h2 id="ledger-sheet-title">{{ formTitle }}</h2>
          </div>
      </template>
      <template #header-extra>
          <NButton class="ledger-close-button" attr-type="button" size="small" :bordered="false" :disabled="saving" aria-label="关闭记账窗口" @click="requestClose"><NIcon aria-hidden="true" :size="18"><X /></NIcon></NButton>
      </template>

        <LedgerPendingCreateRecovery
          v-if="pendingTransaction"
          :intent="pendingTransaction"
          :busy="recoveryBusy"
          :error="formError"
          @retry="retryPending"
        />

        <template v-else>
          <NTabs
            v-model:value="type"
            class="ledger-entry-types"
            type="segment"
            size="small"
            role="tablist"
            aria-label="交易类型"
            :animated="false"
            :tabs-padding="0"
          >
            <NTab
              v-for="option in entryTypeOptions"
              :key="option[0]"
              :name="option[0]"
              :tab="option[1]"
              class="ledger-entry-type"
              :data-ledger-tab="option[0]"
              role="tab"
              :aria-selected="type === option[0] ? 'true' : 'false'"
              :tabindex="type === option[0] ? 0 : -1"
              :disabled="saving"
              @keydown="onTypeTabKeydown($event, option[0])"
            />
          </NTabs>

          <NForm class="ledger-entry-form" :aria-busy="saving ? 'true' : undefined" @submit.prevent="submit">
            <NFormItem class="ledger-form-field ledger-amount-field" label="金额" :show-feedback="false" required>
              <div class="ledger-money-input">
                <span>{{ settings?.baseCurrency }}</span>
                <NInput
                  ref="amountInput"
                  v-model:value="amount"
                  class="ledger-money-control"
                  type="text"
                  size="small"
                  :allow-input="allowAmountInput"
                  :bordered="false"
                  :input-props="{ id: 'ledger-transaction-amount', name: 'amount', inputmode: 'decimal', autocomplete: 'off' }"
                placeholder="0.00"
                  :disabled="saving"
                />
              </div>
            </NFormItem>

            <template v-if="type !== 'transfer'">
              <div class="ledger-form-grid">
                <NFormItem class="ledger-form-field" label="账户" :show-feedback="false" required>
                  <NSelect
                    v-model:value="accountId"
                    class="ledger-form-control"
                    size="medium"
                    :options="accountOptions"
                    :render-label="renderAccountLabel"
                    :node-props="ledgerSelectNodeProps"
                    :input-props="{ id: 'ledger-transaction-account', name: 'accountId', required: true }"
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
                    :input-props="{ id: 'ledger-transaction-category', name: 'categoryId', required: true }"
                    aria-label="分类"
                    aria-haspopup="listbox"
                    role="combobox"
                    :placeholder="applicableCategories.length ? '请选择分类' : '暂无可用分类'"
                    :disabled="saving"
                  />
                </NFormItem>
              </div>
            </template>

            <template v-else>
              <div class="ledger-form-grid">
                <NFormItem class="ledger-form-field" label="转出账户" :show-feedback="false" required>
                <NSelect
                  v-model:value="fromAccountId"
                  class="ledger-form-control"
                  size="medium"
                  :options="transferAccountOptions"
                  :render-label="renderAccountLabel"
                  :node-props="ledgerSelectNodeProps"
                  :input-props="{ id: 'ledger-transaction-from-account', name: 'fromAccountId', required: true }"
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
                  :options="transferAccountOptions"
                  :render-label="renderAccountLabel"
                  :node-props="ledgerSelectNodeProps"
                  :input-props="{ id: 'ledger-transaction-to-account', name: 'toAccountId', required: true }"
                  aria-label="转入账户"
                  aria-haspopup="listbox"
                  role="combobox"
                  placeholder="请选择转入账户"
                  :disabled="saving"
                />
                </NFormItem>
              </div>
            </template>

            <div class="ledger-form-grid">
              <NFormItem class="ledger-form-field" label="发生时间" :show-feedback="false" required>
                <LedgerDateTimePicker
                  v-model="occurredAt"
                  label="发生时间"
                  test-id="ledger-transaction-occurred-at"
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
                  :input-props="{ id: 'ledger-transaction-location', name: 'location', autocomplete: 'off' }"
                  :disabled="saving"
                />
              </NFormItem>
            </div>

            <NFormItem class="ledger-form-field" label="交易对象（可选）" :show-feedback="false">
              <NInput
                v-model:value="payee"
                class="ledger-form-control"
                type="text"
                size="medium"
                :input-props="{ id: 'ledger-transaction-payee', name: 'payee', autocomplete: 'off' }"
                :disabled="saving"
              />
            </NFormItem>

            <NFormItem class="ledger-form-field" label="备注（可选）" :show-feedback="false">
              <NInput
                v-model:value="note"
                class="ledger-form-control"
                type="textarea"
                size="medium"
                :input-props="{ id: 'ledger-transaction-note', name: 'note', rows: 3 }"
                :disabled="saving"
              />
            </NFormItem>

            <p v-if="!activeAccounts.length" class="ledger-form-error" role="alert">请先创建一个可用账户，再记账。</p>
            <p v-if="formError" class="ledger-form-error" role="alert">{{ formError }}</p>
            <div class="ledger-form-actions">
              <NButton class="ledger-secondary-button" attr-type="button" size="small" :bordered="false" :disabled="saving" @click="requestClose">取消</NButton>
              <NButton class="ledger-primary-button" attr-type="submit" type="primary" size="small" :bordered="false" :disabled="!canSubmit">{{ saving ? '正在保存…' : '保存' }}</NButton>
            </div>
          </NForm>
        </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.ledger-sheet-card { align-self: center; width: min(100%, 640px); max-height: min(92vh, 820px); margin: auto; overflow: auto; box-sizing: border-box; border: 1px solid color-mix(in srgb, var(--border) 68%, transparent); border-radius: 18px 18px 12px 12px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 48%), color-mix(in srgb, var(--bg-soft) 68%, transparent); box-shadow: 0 24px 70px color-mix(in srgb, #0f172a 30%, transparent), inset 0 1px 0 color-mix(in srgb, #fff 32%, transparent); -webkit-backdrop-filter: saturate(145%) blur(22px); backdrop-filter: saturate(145%) blur(22px); color: var(--text); }
.ledger-sheet-card :deep(.n-card__content) { display: grid; gap: 14px; }
.ledger-sheet-card :deep(.n-card__header) { align-items: flex-start; gap: 16px; padding-bottom: 2px; }
.ledger-sheet-card h2 { margin: 0; color: var(--text-h); font-size: 1.35rem; line-height: 1.25; }
.ledger-close-button { width: 36px; height: 36px; padding: 0; border: 1px solid color-mix(in srgb, var(--border) 86%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--bg) 58%, transparent); color: var(--text-muted); font-size: 1.3rem; line-height: 1; cursor: pointer; transition: border-color .18s ease, background-color .18s ease, color .18s ease; }
.ledger-close-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-close-button:disabled { cursor: wait; opacity: .6; }
.ledger-entry-types { width: 100%; }
.ledger-entry-types :deep(.n-tabs-rail) { padding: 3px; border: 1px solid color-mix(in srgb, var(--border) 82%, transparent); border-radius: 9px; background: color-mix(in srgb, var(--bg) 54%, transparent); }
.ledger-entry-types :deep(.n-tabs-tab) { min-height: 30px; padding: 0 12px; border-radius: 7px; color: var(--text-muted); font: inherit; font-size: .78rem; transition: background-color .18s ease, color .18s ease; }
.ledger-entry-types :deep(.n-tabs-tab--active) { background: color-mix(in srgb, var(--accent) 11%, transparent); color: var(--accent); font-weight: 700; }
.ledger-entry-types :deep(.n-tabs-tab:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.ledger-entry-types :deep(.n-tabs-tab--disabled) { cursor: wait; opacity: .6; }
.ledger-entry-form { display: grid; gap: 12px; }
.ledger-form-field { display: grid; gap: 4px; min-width: 0; }
.ledger-amount-field { margin-top: 12px; }
.ledger-form-field :deep(.n-form-item-label) { color: var(--text-h); font-size: .8rem; font-weight: 700; letter-spacing: .01em; }
.ledger-form-control { width: 100%; }
.ledger-sheet-card :deep(.ledger-account-select-option) { display: inline-flex; width: 100%; min-width: 0; align-items: center; gap: 8px; }
.ledger-sheet-card :deep(.ledger-category-select-option) { display: inline-flex; width: 100%; min-width: 0; align-items: center; gap: 8px; }
.ledger-sheet-card :deep(.n-base-select-option__content),
.ledger-sheet-card :deep(.n-base-selection-label__render-label),
.ledger-sheet-card :deep(.n-base-selection-input__content),
.ledger-sheet-card :deep(.n-base-selection-overlay__wrapper) { width: 100%; min-width: 0; }
.ledger-sheet-card :deep(.n-base-selection-label__render-label),
.ledger-sheet-card :deep(.n-base-selection-overlay__wrapper) { display: flex; height: 100%; align-items: center; }
.ledger-sheet-card :deep(.n-base-selection-input),
.ledger-sheet-card :deep(.n-base-selection-input__content) { display: flex; height: 100%; align-items: center; }
.ledger-sheet-card :deep(.ledger-account-select-icon) { display: inline-grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; color: var(--accent); line-height: 0; }
.ledger-sheet-card :deep(.ledger-category-select-icon) { display: inline-grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; color: var(--accent); line-height: 0; }
.ledger-sheet-card :deep(.ledger-category-select-icon img) { display: block; width: 18px; height: 18px; object-fit: contain; }
.ledger-sheet-card :deep(.ledger-account-select-label) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ledger-sheet-card :deep(.ledger-account-select-balance) { flex: 0 0 auto; margin-left: auto; color: var(--text-muted); font-variant-numeric: tabular-nums; text-align: right; }
.ledger-sheet-card :deep(.ledger-account-select-group) { color: var(--text-muted); font-size: .72rem; font-weight: 700; letter-spacing: .02em; }
.ledger-form-field :deep(.n-form-item-blank) { min-width: 0; }
.ledger-form-field :deep(.ledger-form-control .n-input),
.ledger-form-field :deep(.ledger-form-control .n-base-selection),
.ledger-form-field :deep(.ledger-date-time-picker) { width: 100%; }
.ledger-form-field :deep(.ledger-date-time-picker .n-input-group) { width: 100%; }
.ledger-form-field :deep(.ledger-date-time-picker .n-date-picker),
.ledger-form-field :deep(.ledger-date-time-picker .n-time-picker) { min-width: 0; flex: 1 1 0; }
.ledger-money-input { display: flex; align-items: center; width: 100%; box-sizing: border-box; gap: 8px; min-height: 34px; padding: 2px 10px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--bg) 78%, transparent); box-shadow: 0 3px 12px color-mix(in srgb, var(--accent) 5%, transparent); }
.ledger-money-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent); }
.ledger-money-input span { color: var(--accent); font-size: .78rem; font-weight: 750; }
.ledger-money-control { flex: 1; min-width: 0; }
.ledger-money-control { font-size: .95rem; font-weight: 650; }
.ledger-field-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ledger-link-button { padding: 0; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: .76rem; cursor: pointer; }
.ledger-link-button:hover:not(:disabled) { text-decoration: underline; }
.ledger-link-button:disabled { cursor: wait; opacity: .6; }
.ledger-quick-create { display: grid; gap: 6px; margin-top: 3px; padding: 10px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--accent) 6%, transparent); }
.ledger-quick-create label { font-size: .78rem; }
.ledger-quick-create-row { display: flex; gap: 7px; }
.ledger-quick-create-row :deep(.ledger-form-control) { flex: 1; min-width: 0; }
.ledger-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ledger-form-actions { display: flex; justify-content: flex-end; gap: 9px; margin: 2px -4px -4px; padding: 4px 4px 0; border-top: 1px solid color-mix(in srgb, var(--border) 72%, transparent); }
.ledger-primary-button,
.ledger-secondary-button { min-height: 34px; padding: 5px 12px; border-radius: 7px; font: inherit; font-size: .82rem; font-weight: 650; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
.ledger-form-error { margin: 0; color: #b42318; font-size: .81rem; line-height: 1.45; }
@media (max-width: 600px) {
  .ledger-sheet-card { align-self: flex-end; width: 100%; max-height: 100%; margin: auto 0 0; border-radius: 16px 16px 0 0; }
  .ledger-form-grid { grid-template-columns: 1fr; }
  .ledger-form-actions > * { flex: 1 1 140px; }
}
</style>
