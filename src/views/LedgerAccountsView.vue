<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import LedgerFirstAccountForm from '../components/ledger/LedgerFirstAccountForm.vue'
import LedgerPendingCreateGate from '../components/ledger/LedgerPendingCreateGate.vue'
import { ledgerAccountTypeOptionsForNature } from '../features/ledger/accountPresentation'
import { ledgerErrorMessage } from '../features/ledger/ledgerErrors'
import { formatLedgerMoney } from '../features/ledger/money'
import { useLedgerStore } from '../features/ledger/ledgerStore'

const store = useLedgerStore()
const createOpen = ref(false)
const restoreId = ref<string | null>(null)
const actionError = ref('')

// Keep an open create form mounted while its successful mutation refreshes the
// shared read model. Otherwise refreshData's loading flag would unmount the
// form before it can emit `saved`, leaving the user on a stale draft.
const loading = computed(() => store.workspaceState.value === 'BOOTSTRAPPING' || (store.loading.value && !createOpen.value))
const typeLabels = new Map(
  ledgerAccountTypeOptionsForNature('asset').concat(ledgerAccountTypeOptionsForNature('liability'))
    .map((option) => [option.value, option.label]),
)

onMounted(() => { void store.bootstrap() })

function typeLabel(type: string): string {
  return typeLabels.get(type as never) ?? type
}

function balance(account: { currentBalanceMinor: number; currency: string }): string {
  return formatLedgerMoney(account.currentBalanceMinor, account.currency)
}

async function restore(id: string, version: number): Promise<void> {
  if (restoreId.value) return
  restoreId.value = id
  actionError.value = ''
  try {
    await store.restoreAccount(id, version)
  } catch (cause) {
    actionError.value = ledgerErrorMessage(cause, '账户没有恢复，请刷新后重试。')
  } finally {
    restoreId.value = null
  }
}

function onAccountSaved(): void {
  createOpen.value = false
  actionError.value = ''
}
</script>

