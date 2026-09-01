<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import BillsAssetOverviewCard from '../components/bills/BillsAssetOverviewCard.vue'
import BillsPeriodCard from '../components/bills/BillsPeriodCard.vue'
import BillsRecentTransactionsCard from '../components/bills/BillsRecentTransactionsCard.vue'
import BillsSummaryHeroCard from '../components/bills/BillsSummaryHeroCard.vue'
import BillsTrendCard from '../components/bills/BillsTrendCard.vue'
import { billsMockData } from '../features/bills/mockData'
import { formatBillsMonth } from '../features/bills/formatters'

const router = useRouter()
const data = billsMockData
const monthLabel = computed(() => formatBillsMonth(data.monthlySummary.monthLabel))

function openTransactions(): void {
  void router.push({ name: 'bills-transactions' })
}
</script>

<template>
  <div class="bills-page" data-testid="bills-page">
    <header class="bills-page-header">
      <div>
        <p class="bills-eyebrow">PERSONAL FINANCE · {{ monthLabel.toUpperCase() }}</p>
        <h1>账单</h1>
        <p class="bills-page-description">清晰掌握每一笔流动，让每个决定都更从容。</p>
      </div>
      <div class="bills-page-actions">
        <div class="bills-tabs" role="tablist" aria-label="账单模块">
          <button class="bills-tab is-active" role="tab" aria-selected="true" type="button">概览</button>
          <button class="bills-tab" role="tab" aria-selected="false" type="button" @click="openTransactions">交易</button>
        </div>
        <button class="bills-secondary-button" type="button" disabled title="记账功能即将上线">
          <span class="bills-plus-mark" aria-hidden="true">+</span>
          新增记录
          <small>即将上线</small>
        </button>
      </div>
    </header>

    <section class="bills-overview-grid" aria-label="账单概览">
      <BillsSummaryHeroCard :summary="data.monthlySummary" :month-label="monthLabel" @details="openTransactions" />
      <BillsAssetOverviewCard :summary="data.assetSummary" :accounts="data.accounts" />
    </section>

    <section class="bills-period-grid" aria-label="时间段摘要">
      <BillsPeriodCard v-for="period in data.periods" :key="period.id" :period="period" />
    </section>

    <section class="bills-content-grid" aria-label="账单分析">
      <BillsTrendCard :series="data.trend" />
      <BillsRecentTransactionsCard :transactions="data.recentTransactions" @view-all="openTransactions" />
    </section>

    <aside class="bills-mock-note" role="note">
      <span class="bills-mock-note-dot" aria-hidden="true" />
      当前展示的是本地演示数据，真实账户和交易同步将在后续版本开放。
    </aside>
  </div>
</template>

