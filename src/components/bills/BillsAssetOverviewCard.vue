<script setup lang="ts">
import { computed } from 'vue'
import type { BillsAccount, BillsAssetSummary } from '../../features/bills/mockData'
import { aggregateAssetSummary } from '../../features/bills/aggregations'
import { formatCurrency } from '../../features/bills/formatters'
import { BILLS_ICON_WALLET } from './icons'

const props = defineProps<{ summary: BillsAssetSummary; accounts: BillsAccount[] }>()
// The three headline values retain the approved presentation, but the asset
// side is still derived from the exact account rows rendered below. This
// prevents a stale summary from silently including an undisplayed account.
const summary = computed(() => aggregateAssetSummary(props.accounts, props.summary.debt))

function formatAccountBalance(account: BillsAccount): string {
  return formatCurrency(account.accountType === 'liability' ? -account.balance : account.balance)
}
</script>

<template>
  <article class="bills-card bills-asset-card" data-testid="bills-asset-overview">
    <div class="bills-card-heading">
      <div>
        <div class="bills-card-title-row"><span class="bills-heading-icon bills-heading-icon-teal" v-html="BILLS_ICON_WALLET" aria-hidden="true" /><h2>资产概要</h2></div>
        <p class="bills-card-helper"><span data-testid="bills-account-count">{{ summary.accountCount }}</span> 个账户 · 余额概览</p>
      </div>
    </div>
    <div class="bills-asset-totals" data-testid="bills-asset-totals">
      <div class="bills-asset-total bills-asset-total-primary">
        <span class="bills-asset-label">总资产</span>
        <strong>{{ formatCurrency(summary.assets) }}</strong>
      </div>
      <div class="bills-asset-total">
        <span class="bills-asset-label">总负债</span>
        <strong class="debt">{{ formatCurrency(summary.debt) }}</strong>
      </div>
      <div class="bills-asset-total">
        <span class="bills-asset-label">净资产</span>
        <strong class="net">{{ formatCurrency(summary.netAssets) }}</strong>
      </div>
    </div>
    <div class="bills-account-list" aria-label="账户列表">
      <div v-for="account in accounts" :key="account.id" class="bills-account-row" :class="{ 'bills-account-row-liability': account.accountType === 'liability' }" :data-account-type="account.accountType ?? 'asset'"><span class="bills-account-mark" :style="{ background: account.accent }" aria-hidden="true" /><span class="bills-account-name"><strong>{{ account.name }}</strong><small>{{ account.kind }}</small></span><span class="bills-account-balance">{{ formatAccountBalance(account) }}</span></div>
    </div>
  </article>
</template>
