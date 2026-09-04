<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LedgerAccountNature, LedgerAccountType } from '../../../shared/ledgerProtocol'
import { ledgerAccountTypeOptionsForNature } from '../../features/ledger/accountPresentation'
import { ledgerErrorMessage, ledgerFieldError } from '../../features/ledger/ledgerErrors'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import { formatLedgerMoney, parseLedgerMoney } from '../../features/ledger/money'
import { openingDateInputFromInstant } from '../../features/ledger/time'

const props = withDefaults(defineProps<{
  firstAccount?: boolean
  cancelable?: boolean
}>(), {
  firstAccount: true,
  cancelable: false,
})

const emit = defineEmits<{
  saved: []
  'edit-settings': []
  cancel: []
}>()

const store = useLedgerStore()
const name = ref('')
const nature = ref<LedgerAccountNature>('asset')
const type = ref<LedgerAccountType>('bank')
const openingBalance = ref('0')
const openingDate = ref('')
const note = ref('')
const formError = ref('')
const submitted = ref(false)
const saving = ref(false)

const settings = computed(() => store.settings.value)
const currency = computed(() => settings.value?.baseCurrency ?? '')
const currencyExponent = computed(() => settings.value?.currencyExponent ?? 2)
const typeOptions = computed(() => ledgerAccountTypeOptionsForNature(nature.value))
const balanceExample = computed(() => currency.value ? formatLedgerMoney(100, currency.value) : '金额')

function resetOpeningDate(): void {
  if (!settings.value?.timezone) return
  openingDate.value = openingDateInputFromInstant(Date.now(), settings.value.timezone)
}

watch(
  () => settings.value?.timezone,
  (timezone, previous) => {
    if (timezone && (!openingDate.value || timezone !== previous)) resetOpeningDate()
  },
  { immediate: true },
)

watch(nature, (nextNature) => {
  if (!typeOptions.value.some((option) => option.value === type.value)) {
    type.value = typeOptions.value[0]?.value ?? (nextNature === 'asset' ? 'bank' : 'credit_card')
  }
})

function fieldError(field: string): string | null {
  if (!submitted.value || !store.error.value) return null
  return ledgerFieldError(store.error.value, field)
}

function validate(): number | null {
  submitted.value = true
  formError.value = ''
  if (!name.value.trim()) {
    formError.value = '请给账户起一个容易识别的名称。'
    return null
  }
  if (!currency.value) {
    formError.value = '请先完成 Ledger 基础设置。'
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate.value)) {
    formError.value = '请选择有效的期初日期。'
    return null
  }
  try {
    return parseLedgerMoney(openingBalance.value.trim() || '0', currency.value)
  } catch {
    formError.value = `请输入有效的${currency.value}金额（最多 ${currencyExponent.value} 位小数）。`
    return null
  }
}

