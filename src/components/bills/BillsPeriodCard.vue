<script setup lang="ts">
import type { BillsPeriodSummary } from '../../features/bills/mockData'
import { formatCurrency } from '../../features/bills/formatters'
import { BILLS_ICON_MORE, PERIOD_ICONS } from './icons'

defineProps<{
  period: BillsPeriodSummary
}>()
</script>

<template>
  <article :class="['bills-card', 'bills-period-card', `is-${period.tone}`]" :data-testid="`bills-period-${period.id}`">
    <div class="bills-period-heading">
      <span class="bills-period-icon" v-html="PERIOD_ICONS[period.icon]" aria-hidden="true" />
      <span class="bills-period-title">{{ period.title }}</span>
      <button class="bills-icon-button bills-period-menu" type="button" disabled :aria-label="`${period.title} 更多选项`" :title="`${period.title} 更多选项（即将上线）`">
        <span class="bills-button-icon" v-html="BILLS_ICON_MORE" aria-hidden="true" />
      </button>
    </div>
    <p class="bills-period-date">{{ period.dateLabel }}</p>
    <div class="bills-period-values">
      <div>
        <span>支出</span>
        <strong class="expense">{{ formatCurrency(period.expense) }}</strong>
      </div>
      <div>
        <span>收入</span>
        <strong class="income">{{ formatCurrency(period.income) }}</strong>
      </div>
    </div>
    <div class="bills-period-progress" aria-hidden="true">
      <span :style="{ width: `${Math.min(100, Math.max(8, (period.expense / Math.max(period.income, period.expense, 1)) * 100))}%` }" />
    </div>
  </article>
</template>