<template>
  <main class="ledger-page ledger-accounts-page" data-testid="ledger-accounts-page">
    <header class="ledger-page-header">
      <div>
        <p class="ledger-eyebrow">Ledger</p>
        <h1>账户</h1>
        <p>查看余额、维护账户，或恢复已归档账户。</p>
      </div>
      <div class="ledger-page-actions">
        <RouterLink class="ledger-secondary-button" :to="{ name: 'ledger' }">返回总览</RouterLink>
        <button class="ledger-primary-button" type="button" :disabled="loading || store.hasUnresolvedCreate.value" @click="createOpen = true">新增账户</button>
      </div>
    </header>

    <LedgerPendingCreateGate v-if="store.recoveryGateVisible.value" @resolved="onAccountSaved" />
    <div v-else-if="loading" class="ledger-state-panel" data-testid="ledger-accounts-loading" role="status">正在加载账户…</div>
    <section v-else-if="store.workspaceState.value === 'RECOVERABLE_ERROR'" class="ledger-state-panel" data-testid="ledger-accounts-error" role="alert">
      <h2>账户暂时无法加载</h2>
      <p>{{ ledgerErrorMessage(store.error.value, '请检查网络后重试。') }}</p>
      <button class="ledger-primary-button" type="button" @click="store.bootstrap">重新加载</button>
    </section>
    <section v-else-if="!store.settings.value" class="ledger-state-panel" data-testid="ledger-accounts-needs-settings">
      <h2>请先设置 Ledger</h2>
      <p>完成基础货币和时区设置后，才能管理账户。</p>
      <RouterLink class="ledger-primary-button" :to="{ name: 'ledger' }">去设置 Ledger</RouterLink>
    </section>
    <template v-else-if="createOpen">
      <LedgerFirstAccountForm :first-account="false" cancelable @cancel="createOpen = false" @saved="onAccountSaved" />
    </template>
    <template v-else>
      <p v-if="actionError" class="ledger-form-error" role="alert">{{ actionError }}</p>

      <section class="ledger-account-section" aria-labelledby="ledger-active-accounts-title">
        <div class="ledger-section-heading">
          <div>
            <h2 id="ledger-active-accounts-title">可用账户</h2>
            <p>新增交易时只能选择这些账户。</p>
          </div>
          <span class="ledger-count">{{ store.activeAccounts.value.length }}</span>
        </div>
        <div v-if="store.activeAccounts.value.length" class="ledger-account-list" data-testid="ledger-active-account-list">
          <RouterLink
            v-for="account in store.activeAccounts.value"
            :key="account.id"
            class="ledger-account-row"
            :to="{ name: 'ledger-account', params: { id: account.id } }"
            :data-testid="`ledger-account-row-${account.id}`"
          >
            <span class="ledger-account-name">
              <strong>{{ account.name }}</strong>
              <small>{{ account.nature === 'asset' ? '资产' : '负债' }} · {{ typeLabel(account.type) }}</small>
            </span>
            <strong class="ledger-account-balance">{{ balance(account) }}</strong>
          </RouterLink>
        </div>
        <div v-else class="ledger-inline-empty" data-testid="ledger-active-account-empty">
          <p>还没有可用账户。</p>
          <button class="ledger-secondary-button" type="button" @click="createOpen = true">创建账户</button>
        </div>
      </section>

      <section v-if="store.archivedAccounts.value.length" class="ledger-account-section" aria-labelledby="ledger-archived-accounts-title">
        <div class="ledger-section-heading">
          <div>
            <h2 id="ledger-archived-accounts-title">已归档账户</h2>
            <p>历史记录仍然保留；恢复后可以再次用于记账。</p>
          </div>
          <span class="ledger-count">{{ store.archivedAccounts.value.length }}</span>
        </div>
        <div class="ledger-account-list" data-testid="ledger-archived-account-list">
          <div v-for="account in store.archivedAccounts.value" :key="account.id" class="ledger-account-row is-archived">
            <RouterLink class="ledger-account-name" :to="{ name: 'ledger-account', params: { id: account.id } }">
              <strong>{{ account.name }}</strong>
              <small>已归档 · {{ account.nature === 'asset' ? '资产' : '负债' }} · {{ typeLabel(account.type) }}</small>
            </RouterLink>
            <div class="ledger-row-actions">
              <strong class="ledger-account-balance">{{ balance(account) }}</strong>
              <button class="ledger-secondary-button" type="button" :disabled="Boolean(restoreId)" @click="restore(account.id, account.version)">
                {{ restoreId === account.id ? '正在恢复…' : '恢复' }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.ledger-page { min-height: calc(100vh - 52px); background: var(--bg); }
.ledger-accounts-page { width: min(100%, 1080px); margin: 0 auto; padding: 36px 28px 64px; box-sizing: border-box; }
.ledger-page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
.ledger-eyebrow { margin: 0 0 5px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-page-header h1 { margin: 0; color: var(--text-h); font-size: 2rem; line-height: 1.2; }
.ledger-page-header p:not(.ledger-eyebrow) { margin: 8px 0 0; color: var(--text-muted); font-size: .86rem; }
.ledger-page-actions,
.ledger-row-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.ledger-primary-button,
.ledger-secondary-button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; box-sizing: border-box; padding: 7px 13px; border-radius: 7px; font: inherit; font-size: .84rem; font-weight: 650; text-decoration: none; cursor: pointer; }
.ledger-primary-button { border: 1px solid var(--accent); background: var(--accent); color: #fff; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-secondary-button { border: 1px solid var(--border); background: var(--bg); color: var(--text-h); }
.ledger-secondary-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.ledger-primary-button:disabled,
.ledger-secondary-button:disabled { cursor: wait; opacity: .65; }
.ledger-state-panel { display: grid; min-height: 260px; place-items: center; align-content: center; gap: 9px; color: var(--text-muted); text-align: center; }
.ledger-state-panel h2,
.ledger-state-panel p { margin: 0; }
.ledger-state-panel h2 { color: var(--text-h); }
.ledger-account-section { margin-top: 22px; }
.ledger-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.ledger-section-heading h2 { margin: 0; color: var(--text-h); font-size: 1.08rem; }
.ledger-section-heading p { margin: 4px 0 0; color: var(--text-muted); font-size: .78rem; }
.ledger-count { display: inline-grid; min-width: 25px; height: 25px; place-items: center; border-radius: 999px; background: var(--bg-soft); color: var(--text-muted); font-size: .76rem; }
.ledger-account-list { display: grid; gap: 8px; }
.ledger-account-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-height: 70px; padding: 13px 15px; box-sizing: border-box; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-soft); color: inherit; text-decoration: none; }
.ledger-account-row:hover { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.ledger-account-row.is-archived { background: transparent; }
.ledger-account-name { display: grid; gap: 3px; min-width: 0; color: inherit; text-decoration: none; }
.ledger-account-name strong { overflow: hidden; color: var(--text-h); font-size: .9rem; text-overflow: ellipsis; white-space: nowrap; }
.ledger-account-name small { color: var(--text-muted); font-size: .76rem; }
.ledger-account-balance { flex: 0 0 auto; color: var(--text-h); font-size: .9rem; }
.ledger-inline-empty { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 18px; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-muted); }
.ledger-inline-empty p { margin: 0; }
.ledger-form-error { margin: 0 0 12px; color: #b42318; font-size: .82rem; }
@media (max-width: 650px) {
  .ledger-accounts-page { padding: 28px 16px 48px; }
  .ledger-page-header { align-items: stretch; flex-direction: column; }
  .ledger-page-actions > * { flex: 1 1 150px; }
  .ledger-account-row { align-items: flex-start; flex-direction: column; }
  .ledger-row-actions { width: 100%; justify-content: space-between; }
}
</style>
