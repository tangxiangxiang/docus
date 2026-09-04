<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type {
  LedgerCategoryDto,
  LedgerTransactionDto,
} from '../../../shared/ledgerProtocol'
import { useConfirm } from '../../composables/useConfirm'
import { useFocusTrap } from '../../composables/useFocusTrap'
import { useToast } from '../../composables/useToast'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { formatLedgerMoney, parseLedgerMoney } from '../../features/ledger/money'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import { instantFromLocalDateTime, localDateTimeInputFromInstant } from '../../features/ledger/time'
import LedgerPendingCreateRecovery from './LedgerPendingCreateRecovery.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [transaction: LedgerTransactionDto] }>()

const store = useLedgerStore()
const toast = useToast()
const { confirm } = useConfirm()
const trap = useFocusTrap()
const dialogRef = ref<HTMLElement | null>(null)
const amountInput = ref<HTMLInputElement | null>(null)

type EntryType = 'expense' | 'income' | 'transfer'
const type = ref<EntryType>('expense')
const amount = ref('')
const accountId = ref('')
const categoryId = ref('')
const fromAccountId = ref('')
const toAccountId = ref('')
const occurredAt = ref('')
const payee = ref('')
const note = ref('')
const formError = ref('')
const saving = ref(false)
const submitted = ref(false)
const categoryCreateOpen = ref(false)
const categoryName = ref('')
const categoryError = ref('')
const categorySaving = ref(false)
const dirty = ref(false)
let resetting = false

const settings = computed(() => store.settings.value)
const activeAccounts = computed(() => store.activeAccounts.value)
const activeCategories = computed(() => store.activeCategories.value)
const applicableCategories = computed(() => activeCategories.value.filter((category) => category.kind === type.value))
const pendingTransaction = computed(() => {
  const pending = store.pendingCreate.value
  return pending?.operation === 'transaction' ? pending : null
})
const pendingCategory = computed(() => {
  const pending = store.pendingCreate.value
  return pending?.operation === 'category' ? pending : null
})
const recoveryBusy = computed(() => store.mutationState.value === 'SUBMITTING')
const canSubmit = computed(() => activeAccounts.value.length > 0 && !saving.value && !categorySaving.value)
const formTitle = computed(() => type.value === 'expense' ? '记一笔支出' : type.value === 'income' ? '记一笔收入' : '记一笔转账')

function defaultOccurredAt(): string {
  return settings.value?.timezone
    ? localDateTimeInputFromInstant(Date.now(), settings.value.timezone)
    : ''
}

function resetForm(): void {
  resetting = true
  type.value = 'expense'
  amount.value = ''
  accountId.value = activeAccounts.value[0]?.id ?? ''
  categoryId.value = ''
  fromAccountId.value = activeAccounts.value[0]?.id ?? ''
  toAccountId.value = activeAccounts.value[1]?.id ?? ''
  occurredAt.value = defaultOccurredAt()
  payee.value = ''
  note.value = ''
  formError.value = ''
  submitted.value = false
  categoryCreateOpen.value = applicableCategories.value.length === 0
  categoryName.value = ''
  categoryError.value = ''
  categorySaving.value = false
  dirty.value = false
  void nextTick(() => {
    resetting = false
    dirty.value = false
  })
}

watch(() => props.open, async (open) => {
  if (open) {
    resetForm()
    trap.activate()
    await nextTick()
    amountInput.value?.focus()
  } else {
    void trap.deactivate()
  }
})

watch([amount, accountId, categoryId, fromAccountId, toAccountId, occurredAt, payee, note, type], () => {
  if (props.open && !resetting) dirty.value = true
})

watch(type, () => {
  categoryId.value = ''
  categoryCreateOpen.value = applicableCategories.value.length === 0
})

watch(activeAccounts, (accounts) => {
  if (!accountId.value) accountId.value = accounts[0]?.id ?? ''
  if (!fromAccountId.value) fromAccountId.value = accounts[0]?.id ?? ''
  if (!toAccountId.value || toAccountId.value === fromAccountId.value) {
    toAccountId.value = accounts.find((account) => account.id !== fromAccountId.value)?.id ?? ''
  }
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void requestClose()
    return
  }
  if (event.key === 'Tab') trap.onTab(() => dialogRef.value, event)
}

async function requestClose(): Promise<void> {
  if (saving.value || categorySaving.value) return
  if (dirty.value) {
    const leave = await confirm('放弃这笔尚未保存的记录？', '已填写的内容将不会保存。')
    if (!leave) return
  }
  emit('close')
}

