<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  BillsCategoryBreakdown,
  BillsCategorySlice,
  BillsLedgerScope,
} from '../../features/bills/mockData'
import { billsMockData } from '../../features/bills/mockData'
import { percentageOf, summarizeCashflow, sumCategoryAmounts } from '../../features/bills/aggregations'
import { formatCurrency } from '../../features/bills/formatters'
import { BILLS_ICON_CHART } from './icons'

const props = withDefaults(defineProps<{
  breakdowns?: Record<BillsLedgerScope, BillsCategoryBreakdown>
}>(), {
  breakdowns: () => billsMockData.categoryBreakdowns,
})

const selectedLedger = ref<BillsLedgerScope>('all')
const selectedBreakdown = computed(() => props.breakdowns[selectedLedger.value] ?? props.breakdowns.all)
const incomeTotal = computed(() => sumCategoryAmounts(selectedBreakdown.value.income))
const expenseTotal = computed(() => sumCategoryAmounts(selectedBreakdown.value.expense))
const cashflow = computed(() => summarizeCashflow(selectedBreakdown.value.income, selectedBreakdown.value.expense))

function percentage(category: BillsCategorySlice, categories: BillsCategorySlice[]): number {
  return percentageOf(category.amount, sumCategoryAmounts(categories))
}

function donutStyle(categories: BillsCategorySlice[]): Record<string, string> {
  const total = sumCategoryAmounts(categories)
  if (total <= 0) return { background: 'var(--bills-surface-muted)' }
  let cursor = 0
  const stops = categories.map((category) => {
    const end = cursor + (category.amount / total) * 100
    const stop = `${category.color} ${cursor.toFixed(2)}% ${end.toFixed(2)}%`
    cursor = end
    return stop
  })
  return { background: `conic-gradient(${stops.join(', ')})` }
}

const topIncomePercentage = computed(() => Math.max(
  0,
  ...selectedBreakdown.value.income.map((category) => percentage(category, selectedBreakdown.value.income)),
))
const topExpensePercentage = computed(() => Math.max(
  0,
  ...selectedBreakdown.value.expense.map((category) => percentage(category, selectedBreakdown.value.expense)),
))
</script>

<template>
  <article class="bills-card bills-category-card" data-testid="bills-category-breakdown">
    <div class="bills-card-heading">
      <div>
        <div class="bills-card-title-row">
          <span class="bills-heading-icon bills-heading-icon-violet" v-html="BILLS_ICON_CHART" aria-hidden="true" />
          <h2>收支占比</h2>
        </div>
        <p class="bills-card-helper">收支结构</p>
      </div>
      <label class="bills-ledger-select-wrap">
        <span class="sr-only">选择账本</span>
        <select v-model="selectedLedger" class="bills-ledger-select" aria-label="选择账本">
          <option value="all">总账本</option>
          <option value="year">年账本</option>
          <option value="month">月账本</option>
        </select>
      </label>
    </div>

    <div class="bills-category-charts">
      <div class="bills-category-chart">
        <div class="bills-donut" :style="donutStyle(selectedBreakdown.income)" role="img" aria-label="收入分类占比">
          <span>收入</span>
        </div>
        <div class="bills-category-legend">
          <span v-for="category in selectedBreakdown.income" :key="category.id">
            <i :style="{ background: category.color }" />{{ category.label }} {{ percentage(category, selectedBreakdown.income) }}%
          </span>
        </div>
      </div>
      <div class="bills-category-chart">
        <div class="bills-donut" :style="donutStyle(selectedBreakdown.expense)" role="img" aria-label="支出分类占比">
          <span>支出</span>
        </div>
        <div class="bills-category-legend">
          <span v-for="category in selectedBreakdown.expense" :key="category.id">
            <i :style="{ background: category.color }" />{{ category.label }} {{ percentage(category, selectedBreakdown.expense) }}%
          </span>
        </div>
      </div>
    </div>

    <div class="bills-category-metrics">
      <div><span>收入</span><strong class="income-text">{{ formatCurrency(incomeTotal) }}</strong></div>
      <div><span>支出</span><strong class="expense-text">{{ formatCurrency(expenseTotal) }}</strong></div>
      <div><span>结余</span><strong :class="{ 'negative-text': cashflow.balance < 0 }">{{ formatCurrency(cashflow.balance) }}</strong></div>
    </div>
    <div class="bills-category-bars" aria-label="收支分类占比摘要">
      <div>
        <span>收入</span>
        <i><b class="income-bar" :style="{ width: `${topIncomePercentage}%` }" /></i>
        <em>{{ topIncomePercentage }}%</em>
      </div>
      <div>
        <span>支出</span>
        <i><b class="expense-bar" :style="{ width: `${topExpensePercentage}%` }" /></i>
        <em>{{ topExpensePercentage }}%</em>
      </div>
    </div>
  </article>
</template>
