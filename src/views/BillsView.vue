<script setup lang="ts">
import { useRouter } from 'vue-router'
import BillsPeriodCard from '../components/bills/BillsPeriodCard.vue'
import BillsRecentTransactionsCard from '../components/bills/BillsRecentTransactionsCard.vue'
import BillsTrendCard from '../components/bills/BillsTrendCard.vue'
import BillsAssetOverviewCard from '../components/bills/BillsAssetOverviewCard.vue'
import BillsCategoryBreakdownCard from '../components/bills/BillsCategoryBreakdownCard.vue'
import { billsMockData } from '../features/bills/mockData'

const router = useRouter()
const data = billsMockData

function openTransactions(): void {
  void router.push({ name: 'bills-transactions' })
}
</script>

<template>
  <div class="bills-page bills-dashboard" data-testid="bills-page">
    <section class="bills-top-grid" aria-label="资产概览">
      <div class="bills-asset-section"><BillsAssetOverviewCard :summary="data.assetSummary" :accounts="data.accounts" /></div>
      <BillsCategoryBreakdownCard :breakdowns="data.categoryBreakdowns" />
    </section>
    <section class="bills-period-grid" aria-label="时间段摘要">
      <BillsPeriodCard v-for="period in data.periods" :key="period.id" :period="period" />
    </section>

    <section class="bills-content-grid" aria-label="账单分析">
      <BillsTrendCard :series="data.trend" />
      <BillsRecentTransactionsCard :transactions="data.recentTransactions" @view-all="openTransactions" />
    </section>
  </div>
</template>
