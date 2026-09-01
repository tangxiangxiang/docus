<script setup lang="ts">
import { useRouter } from 'vue-router'
import BillsRecentTransactionsCard from '../components/bills/BillsRecentTransactionsCard.vue'
import { billsMockData } from '../features/bills/mockData'

const router = useRouter()

function openOverview(): void {
  void router.push({ name: 'bills' })
}
</script>

<template>
  <div class="bills-page bills-transactions-page" data-testid="bills-transactions-page">
    <header class="bills-page-header">
      <div>
        <p class="bills-eyebrow">PERSONAL FINANCE · TRANSACTIONS</p>
        <h1>交易记录</h1>
        <p class="bills-page-description">先把每一笔流动看清楚，更多管理能力会在后续版本到来。</p>
      </div>
      <div class="bills-page-actions">
        <div class="bills-tabs" role="tablist" aria-label="账单模块">
          <button class="bills-tab" role="tab" aria-selected="false" type="button" @click="openOverview">概览</button>
          <button class="bills-tab is-active" role="tab" aria-selected="true" type="button">交易</button>
        </div>
        <button class="bills-secondary-button" type="button" disabled title="记账功能即将上线">
          <span class="bills-plus-mark" aria-hidden="true">+</span>
          新增记录
          <small>即将上线</small>
        </button>
      </div>
    </header>

    <section class="bills-transaction-shell" aria-labelledby="bills-transaction-title">
      <div class="bills-filter-row">
        <div>
          <h2 id="bills-transaction-title">全部交易</h2>
          <p>共 {{ billsMockData.recentTransactions.length }} 笔演示记录</p>
        </div>
        <div class="bills-filter-buttons" aria-label="交易筛选">
          <button class="bills-filter-button is-selected" type="button">全部</button>
          <button class="bills-filter-button" type="button" disabled>支出</button>
          <button class="bills-filter-button" type="button" disabled>收入</button>
          <button class="bills-filter-button bills-filter-date" type="button" disabled>2026年8月⌄</button>
        </div>
      </div>
      <BillsRecentTransactionsCard :transactions="billsMockData.recentTransactions" :show-view-all="false" />
      <div class="bills-coming-soon" role="status">
        <span class="bills-coming-soon-icon" aria-hidden="true">✦</span>
        <div>
          <strong>更多交易能力即将上线</strong>
          <p>新增、编辑、筛选和导入会在 Bills 的下一阶段开放。</p>
        </div>
      </div>
    </section>
  </div>
</template>
