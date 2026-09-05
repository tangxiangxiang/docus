<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import LedgerDashboard from '../components/ledger/LedgerDashboard.vue'
import LedgerFirstAccountForm from '../components/ledger/LedgerFirstAccountForm.vue'
import LedgerNoActiveAccountState from '../components/ledger/LedgerNoActiveAccountState.vue'
import LedgerOnboarding from '../components/ledger/LedgerOnboarding.vue'
import LedgerPendingCreateGate from '../components/ledger/LedgerPendingCreateGate.vue'
import LedgerTransactionSheet from '../components/ledger/LedgerTransactionSheet.vue'
import { ledgerErrorMessage } from '../features/ledger/ledgerErrors'
import { useLedgerStore, type LedgerOverviewRefreshResult } from '../features/ledger/ledgerStore'
import { parseLedgerRouteDate } from '../features/ledger/periodNavigation'

const auth = useAuth()
// The view is also mounted without a Router in focused component tests. The
// production route always provides both injections; the guards keep those
// tests on the existing bootstrap path without adding a second navigation
// implementation.
const router = useRouter() as ReturnType<typeof useRouter> | undefined
const route = useRoute() as RouteLocationNormalizedLoaded | undefined
const store = useLedgerStore()
const newAccountOpen = ref(false)
const transactionSheetOpen = ref(false)

const bootstrapping = computed(() => store.workspaceState.value === 'BOOTSTRAPPING')
const showOnboarding = computed(() => store.workspaceState.value === 'UNINITIALIZED' || store.workspaceState.value === 'FIRST_ACCOUNT_REQUIRED')

type RouteDateSnapshot = {
  readonly token: string
  readonly date: string | undefined
  readonly invalid: boolean
}

let hasBootstrapped = false
let routeSyncRunning = false
let routeSyncRequested = false

function routeDateSnapshot(): RouteDateSnapshot {
  const raw = route?.query.date
  if (raw === undefined) return { token: '', date: undefined, invalid: false }
  if (typeof raw !== 'string') return { token: JSON.stringify(raw), date: undefined, invalid: true }
  const date = parseLedgerRouteDate(raw)
  return { token: raw, date: date ?? undefined, invalid: date === null }
}

function routeStillMatches(snapshot: RouteDateSnapshot): boolean {
  return routeDateSnapshot().token === snapshot.token
}

function isFutureAnchorResult(result: LedgerOverviewRefreshResult | undefined): boolean {
  return result?.status === 'error'
    && result.error.code === 'ledger-validation-failed'
    && result.error.details?.field === 'anchorDate'
}

async function syncRouteDate(snapshot: RouteDateSnapshot): Promise<void> {
  if (!route || !router) {
    if (!hasBootstrapped) {
      hasBootstrapped = true
      await store.bootstrap()
    }
    return
  }

  if (snapshot.invalid) {
    store.setOverviewRequestContext({ scope: store.overviewScope.value, anchorDate: undefined })
    if (routeStillMatches(snapshot)) await router.replace({ name: 'ledger', hash: route.hash })
    return
  }

  store.setOverviewRequestContext({ scope: store.overviewScope.value, anchorDate: snapshot.date })
  let result: LedgerOverviewRefreshResult | undefined
  if (!hasBootstrapped) {
    hasBootstrapped = true
    result = await store.bootstrap()
  } else {
    result = await store.refreshOverview()
  }

  // A newer browser navigation owns the route. An older request may finish,
  // but it must not canonicalize or otherwise interpret the newer route.
  if (!routeStillMatches(snapshot)) return

  if (isFutureAnchorResult(result)) {
    // The failed bootstrap may not have published Settings/Accounts because
    // the Overview request was part of the same load. Let the canonical
    // follow-up perform a complete bootstrap rather than rendering the error
    // state after the invalid future URL has been removed.
    hasBootstrapped = false
    await router.replace({ name: 'ledger', hash: route.hash })
    return
  }

  if (snapshot.date !== undefined
    && result?.status === 'success'
    && result.overview.context.isToday
    && result.overview.context.anchorDate === snapshot.date) {
    await router.replace({ name: 'ledger', hash: route.hash })
  }
}

async function drainRouteSync(): Promise<void> {
  if (routeSyncRunning) return
  routeSyncRunning = true
  try {
    while (routeSyncRequested) {
      routeSyncRequested = false
      await syncRouteDate(routeDateSnapshot())
    }
  } finally {
    routeSyncRunning = false
    if (routeSyncRequested) void drainRouteSync()
  }
}

function requestRouteSync(): void {
  routeSyncRequested = true
  void drainRouteSync()
}

watch(() => auth.user.value?.username ?? null, (identity) => store.setOwnerIdentity(identity), { immediate: true })

if (route && router) watch(() => route.query.date, requestRouteSync, { immediate: true })
else onMounted(requestRouteSync)

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
  if (router) void router.push({ name: 'ledger-transactions' })
}

function selectDate(date: string): void {
  if (!router) return
  const parsed = parseLedgerRouteDate(date)
  if (parsed === null) return
  void router.push({ name: 'ledger', query: { date: parsed }, hash: route?.hash })
}

function returnToday(): void {
  if (router) void router.push({ name: 'ledger', hash: route?.hash })
}

function onRecoveryResolved(): void {
  transactionSheetOpen.value = false
  newAccountOpen.value = false
}

function closeTransactionSheet(): void {
  transactionSheetOpen.value = false
}
</script>

<template>
  <main class="ledger-page" data-testid="ledger-page">
    <div v-if="bootstrapping" class="ledger-loading-state" data-testid="ledger-loading" role="status" aria-live="polite">
      正在加载 Ledger…
    </div>

    <LedgerPendingCreateGate v-else-if="store.recoveryGateVisible.value" @resolved="onRecoveryResolved" />

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

    <LedgerDashboard
      v-else
      @record="transactionSheetOpen = true"
      @view-transactions="openTransactions"
      @select-date="selectDate"
      @return-today="returnToday"
    />

    <LedgerTransactionSheet v-if="!store.recoveryGateVisible.value" :open="transactionSheetOpen" @close="closeTransactionSheet" />
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