function categoryLabel(category: LedgerCategoryDto): string {
  return category.name
}

function validate(): { amountMinor: number; occurredAtMs: number } | null {
  submitted.value = true
  formError.value = ''
  if (!settings.value) {
    formError.value = 'Ledger 设置尚未加载完成。'
    return null
  }
  if (!amount.value.trim()) {
    formError.value = '请输入金额。'
    return null
  }
  let amountMinor: number
  try {
    amountMinor = parseLedgerMoney(amount.value, settings.value.baseCurrency)
  } catch {
    formError.value = `请输入有效的${settings.value.baseCurrency}金额。`
    return null
  }
  if (amountMinor <= 0) {
    formError.value = '金额必须大于 0。'
    return null
  }
  if (!occurredAt.value) {
    formError.value = '请选择发生时间。'
    return null
  }
  let occurredAtMs: number
  try {
    occurredAtMs = instantFromLocalDateTime(occurredAt.value, settings.value.timezone)
  } catch {
    formError.value = '请选择有效的发生时间。'
    return null
  }
  if (type.value === 'transfer') {
    if (!fromAccountId.value || !toAccountId.value) {
      formError.value = '请选择转出账户和转入账户。'
      return null
    }
    if (fromAccountId.value === toAccountId.value) {
      formError.value = '转出账户和转入账户必须不同。'
      return null
    }
  } else {
    if (!accountId.value) {
      formError.value = '请选择账户。'
      return null
    }
    if (!categoryId.value) {
      formError.value = '请选择分类，或先新建一个分类。'
      return null
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
            payee: payee.value.trim(),
            note: note.value.trim(),
          }
        : {
            type: 'transfer' as const,
            amountMinor: parsed.amountMinor,
            fromAccountId: fromAccountId.value,
            toAccountId: toAccountId.value,
            occurredAt: parsed.occurredAtMs,
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

async function createCategory(): Promise<void> {
  if (categorySaving.value || !categoryName.value.trim()) {
    categoryError.value = categoryName.value.trim() ? '' : '请输入分类名称。'
    return
  }
  categorySaving.value = true
  categoryError.value = ''
  try {
    const created = await store.createCategory({ kind: type.value as 'income' | 'expense', name: categoryName.value.trim() })
    categoryId.value = created.id
    categoryCreateOpen.value = false
    categoryName.value = ''
  } catch (cause) {
    categoryError.value = ledgerErrorMessage(cause, '分类没有创建，请换一个名称后重试。')
  } finally {
    categorySaving.value = false
  }
}

async function retryPending(): Promise<void> {
  const wasCategory = pendingCategory.value !== null
  try {
    const result = await store.retryPendingCreate()
    if (wasCategory) {
      const created = result as { id?: unknown } | null
      if (created && typeof created.id === 'string') categoryId.value = created.id
      categoryCreateOpen.value = false
      toast.success('分类已保存')
    } else {
      toast.success('已确认这笔交易')
      emit('saved', result as LedgerTransactionDto)
      emit('close')
    }
  } catch (cause) {
    formError.value = ledgerErrorMessage(cause, '上一次操作仍未确认，请稍后再试。')
  }
}

onBeforeUnmount(() => {
  if (props.open) void trap.deactivate()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="ledger-sheet-backdrop" @click.self="requestClose">
      <section ref="dialogRef" class="ledger-sheet" role="dialog" aria-modal="true" aria-labelledby="ledger-sheet-title" tabindex="-1" @keydown="onKeydown">
        <header class="ledger-sheet-header">
          <div>
            <p class="ledger-eyebrow">Ledger</p>
            <h2 id="ledger-sheet-title">{{ formTitle }}</h2>
          </div>
          <button class="ledger-close-button" type="button" :disabled="saving || categorySaving" aria-label="关闭记账窗口" @click="requestClose">×</button>
        </header>

        <LedgerPendingCreateRecovery
          v-if="pendingTransaction || pendingCategory"
          :intent="pendingTransaction ?? pendingCategory!"
          :busy="recoveryBusy"
          :error="formError"
          @retry="retryPending"
        />

        <template v-else>
          <div class="ledger-entry-types" role="tablist" aria-label="交易类型">
            <button v-for="option in ([['expense', '支出'], ['income', '收入'], ['transfer', '转账']] as const)" :key="option[0]" class="ledger-entry-type" :class="{ 'is-selected': type === option[0] }" type="button" role="tab" :aria-selected="type === option[0]" :disabled="saving" @click="type = option[0]">{{ option[1] }}</button>
          </div>

          <form class="ledger-entry-form" :aria-busy="saving ? 'true' : undefined" @submit.prevent="submit">
            <div class="ledger-form-field ledger-amount-field">
              <label for="ledger-transaction-amount">金额</label>
              <div class="ledger-money-input">
                <span>{{ settings?.baseCurrency }}</span>
                <input id="ledger-transaction-amount" ref="amountInput" v-model="amount" name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" :disabled="saving" />
              </div>
              <small>输入正常货币金额，例如 {{ settings?.baseCurrency }} 38；无需输入 minor units。</small>
            </div>

            <template v-if="type !== 'transfer'">
              <div class="ledger-form-field">
                <label for="ledger-transaction-account">账户</label>
                <select id="ledger-transaction-account" v-model="accountId" name="accountId" required :disabled="saving">
                  <option value="" disabled>请选择账户</option>
                  <option v-for="account in activeAccounts" :key="account.id" :value="account.id">{{ account.name }} · {{ formatLedgerMoney(account.currentBalanceMinor, account.currency) }}</option>
                </select>
              </div>

              <div class="ledger-form-field">
                <div class="ledger-field-heading">
                  <label for="ledger-transaction-category">分类</label>
                  <button class="ledger-link-button" type="button" :disabled="saving || categorySaving" @click="categoryCreateOpen = !categoryCreateOpen">{{ categoryCreateOpen ? '选择已有分类' : '新建分类' }}</button>
                </div>
                <select id="ledger-transaction-category" v-model="categoryId" name="categoryId" :disabled="saving || categoryCreateOpen" :required="!categoryCreateOpen">
                  <option value="" disabled>{{ applicableCategories.length ? '请选择分类' : '暂无可用分类' }}</option>
                  <option v-for="category in applicableCategories" :key="category.id" :value="category.id">{{ categoryLabel(category) }}</option>
                </select>
                <small>只显示 active 的{{ type === 'income' ? '收入' : '支出' }}分类。</small>
                <div v-if="categoryCreateOpen" class="ledger-quick-create" data-testid="ledger-category-quick-create">
                  <label for="ledger-quick-category-name">新分类名称</label>
                  <div class="ledger-quick-create-row">
                    <input id="ledger-quick-category-name" v-model="categoryName" name="categoryName" type="text" autocomplete="off" :disabled="categorySaving" @keydown.enter.prevent="createCategory" />
                    <button class="ledger-secondary-button" type="button" :disabled="categorySaving" @click="createCategory">{{ categorySaving ? '正在创建…' : '创建' }}</button>
                  </div>
                  <small v-if="categoryError" class="ledger-form-error" role="alert">{{ categoryError }}</small>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="ledger-form-grid">
                <div class="ledger-form-field">
                  <label for="ledger-transaction-from-account">转出账户</label>
                  <select id="ledger-transaction-from-account" v-model="fromAccountId" name="fromAccountId" required :disabled="saving">
                    <option value="" disabled>请选择转出账户</option>
                    <option v-for="account in activeAccounts" :key="account.id" :value="account.id">{{ account.name }}</option>
                  </select>
                </div>
                <div class="ledger-form-field">
                  <label for="ledger-transaction-to-account">转入账户</label>
                  <select id="ledger-transaction-to-account" v-model="toAccountId" name="toAccountId" required :disabled="saving">
                    <option value="" disabled>请选择转入账户</option>
                    <option v-for="account in activeAccounts" :key="account.id" :value="account.id">{{ account.name }}</option>
                  </select>
                </div>
              </div>
              <small class="ledger-form-note">转出账户和转入账户不能相同。转账不使用分类或交易对象。</small>
            </template>

            <div class="ledger-form-field">
              <label for="ledger-transaction-occurred-at">发生时间</label>
              <input id="ledger-transaction-occurred-at" v-model="occurredAt" name="occurredAt" type="datetime-local" required :disabled="saving" />
              <small>按 Ledger 时区 {{ settings?.timezone }} 解释和显示。</small>
            </div>

            <div v-if="type !== 'transfer'" class="ledger-form-field">
              <label for="ledger-transaction-payee">交易对象（可选）</label>
              <input id="ledger-transaction-payee" v-model="payee" name="payee" type="text" autocomplete="off" :disabled="saving" />
            </div>

            <div class="ledger-form-field">
              <label for="ledger-transaction-note">备注（可选）</label>
              <textarea id="ledger-transaction-note" v-model="note" name="note" rows="3" :disabled="saving" />
            </div>

            <p v-if="!activeAccounts.length" class="ledger-form-error" role="alert">请先创建一个可用账户，再记账。</p>
            <p v-if="formError" class="ledger-form-error" role="alert">{{ formError }}</p>
            <div class="ledger-form-actions">
              <button class="ledger-secondary-button" type="button" :disabled="saving || categorySaving" @click="requestClose">取消</button>
              <button class="ledger-primary-button" type="submit" :disabled="!canSubmit">{{ saving ? '正在保存…' : '保存交易' }}</button>
            </div>
          </form>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.ledger-sheet-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: flex-end; justify-content: center; padding: 20px; box-sizing: border-box; background: color-mix(in srgb, #0f172a 35%, transparent); }
.ledger-sheet { display: grid; gap: 18px; width: min(100%, 620px); max-height: min(92vh, 820px); overflow: auto; padding: 24px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 16px 16px 10px 10px; background: var(--bg); color: var(--text); box-shadow: 0 20px 60px color-mix(in srgb, #0f172a 28%, transparent); }
.ledger-sheet-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ledger-eyebrow { margin: 0 0 5px; color: var(--accent); font-size: .72rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.ledger-sheet-header h2 { margin: 0; color: var(--text-h); font-size: 1.35rem; line-height: 1.25; }
.ledger-close-button { width: 32px; height: 32px; padding: 0; border: 1px solid var(--border); border-radius: 7px; background: transparent; color: var(--text-muted); font-size: 1.3rem; line-height: 1; cursor: pointer; }
.ledger-close-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-close-button:disabled { cursor: wait; opacity: .6; }
.ledger-entry-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 4px; border-radius: 9px; background: var(--bg-soft); }
.ledger-entry-type { min-height: 36px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text-muted); font: inherit; font-size: .84rem; cursor: pointer; }
.ledger-entry-type.is-selected { border-color: var(--border); background: var(--bg); color: var(--text-h); font-weight: 700; box-shadow: 0 1px 3px color-mix(in srgb, #0f172a 10%, transparent); }
.ledger-entry-type:disabled { cursor: wait; opacity: .6; }
.ledger-entry-form { display: grid; gap: 15px; }
.ledger-form-field { display: grid; gap: 6px; }
.ledger-form-field label { color: var(--text-h); font-size: .82rem; font-weight: 650; }
.ledger-form-field input,
.ledger-form-field select,
.ledger-form-field textarea { width: 100%; min-height: 38px; padding: 7px 10px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text-h); font: inherit; font-size: .87rem; }
.ledger-form-field textarea { resize: vertical; }
.ledger-form-field input:focus,
.ledger-form-field select:focus,
.ledger-form-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent); }
.ledger-form-field input:disabled,
.ledger-form-field select:disabled,
.ledger-form-field textarea:disabled { cursor: wait; opacity: .65; }
.ledger-form-field small,
.ledger-form-note { color: var(--text-muted); font-size: .74rem; line-height: 1.4; }
.ledger-money-input { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 3px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.ledger-money-input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent); }
.ledger-money-input span { color: var(--text-muted); font-size: .9rem; font-weight: 650; }
.ledger-money-input input { flex: 1; min-height: 34px; padding: 0; border: 0; outline: 0; background: transparent; color: var(--text-h); font: inherit; font-size: 1.05rem; }
.ledger-field-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ledger-link-button { padding: 0; border: 0; background: transparent; color: var(--accent); font: inherit; font-size: .76rem; cursor: pointer; }
.ledger-link-button:hover:not(:disabled) { text-decoration: underline; }
.ledger-link-button:disabled { cursor: wait; opacity: .6; }
.ledger-quick-create { display: grid; gap: 6px; margin-top: 3px; padding: 10px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--accent) 6%, transparent); }
.ledger-quick-create label { font-size: .78rem; }
.ledger-quick-create-row { display: flex; gap: 7px; }
.ledger-quick-create-row input { flex: 1; min-width: 0; }
.ledger-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ledger-form-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 3px; }
.ledger-primary-button,
.ledger-secondary-button { min-height: 39px; padding: 7px 14px; border-radius: 7px; font: inherit; font-size: .84rem; font-weight: 650; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
.ledger-form-error { margin: 0; color: #b42318; font-size: .81rem; line-height: 1.45; }
@media (max-width: 600px) {
  .ledger-sheet-backdrop { align-items: stretch; padding: 0; }
  .ledger-sheet { width: 100%; max-height: 100%; border-radius: 0; }
  .ledger-form-grid { grid-template-columns: 1fr; }
  .ledger-form-actions > * { flex: 1 1 140px; }
}
</style>
