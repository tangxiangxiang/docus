<script setup lang="ts">
import type { BillsAccount, BillsAssetSummary } from '../../features/bills/mockData'
import { formatCurrency } from '../../features/bills/formatters'
import { BILLS_ICON_MORE, BILLS_ICON_WALLET } from './icons'

defineProps<{
  summary: BillsAssetSummary
  accounts: BillsAccount[]
}>()
</script>

<template>
  <article class="bills-card bills-asset-card" data-testid="bills-asset-overview">
    <div class="bills-card-heading">
      <div>
        <div class="bills-card-title-row">
          <span class="bills-heading-icon bills-heading-icon-teal" v-html="BILLS_ICON_WALLET" aria-hidden="true" />
          <h2>资产概要</h2>
        </div>
        <p class="bills-card-helper">{{ summary.accountCount }} 个账户 · 余额概览</p>
      </div>
      <button class="bills-icon-button" type="button" disabled aria-label="更多资产选项" title="更多资产选项（即将上线）">
        <span class="bills-button-icon" v-html="BILLS_ICON_MORE" aria-hidden="true" />
      </button>
    </div>
    <div class="bills-asset-totals">
      <div class="bills-asset-total bills-asset-total-primary">
        <span class="bills-asset-label">总资产</span>
        <strong>{{ formatCurrency(summary.assets) }}</strong>
        <span class="bills-asset-trend">+4.8% <span>本月</span></span>
      </div>
      <div class="bills-asset-total">
        <span class="bills-asset-label">总负债</span>
        <strong class="debt">{{ formatCurrency(summary.debt) }}</strong>
        <span class="bills-asset-note">信用卡与分期</span>
      </div>
      <div class="bills-asset-total">
        <span class="bills-asset-label">净资产</span>
        <strong class="net">{{ formatCurrency(summary.netAssets) }}</strong>
        <span class="bills-asset-note">资产 - 负债</span>
      </div>
    </div>
    <div class="bills-account-list" aria-label="账户列表">
      <div v-for="account in accounts" :key="account.id" class="bills-account-row">
        <span class="bills-account-mark" :style="{ background: account.accent }" aria-hidden="true" />
        <span class="bills-account-name">
          <strong>{{ account.name }}</strong>
          <small>{{ account.kind }}</small>
        </span>
        <span class="bills-account-balance">{{ formatCurrency(account.balance) }}</span>
      </div>
    </div>
  </article>
</template>
