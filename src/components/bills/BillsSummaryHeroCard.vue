<script setup lang="ts">
import type { BillsMonthlySummary } from '../../features/bills/mockData'
import { formatBillsDate, formatCurrency, formatPercent } from '../../features/bills/formatters'
import { BILLS_ICON_ARROW_RIGHT } from './icons'

const props = defineProps<{
  summary: BillsMonthlySummary
  monthLabel: string
}>()

defineEmits<{
  details: []
}>()

const expenseChange = ((props.summary.expense - props.summary.previousExpense) / props.summary.previousExpense) * 100
</script>

<template>
  <article class="bills-card bills-hero-card" data-testid="bills-summary-hero">
    <div class="bills-hero-grid" aria-hidden="true" />
    <div class="bills-hero-orbit bills-hero-orbit-one" aria-hidden="true" />
    <div class="bills-hero-orbit bills-hero-orbit-two" aria-hidden="true" />
    <div class="bills-hero-content">
      <div class="bills-card-kicker">
        <span class="bills-kicker-dot" />
        <span>{{ props.monthLabel }} · 支出</span>
      </div>
      <h2>本月支出</h2>
      <p class="bills-hero-amount expense">{{ formatCurrency(props.summary.expense) }}</p>
      <div class="bills-hero-meta">
        <span class="bills-change" :class="expenseChange <= 0 ? 'is-positive' : 'is-negative'">
          {{ formatPercent(expenseChange) }} <span>{{ expenseChange <= 0 ? '低于上月' : '高于上月' }}</span>
        </span>
        <span class="bills-date-note">截至 {{ formatBillsDate(props.summary.asOf) }}</span>
      </div>
      <div class="bills-hero-income">
        <span>当月收入</span>
        <strong>{{ formatCurrency(props.summary.income) }}</strong>
      </div>
      <button class="bills-primary-button" type="button" @click="$emit('details')">
        查看明细
        <span class="bills-button-icon" v-html="BILLS_ICON_ARROW_RIGHT" aria-hidden="true" />
      </button>
    </div>
    <div class="bills-hero-illustration" aria-hidden="true">
      <div class="bills-hero-illustration-label">CASH FLOW</div>
      <div class="bills-hero-bars">
        <span style="--bar-height: 38%" />
        <span style="--bar-height: 58%" />
        <span style="--bar-height: 45%" />
        <span style="--bar-height: 74%" />
        <span style="--bar-height: 63%" />
        <span style="--bar-height: 88%" />
      </div>
      <div class="bills-hero-illustration-caption">稳步保持正向结余</div>
    </div>
  </article>
</template>

