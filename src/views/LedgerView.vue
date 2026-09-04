<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import LedgerDashboard from '../components/ledger/LedgerDashboard.vue'
import LedgerFirstAccountForm from '../components/ledger/LedgerFirstAccountForm.vue'
import LedgerNoActiveAccountState from '../components/ledger/LedgerNoActiveAccountState.vue'
import LedgerOnboarding from '../components/ledger/LedgerOnboarding.vue'
import LedgerTransactionSheet from '../components/ledger/LedgerTransactionSheet.vue'
import { ledgerErrorMessage } from '../features/ledger/ledgerErrors'
import { useLedgerStore } from '../features/ledger/ledgerStore'

const auth = useAuth()
const router = useRouter()
const store = useLedgerStore()
const newAccountOpen = ref(false)
const transactionSheetOpen = ref(false)

const bootstrapping = computed(() => store.workspaceState.value === 'BOOTSTRAPPING')
const showOnboarding = computed(() => store.workspaceState.value === 'UNINITIALIZED' || store.workspaceState.value === 'FIRST_ACCOUNT_REQUIRED')

watch(() => auth.user.value?.username ?? null, (identity) => store.setOwnerIdentity(identity), { immediate: true })

onMounted(() => {
  void store.bootstrap()
})

function openNewAccount(): void {
  newAccountOpen.value = true
}

function closeNewAccount(): void {
  newAccountOpen.value = false
}

function retry(): void {
  void store.bootstrap()
}

function openTransactions(): void {
  void router.push({ name: 'ledger-transactions' })
}
</script>

<template>
  <main class="ledger-page" data-testid="ledger-page">
    <div v-if="bootstrapping" class="ledger-loading-state" data-testid="ledger-loading" role="status" aria-live="polite">
      正在加载 Ledger…
    </div>

    <section v-else-if="store.workspaceState.value === 'RECOVERABLE_ERROR'" class="ledger-error-state" data-testid="ledger-bootstrap-error" aria-labelledby="ledger-bootstrap-error-title">
      <h1 id="ledger-bootstrap-error-title">Ledger 暂时无法打开</h1>
      <p>{{ ledgerErrorMessage(store.error.value, '请检查网络后重试。') }}</p>
      <button class="ledger-primary-button" type="button" @click="retry">重新加载</button>
    </section>

    <LedgerOnboarding
      v-else-if="showOnboarding"
      :initial-step="store.workspaceState.value === 'UNINITIALIZED' ? 'settings' : 'account'"
    />

    <template v-else-if="store.workspaceState.value === 'NO_ACTIVE_ACCOUNT'">
      <LedgerFirstAccountForm
        v-if="newAccountOpen"
        :first-account="false"
        cancelable
        @cancel="closeNewAccount"
        @edit-settings="closeNewAccount"
      />
      <LedgerNoActiveAccountState v-else @create="openNewAccount" />
    </template>

    <LedgerDashboard v-else @record="transactionSheetOpen = true" @view-transactions="openTransactions" />

    <LedgerTransactionSheet :open="transactionSheetOpen" @close="transactionSheetOpen = false" />
  </main>
</template>

<style scoped>
.ledger-page { min-height: calc(100vh - 52px); background: var(--bg); }
.ledger-loading-state,
.ledger-error-state,
.ledger-ready-placeholder { display: grid; min-height: 420px; place-items: center; align-content: center; gap: 12px; padding: 32px 18px; box-sizing: border-box; color: var(--text-muted); text-align: center; }
.ledger-error-state h1,
.ledger-ready-placeholder h1 { margin: 0; color: var(--text-h); font-size: 1.5rem; }
.ledger-error-state p,
.ledger-ready-placeholder p { margin: 0; }
.ledger-eyebrow { margin: 0; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-primary-button { min-height: 38px; padding: 7px 14px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: #fff; font: inherit; font-weight: 650; cursor: pointer; }
.ledger-primary-button:hover { background: var(--accent-hover); }
</style>
