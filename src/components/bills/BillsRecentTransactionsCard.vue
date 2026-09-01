<script setup lang="ts">
import type { BillsTransaction } from '../../features/bills/mockData'
import { formatCurrency } from '../../features/bills/formatters'
import { BILLS_ICON_ARROW_RIGHT, BILLS_ICON_TREND, TRANSACTION_ICONS } from './icons'

withDefaults(defineProps<{
  transactions: BillsTransaction[]
  showViewAll?: boolean
}>(), {
  showViewAll: true,
})

defineEmits<{
  viewAll: []
}>()
</script>

<template>
  <article class="bills-card bills-transactions-card" data-testid="bills-recent-transactions">
    <div class="bills-card-heading">
      <div>
        <div class="bills-card-title-row">
          <span class="bills-heading-icon bills-heading-icon-violet" v-html="BILLS_ICON_TREND" aria-hidden="true" />
          <h2>最近交易</h2>
        </div>
        <p class="bills-card-helper">最近 5 笔记账记录</p>
      </div>
      <button v-if="showViewAll" class="bills-text-button" type="button" @click="$emit('viewAll')">
        查看全部
        <span class="bills-button-icon" v-html="BILLS_ICON_ARROW_RIGHT" aria-hidden="true" />
      </button>
    </div>
    <div v-if="transactions.length" class="bills-transaction-list">
      <div v-for="transaction in transactions" :key="transaction.id" class="bills-transaction-row">
        <span :class="['bills-transaction-icon', transaction.type]" v-html="TRANSACTION_ICONS[transaction.icon]" aria-hidden="true" />
        <span class="bills-transaction-info">
          <strong>{{ transaction.merchant }}</strong>
          <small>{{ transaction.category }} · {{ transaction.account }}</small>
        </span>
        <span class="bills-transaction-date">{{ transaction.date }}</span>
        <strong :class="['bills-transaction-amount', transaction.type]">
          {{ transaction.type === 'income' ? '+' : '-' }}{{ formatCurrency(transaction.amount) }}
        </strong>
      </div>
    </div>
    <div v-else class="bills-empty-state" role="status">
      <span class="bills-empty-state-icon">○</span>
      <p>还没有交易记录</p>
      <small>开始记账后，最近交易会显示在这里。</small>
    </div>
  </article>
</template>
