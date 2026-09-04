<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LedgerFirstAccountForm from './LedgerFirstAccountForm.vue'
import LedgerInitializationForm from './LedgerInitializationForm.vue'
import LedgerPendingCreateRecovery from './LedgerPendingCreateRecovery.vue'
import { ledgerErrorMessage } from '../../features/ledger/ledgerErrors'
import { useLedgerStore } from '../../features/ledger/ledgerStore'

const props = defineProps<{ initialStep: 'settings' | 'account' }>()
const store = useLedgerStore()
const step = ref(props.initialStep)
const recoveryError = ref('')

watch(() => props.initialStep, (next) => { step.value = next })

const pendingOnboardingIntent = computed(() => {
  const pending = store.pendingCreate.value
  return pending && (pending.operation === 'settings' || pending.operation === 'account') ? pending : null
})
const recoveryBusy = computed(() => store.mutationState.value === 'SUBMITTING')

function showSettings(): void {
  if (store.settings.value?.hasCreatedAccount) return
  recoveryError.value = ''
  step.value = 'settings'
}

function settingsSaved(): void {
  recoveryError.value = ''
  step.value = 'account'
}

async function retryRecovery(): Promise<void> {
  recoveryError.value = ''
  try {
    await store.retryPendingCreate()
    if (store.pendingCreate.value === null && store.settings.value && !store.settings.value.hasCreatedAccount) {
      step.value = 'account'
    }
  } catch (error) {
    recoveryError.value = ledgerErrorMessage(error, '上一次操作仍未确认，请稍后再试。')
  }
}
</script>

<template>
  <section class="ledger-onboarding" data-testid="ledger-onboarding" aria-labelledby="ledger-onboarding-title">
    <div class="ledger-onboarding-heading">
      <div>
        <p class="ledger-eyebrow">Ledger 首次使用</p>
        <h1 id="ledger-onboarding-title">把 Ledger 设置成你的账本</h1>
      </div>
      <ol class="ledger-onboarding-steps" aria-label="Ledger 设置步骤">
        <li :class="{ 'is-current': step === 'settings', 'is-complete': step === 'account' }">1. 基础设置</li>
        <li :class="{ 'is-current': step === 'account' }">2. 第一个账户</li>
      </ol>
    </div>

    <LedgerPendingCreateRecovery
      v-if="pendingOnboardingIntent"
      :intent="pendingOnboardingIntent"
      :busy="recoveryBusy"
      :error="recoveryError"
      @retry="retryRecovery"
    />
    <LedgerInitializationForm v-else-if="step === 'settings'" @saved="settingsSaved" />
    <LedgerFirstAccountForm v-else @edit-settings="showSettings" />
  </section>
</template>

<style scoped>
.ledger-onboarding { display: grid; gap: 24px; width: min(100%, 980px); margin: 0 auto; padding: 46px 28px 64px; box-sizing: border-box; }
.ledger-onboarding-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; }
.ledger-eyebrow { margin: 0 0 6px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-onboarding-heading h1 { margin: 0; color: var(--text-h); font-size: clamp(1.7rem, 3vw, 2.2rem); line-height: 1.2; }
.ledger-onboarding-steps { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; color: var(--text-muted); font-size: .78rem; }
.ledger-onboarding-steps li { padding: 5px 9px; border: 1px solid var(--border); border-radius: 999px; }
.ledger-onboarding-steps li.is-current { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); font-weight: 650; }
.ledger-onboarding-steps li.is-complete { color: var(--text); }
@media (max-width: 680px) {
  .ledger-onboarding { padding: 30px 16px 48px; }
  .ledger-onboarding-heading { align-items: flex-start; flex-direction: column; gap: 16px; }
}
</style>
