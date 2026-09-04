<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LedgerAccountDto, LedgerAccountNature, LedgerAccountType } from '../../../shared/ledgerProtocol'
import { ledgerAccountTypeOptionsForNature } from '../../features/ledger/accountPresentation'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { useLedgerStore } from '../../features/ledger/ledgerStore'
import { formatLedgerMoney, ledgerDecimalFromMinor, parseLedgerMoney } from '../../features/ledger/money'

const props = withDefaults(defineProps<{
  account: LedgerAccountDto
  hasHistory: boolean
  cancelable?: boolean
}>(), { cancelable: true })

const emit = defineEmits<{ saved: [account: LedgerAccountDto]; cancel: [] }>()
const store = useLedgerStore()

const name = ref('')
const note = ref('')
const nature = ref<LedgerAccountNature>('asset')
const type = ref<LedgerAccountType>('bank')
const openingBalance = ref('0')
const openingDate = ref('')
const error = ref('')
const submitted = ref(false)
const saving = ref(false)

const financialFieldsEditable = computed(() => !props.hasHistory && props.account.archivedAt === null)
const typeOptions = computed(() => ledgerAccountTypeOptionsForNature(nature.value))

function reset(): void {
  name.value = props.account.name
  note.value = props.account.note
  nature.value = props.account.nature
  type.value = props.account.type
  openingBalance.value = ledgerDecimalFromMinor(props.account.openingBalanceMinor, props.account.currency)
  openingDate.value = props.account.openingDate
  error.value = ''
  submitted.value = false
}

watch(() => props.account, reset, { immediate: true })
watch(nature, (nextNature) => {
  if (!typeOptions.value.some((option) => option.value === type.value)) {
    type.value = typeOptions.value[0]?.value ?? (nextNature === 'asset' ? 'bank' : 'credit_card')
  }
})

function validate(): number | null {
  submitted.value = true
  error.value = ''
  if (!name.value.trim()) {
    error.value = '请给账户起一个容易识别的名称。'
    return null
  }
  if (!financialFieldsEditable.value) return 0
  if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate.value)) {
    error.value = '请选择有效的期初日期。'
    return null
  }
  try {
    return parseLedgerMoney(openingBalance.value.trim() || '0', props.account.currency)
  } catch {
    error.value = `请输入有效的${props.account.currency}金额。`
    return null
  }
}

