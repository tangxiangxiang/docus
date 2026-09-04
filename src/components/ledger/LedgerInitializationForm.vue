<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  LEDGER_CURRENCY_METADATA,
} from '../../../shared/ledgerCurrency'
import { browserTimezone } from '../../features/ledger/time'
import { ledgerErrorMessage, ledgerFieldError } from '../../features/ledger/ledgerErrors'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import LedgerPendingCreateRecovery from './LedgerPendingCreateRecovery.vue'

const store = useLedgerStore()
const emit = defineEmits<{ saved: [] }>()

const baseCurrency = ref('')
const timezone = ref(browserTimezone())
const formError = ref('')
const submitted = ref(false)
const saving = ref(false)

const currentSettings = computed(() => store.settings.value)
const isEditing = computed(() => currentSettings.value !== null)
const isLocked = computed(() => currentSettings.value?.hasCreatedAccount === true)
const pendingSettings = computed(() => (
  store.pendingCreate.value?.operation === 'settings' ? store.pendingCreate.value : null
))

const commonTimezones = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/Los_Angeles',
  'America/New_York',
]
const timezoneOptions = computed(() => {
  const values = new Set(commonTimezones)
  if (timezone.value) values.add(timezone.value)
  return [...values]
})

const currencyOptions = LEDGER_CURRENCY_METADATA.map((entry) => ({
  ...entry,
  label: entry.code === 'CNY'
    ? 'CNY — 人民币'
    : entry.code === 'JPY'
      ? 'JPY — 日元'
      : entry.code === 'KWD'
        ? 'KWD — 科威特第纳尔'
        : entry.code,
}))

function resetFromSettings(): void {
  const settings = currentSettings.value
  baseCurrency.value = settings?.baseCurrency ?? ''
  timezone.value = settings?.timezone ?? browserTimezone()
  formError.value = ''
  submitted.value = false
}

watch(currentSettings, resetFromSettings, { immediate: true })

function fieldError(field: string): string | null {
  if (!submitted.value || !store.error.value) return null
  return ledgerFieldError(store.error.value, field)
}

function validate(): boolean {
  submitted.value = true
  formError.value = ''
  if (!baseCurrency.value) {
    formError.value = '请选择 Ledger 的基础货币。'
    return false
  }
  if (!timezone.value.trim()) {
    formError.value = '请选择或输入 Ledger 时区。'
    return false
  }
  return true
}

async function submit(): Promise<void> {
  if (saving.value || isLocked.value || !validate()) return
  saving.value = true
  formError.value = ''
  try {
    if (isEditing.value && currentSettings.value) {
      await store.patchSettings({
        expectedVersion: currentSettings.value.version,
        baseCurrency: baseCurrency.value,
        timezone: timezone.value.trim(),
      })
    } else {
      await store.createSettings({
        baseCurrency: baseCurrency.value,
        timezone: timezone.value.trim(),
      })
    }
    emit('saved')
  } catch (error) {
    formError.value = ledgerErrorMessage(error, 'Ledger 设置没有保存，请检查后重试。')
  } finally {
    saving.value = false
  }
}

