<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import LedgerTransactionSheet from '../components/ledger/LedgerTransactionSheet.vue'
import { useLedgerStore } from '../features/ledger/ledgerStore'

const store = useLedgerStore()
const transactionSheetOpen = ref(false)
const loading = computed(() => store.workspaceState.value === 'BOOTSTRAPPING')

onMounted(() => { void store.bootstrap() })
</script>

<template>
  <main class="ledger-page" data-testid="ledger-transactions-page">
    <header class="ledger-transactions-header">
      <div>
        <p class="ledger-eyebrow">Ledger</p>
        <h1>交易记录</h1>
        <p>查看并新增真实 Ledger 交易。</p>
      </div>
      <button class="ledger-primary-button" type="button" :disabled="loading || !store.activeAccounts.value.length" @click="transactionSheetOpen = true">＋ 记一笔</button>
    </header>
    <div v-if="loading" class="ledger-transactions-state" role="status">正在加载交易…</div>
    <div v-else-if="!store.settings.value" class="ledger-transactions-state">请先完成 Ledger 初始化。</div>
    <div v-else-if="!store.activeAccounts.value.length" class="ledger-transactions-state">请先创建一个可用账户，再新增交易。</div>
    <div v-else class="ledger-transactions-state" data-testid="ledger-transactions-placeholder">真实交易列表将在下一个 slice 接入。</div>
    <LedgerTransactionSheet :open="transactionSheetOpen" @close="transactionSheetOpen = false" />
  </main>
</template>

<style scoped>
.ledger-page { min-height: calc(100vh - 52px); background: var(--bg); }
.ledger-transactions-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; width: min(100%, 1080px); margin: 0 auto; padding: 36px 28px 24px; box-sizing: border-box; }
.ledger-eyebrow { margin: 0 0 5px; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ledger-transactions-header h1 { margin: 0; color: var(--text-h); font-size: 2rem; line-height: 1.2; }
.ledger-transactions-header p:not(.ledger-eyebrow) { margin: 8px 0 0; color: var(--text-muted); font-size: .86rem; }
.ledger-primary-button { min-height: 39px; padding: 7px 14px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: #fff; font: inherit; font-size: .84rem; font-weight: 650; cursor: pointer; }
.ledger-primary-button:hover:not(:disabled) { background: var(--accent-hover); }
.ledger-primary-button:disabled { cursor: wait; opacity: .65; }
.ledger-transactions-state { display: grid; min-height: 300px; place-items: center; padding: 28px 18px; box-sizing: border-box; color: var(--text-muted); text-align: center; }
@media (max-width: 620px) {
  .ledger-transactions-header { align-items: stretch; flex-direction: column; padding: 28px 16px 20px; }
}
</style>
