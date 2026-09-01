<script setup lang="ts">
import { computed } from 'vue'
import type { BillsAccount } from '../../features/bills/mockData'
import { aggregateAccountBalances } from '../../features/bills/aggregations'
import { formatCurrency } from '../../features/bills/formatters'
import { BILLS_ICON_WALLET } from './icons'

const props = defineProps<{ accounts: BillsAccount[] }>()
const summary = computed(() => aggregateAccountBalances(props.accounts))
</script>

<template>
  <article class="bills-card bills-asset-card" data-testid="bills-asset-overview">
    <div class="bills-card-heading">
      <div>
        <div class="bills-card-title-row"><span class="bills-heading-icon bills-heading-icon-teal" v-html="BILLS_ICON_WALLET" aria-hidden="true" /><h2>资产概要</h2></div>
        <p class="bills-card-helper"><span data-testid="bills-account-count">{{ summary.accountCount }}</span> 个账户 · 余额概览</p>
      </div>
    </div>
    <div class="bills-asset-balance" data-testid="bills-asset-total-balance">
      <div>
        <span class="bills-asset-label">总余额</span>
        <strong>{{ formatCurrency(summary.totalBalance) }}</strong>
      </div>
      <span class="bills-asset-note">当前展示账户合计</span>
    </div>
    <div class="bills-account-list" aria-label="账户列表">
      <div v-for="account in accounts" :key="account.id" class="bills-account-row"><span class="bills-account-mark" :style="{ background: account.accent }" aria-hidden="true" /><span class="bills-account-name"><strong>{{ account.name }}</strong><small>{{ account.kind }}</small></span><span class="bills-account-balance">{{ formatCurrency(account.balance) }}</span></div>
    </div>
  </article>
</template>