async function retryPendingSettings(): Promise<void> {
  if (saving.value) return
  saving.value = true
  formError.value = ''
  try {
    await store.retryPendingCreate()
    emit('saved')
  } catch (error) {
    formError.value = ledgerErrorMessage(error, 'Ledger 设置仍未确认，请稍后重试。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form
    class="ledger-onboarding-card"
    data-testid="ledger-settings-form"
    :aria-busy="saving ? 'true' : undefined"
    @submit.prevent="submit"
  >
    <div>
      <p class="ledger-eyebrow">{{ isEditing ? 'Ledger 设置' : '开始使用 Ledger' }}</p>
      <h2>{{ isEditing ? '确认 Ledger 设置' : '先设置你的 Ledger' }}</h2>
      <p class="ledger-intro">
        基础货币决定金额的表达方式，时区决定交易时间和 Today / Week / Month / Year 的所属边界。
        这两个值会成为 Ledger 的基础设置；创建第一个账户后将锁定。
      </p>
    </div>

    <div v-if="isLocked" class="ledger-info" role="status">
      Ledger 已经创建过账户，基础货币和时区已锁定。请返回账户流程继续。
    </div>

    <LedgerPendingCreateRecovery
      v-if="pendingSettings"
      :intent="pendingSettings"
      :busy="saving"
      :error="formError"
      @retry="retryPendingSettings"
    />

    <template v-else-if="!isLocked">
      <div class="ledger-form-field">
        <label for="ledger-base-currency">基础货币</label>
        <select
          id="ledger-base-currency"
          v-model="baseCurrency"
          name="baseCurrency"
          required
          :disabled="saving"
          :aria-invalid="fieldError('baseCurrency') ? 'true' : undefined"
          :aria-describedby="fieldError('baseCurrency') ? 'ledger-base-currency-error' : 'ledger-base-currency-help'"
        >
          <option value="" disabled>请选择货币</option>
          <option v-for="option in currencyOptions" :key="option.code" :value="option.code">
            {{ option.label }}（{{ option.exponent }} 位小数）
          </option>
        </select>
        <small id="ledger-base-currency-help">金额会按该货币的实际小数位显示；例如 JPY 不使用两位小数。</small>
        <small v-if="fieldError('baseCurrency')" id="ledger-base-currency-error" class="ledger-field-error">{{ fieldError('baseCurrency') }}</small>
      </div>

      <div class="ledger-form-field">
        <label for="ledger-timezone">Ledger 时区</label>
        <input
          id="ledger-timezone"
          v-model="timezone"
          name="timezone"
          list="ledger-timezone-options"
          required
          autocomplete="off"
          :disabled="saving"
          :aria-invalid="fieldError('timezone') ? 'true' : undefined"
          :aria-describedby="fieldError('timezone') ? 'ledger-timezone-error' : 'ledger-timezone-help'"
        />
        <datalist id="ledger-timezone-options">
          <option v-for="option in timezoneOptions" :key="option" :value="option" />
        </datalist>
        <small id="ledger-timezone-help">已预选浏览器时区，仅作为提示；请确认它符合你记录 Ledger 的时间习惯。</small>
        <small v-if="fieldError('timezone')" id="ledger-timezone-error" class="ledger-field-error">{{ fieldError('timezone') }}</small>
      </div>

      <p v-if="formError" class="ledger-form-error" role="alert">{{ formError }}</p>

      <button class="ledger-primary-button" type="submit" :disabled="saving">
        {{ saving ? '正在保存…' : (isEditing ? '确认并继续' : '保存设置并继续') }}
      </button>
    </template>
  </form>
</template>

<style scoped>
.ledger-onboarding-card {
  display: grid;
  gap: 20px;
  width: min(100%, 560px);
  box-sizing: border-box;
  padding: 30px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg-soft);
  box-shadow: 0 12px 36px color-mix(in srgb, #0f172a 12%, transparent);
}
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-onboarding-card h2 { margin: 0; color: var(--text-h); font-size: 1.45rem; line-height: 1.3; }
.ledger-intro { margin: 10px 0 0; color: var(--text-muted); font-size: .86rem; line-height: 1.55; }
.ledger-form-field { display: grid; gap: 6px; }
.ledger-form-field label { color: var(--text-h); font-size: .83rem; font-weight: 650; }
.ledger-form-field input,
.ledger-form-field select {
  width: 100%;
  box-sizing: border-box;
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  color: var(--text-h);
  font: inherit;
  font-size: .88rem;
}
.ledger-form-field input:focus,
.ledger-form-field select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent); }
.ledger-form-field input:disabled,
.ledger-form-field select:disabled { cursor: wait; opacity: .65; }
.ledger-form-field small { color: var(--text-muted); font-size: .75rem; line-height: 1.45; }
.ledger-field-error,
.ledger-form-error { color: #b42318 !important; }
.ledger-info { padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 8px; background: color-mix(in srgb, var(--accent) 7%, transparent); color: var(--text); font-size: .82rem; }
.ledger-primary-button { min-height: 40px; padding: 8px 16px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: #fff; font: inherit; font-weight: 650; cursor: pointer; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-primary-button:disabled { cursor: wait; opacity: .65; }
@media (max-width: 560px) {
  .ledger-onboarding-card { padding: 23px 18px; }
}
</style>