async function submit(): Promise<void> {
  if (saving.value) return
  const openingBalanceMinor = validate()
  if (openingBalanceMinor === null || !settings.value) return
  saving.value = true
  formError.value = ''
  try {
    await store.createAccount({
      name: name.value.trim(),
      type: type.value,
      nature: nature.value,
      openingBalanceMinor,
      openingDate: openingDate.value,
      currency: currency.value,
      note: note.value.trim(),
    })
    emit('saved')
  } catch (error) {
    formError.value = ledgerErrorMessage(error, '账户没有保存，请检查后重试。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form
    class="ledger-onboarding-card"
    data-testid="ledger-account-form"
    :aria-busy="saving ? 'true' : undefined"
    @submit.prevent="submit"
  >
    <div>
      <p class="ledger-eyebrow">{{ props.firstAccount ? '第二步 · 第一个账户' : '新增账户' }}</p>
      <h2>{{ props.firstAccount ? '先加入一个账户' : '创建新账户' }}</h2>
      <p class="ledger-intro">
        账户是 Ledger 记录余额的地方。期初余额表示从期初日期开始、你希望 Ledger 采用的当前余额；没有期初余额时可以保留为 0。
      </p>
      <p v-if="currency" class="ledger-context">当前 Ledger：{{ currency }} · {{ settings?.timezone }}</p>
    </div>

    <div class="ledger-form-field">
      <label for="ledger-account-name">账户名称</label>
      <input
        id="ledger-account-name"
        v-model="name"
        name="name"
        type="text"
        autocomplete="off"
        required
        :disabled="saving"
        :aria-invalid="fieldError('name') ? 'true' : undefined"
      />
    </div>

    <div class="ledger-form-grid">
      <div class="ledger-form-field">
        <label for="ledger-account-nature">账户性质</label>
        <select id="ledger-account-nature" v-model="nature" name="nature" :disabled="saving">
          <option value="asset">资产（我拥有的）</option>
          <option value="liability">负债（我需要偿还的）</option>
        </select>
        <small>资产会增加你的净资产；负债表示你欠下的金额。</small>
      </div>
      <div class="ledger-form-field">
        <label for="ledger-account-type">账户类型</label>
        <select id="ledger-account-type" v-model="type" name="type" :disabled="saving">
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
        <small>选择最接近这个账户的日常称呼。</small>
      </div>
    </div>

    <div class="ledger-form-grid">
      <div class="ledger-form-field">
        <label for="ledger-account-opening-balance">期初余额</label>
        <input
          id="ledger-account-opening-balance"
          v-model="openingBalance"
          name="openingBalance"
          type="text"
          inputmode="decimal"
          :placeholder="balanceExample"
          :disabled="saving"
          :aria-invalid="fieldError('openingBalanceMinor') ? 'true' : undefined"
        />
        <small>输入 {{ currency }} 金额；可使用负数，留空按 0 处理。</small>
      </div>
      <div class="ledger-form-field">
        <label for="ledger-account-opening-date">期初日期</label>
        <input
          id="ledger-account-opening-date"
          v-model="openingDate"
          name="openingDate"
          type="date"
          required
          :disabled="saving"
          :aria-invalid="fieldError('openingDate') ? 'true' : undefined"
        />
        <small>默认使用 Ledger 时区的今天。</small>
      </div>
    </div>

    <div class="ledger-form-field">
      <label for="ledger-account-currency">账户货币</label>
      <input id="ledger-account-currency" :value="currency" name="currency" type="text" readonly aria-readonly="true" />
      <small>账户货币继承 Ledger 基础货币；L1 不支持账户间换汇。</small>
    </div>

    <div class="ledger-form-field">
      <label for="ledger-account-note">备注（可选）</label>
      <textarea id="ledger-account-note" v-model="note" name="note" rows="3" :disabled="saving" />
    </div>

    <p v-if="formError" class="ledger-form-error" role="alert">{{ formError }}</p>

    <div class="ledger-form-actions">
      <button v-if="props.cancelable" class="ledger-secondary-button" type="button" :disabled="saving" @click="emit('cancel')">取消</button>
      <button v-if="!props.firstAccount && !settings?.hasCreatedAccount" class="ledger-secondary-button" type="button" :disabled="saving" @click="emit('edit-settings')">修改 Ledger 设置</button>
      <button class="ledger-primary-button" type="submit" :disabled="saving">
        {{ saving ? '正在保存…' : (props.firstAccount ? '创建账户并继续' : '创建账户') }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.ledger-onboarding-card { display: grid; gap: 18px; width: min(100%, 620px); box-sizing: border-box; padding: 30px; border: 1px solid var(--border); border-radius: 14px; background: var(--bg-soft); box-shadow: 0 12px 36px color-mix(in srgb, #0f172a 12%, transparent); }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-onboarding-card h2 { margin: 0; color: var(--text-h); font-size: 1.45rem; line-height: 1.3; }
.ledger-intro { margin: 10px 0 0; color: var(--text-muted); font-size: .86rem; line-height: 1.55; }
.ledger-context { margin: 10px 0 0; color: var(--text); font-size: .8rem; font-weight: 600; }
.ledger-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.ledger-form-field { display: grid; gap: 6px; }
.ledger-form-field label { color: var(--text-h); font-size: .83rem; font-weight: 650; }
.ledger-form-field input,
.ledger-form-field select,
.ledger-form-field textarea { width: 100%; box-sizing: border-box; min-height: 38px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text-h); font: inherit; font-size: .88rem; }
.ledger-form-field textarea { resize: vertical; }
.ledger-form-field input:focus,
.ledger-form-field select:focus,
.ledger-form-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent); }
.ledger-form-field input[readonly] { background: var(--bg-soft); color: var(--text-muted); }
.ledger-form-field input:disabled,
.ledger-form-field select:disabled,
.ledger-form-field textarea:disabled { cursor: wait; opacity: .65; }
.ledger-form-field small { color: var(--text-muted); font-size: .75rem; line-height: 1.45; }
.ledger-form-error { margin: 0; color: #b42318; font-size: .82rem; line-height: 1.45; }
.ledger-form-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 9px; }
.ledger-primary-button,
.ledger-secondary-button { min-height: 40px; padding: 8px 15px; border-radius: 7px; font: inherit; font-weight: 650; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
@media (max-width: 620px) {
  .ledger-onboarding-card { padding: 23px 18px; }
  .ledger-form-grid { grid-template-columns: 1fr; }
  .ledger-form-actions > * { flex: 1 1 160px; }
}
</style>
