<script setup lang="ts">
import type { BillsPeriodSummary } from '../../features/bills/mockData'
import { formatCurrency } from '../../features/bills/formatters'
import { PERIOD_ICONS } from './icons'

defineProps<{
  period: BillsPeriodSummary
}>()
</script>

<template>
  <article :class="['bills-card', 'bills-period-card', `is-${period.tone}`, { 'is-over-budget': period.expense > period.income }]" :data-testid="`bills-period-${period.id}`">
    <div class="bills-period-heading">
      <span class="bills-period-icon" v-html="PERIOD_ICONS[period.icon]" aria-hidden="true" />
      <span class="bills-period-title">{{ period.title }}</span>
    </div>
    <p class="bills-period-date">{{ period.dateLabel }}</p>
    <div class="bills-period-values">
      <div>
        <span>收入</span>
        <strong class="income">{{ formatCurrency(period.income) }}</strong>
      </div>
      <div>
        <span>支出</span>
        <strong class="expense">{{ formatCurrency(period.expense) }}</strong>
      </div>
    </div>
    <div class="bills-period-progress" aria-hidden="true">
      <span class="income" :style="{ width: `${period.income / Math.max(period.expense + period.income, 1) * 100}%` }" />
      <span class="expense" :style="{ width: `${period.expense / Math.max(period.expense + period.income, 1) * 100}%` }" />
    </div>
  </article>
</template>