async function submit(): Promise<void> {
  if (saving.value) return
  const parsedOpeningBalance = validate()
  if (parsedOpeningBalance === null) return
  saving.value = true
  error.value = ''
  try {
    const body = financialFieldsEditable.value
      ? {
          expectedVersion: props.account.version,
          name: name.value.trim(),
          note: note.value.trim(),
          type: type.value,
          nature: nature.value,
          openingBalanceMinor: parsedOpeningBalance,
          openingDate: openingDate.value,
        }
      : {
          expectedVersion: props.account.version,
          name: name.value.trim(),
          note: note.value.trim(),
        }
    const updated = await store.patchAccount(props.account.id, body)
    emit('saved', updated)
  } catch (cause) {
    error.value = ledgerErrorMessage(cause, '账户没有保存，请刷新后重试。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <form class="ledger-account-edit-form" data-testid="ledger-account-edit-form" :aria-busy="saving ? 'true' : undefined" @submit.prevent="submit">
    <div>
      <p class="ledger-eyebrow">账户设置</p>
      <h2>编辑 {{ props.account.name }}</h2>
      <p v-if="!financialFieldsEditable" class="ledger-form-info">
        {{ props.account.archivedAt !== null ? '账户已归档。' : '账户已有历史记录。' }} 当前只能修改名称和备注，避免改变已有财务解释。
      </p>
    </div>

    <div class="ledger-form-field">
      <label for="ledger-edit-account-name">账户名称</label>
      <input id="ledger-edit-account-name" v-model="name" name="name" type="text" required :disabled="saving" />
    </div>

    <div v-if="financialFieldsEditable" class="ledger-form-grid">
      <div class="ledger-form-field">
        <label for="ledger-edit-account-nature">账户性质</label>
        <select id="ledger-edit-account-nature" v-model="nature" name="nature" :disabled="saving">
          <option value="asset">资产（我拥有的）</option>
          <option value="liability">负债（我需要偿还的）</option>
        </select>
      </div>
      <div class="ledger-form-field">
        <label for="ledger-edit-account-type">账户类型</label>
        <select id="ledger-edit-account-type" v-model="type" name="type" :disabled="saving">
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
      <div class="ledger-form-field">
        <label for="ledger-edit-account-opening-balance">期初余额</label>
        <input id="ledger-edit-account-opening-balance" v-model="openingBalance" name="openingBalance" type="text" inputmode="decimal" :disabled="saving" />
      </div>
      <div class="ledger-form-field">
        <label for="ledger-edit-account-opening-date">期初日期</label>
        <input id="ledger-edit-account-opening-date" v-model="openingDate" name="openingDate" type="date" required :disabled="saving" />
      </div>
    </div>

    <div v-else class="ledger-readonly-fields" aria-label="只读账户解释">
      <span>性质：{{ props.account.nature === 'asset' ? '资产' : '负债' }}</span>
      <span>类型：{{ props.account.type }}</span>
      <span>期初余额：{{ formatLedgerMoney(props.account.openingBalanceMinor, props.account.currency) }}</span>
      <span>期初日期：{{ props.account.openingDate }}</span>
    </div>

    <div class="ledger-form-field">
      <label for="ledger-edit-account-note">备注（可选）</label>
      <textarea id="ledger-edit-account-note" v-model="note" name="note" rows="3" :disabled="saving" />
    </div>

    <p v-if="error" class="ledger-form-error" role="alert">{{ error }}</p>
    <div class="ledger-form-actions">
      <button v-if="props.cancelable" class="ledger-secondary-button" type="button" :disabled="saving" @click="emit('cancel')">取消</button>
      <button class="ledger-primary-button" type="submit" :disabled="saving">{{ saving ? '正在保存…' : '保存账户' }}</button>
    </div>
  </form>
</template>

<style scoped>
.ledger-account-edit-form { display: grid; gap: 18px; width: min(100%, 620px); box-sizing: border-box; padding: 28px; border: 1px solid var(--border); border-radius: 14px; background: var(--bg-soft); }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-account-edit-form h2 { margin: 0; color: var(--text-h); font-size: 1.35rem; }
.ledger-form-info { margin: 9px 0 0; color: var(--text-muted); font-size: .81rem; line-height: 1.5; }
.ledger-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.ledger-form-field { display: grid; gap: 6px; }
.ledger-form-field label { color: var(--text-h); font-size: .83rem; font-weight: 650; }
.ledger-form-field input,
.ledger-form-field select,
.ledger-form-field textarea { width: 100%; box-sizing: border-box; min-height: 38px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg); color: var(--text-h); font: inherit; font-size: .88rem; }
.ledger-form-field textarea { resize: vertical; }
.ledger-readonly-fields { display: flex; flex-wrap: wrap; gap: 7px 12px; color: var(--text-muted); font-size: .8rem; }
.ledger-readonly-fields span { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }
.ledger-form-error { margin: 0; color: #b42318; font-size: .82rem; }
.ledger-form-actions { display: flex; justify-content: flex-end; gap: 9px; }
.ledger-primary-button,
.ledger-secondary-button { min-height: 40px; padding: 8px 15px; border-radius: 7px; font: inherit; font-weight: 650; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
@media (max-width: 620px) {
  .ledger-account-edit-form { padding: 23px 18px; }
  .ledger-form-grid { grid-template-columns: 1fr; }
  .ledger-form-actions > * { flex: 1 1 150px; }
}
</style>
