<script setup lang="ts">
import { ref } from 'vue'
import { BILLS_ICON_CHART } from './icons'

const selectedLedger = ref('all')
</script>

<template>
  <article class="bills-card bills-category-card">
    <div class="bills-card-heading"><div><div class="bills-card-title-row"><span class="bills-heading-icon bills-heading-icon-violet" v-html="BILLS_ICON_CHART" aria-hidden="true" /><h2>收支占比</h2></div><p class="bills-card-helper">收支结构</p></div><select v-model="selectedLedger" class="bills-ledger-select" aria-label="选择账本"><option value="all">总账本</option><option value="year">年账本</option><option value="month">月账本</option></select></div>
    <div class="bills-category-charts">
      <div class="bills-category-chart"><div class="bills-donut bills-donut-income"><span>收入</span></div><div class="bills-category-legend"><span><i class="income-a" />工资 82%</span><span><i class="income-b" />其他 18%</span></div></div>
      <div class="bills-category-chart"><div class="bills-donut bills-donut-expense"><span>支出</span></div><div class="bills-category-legend"><span><i class="expense-a" />生活 46%</span><span><i class="expense-b" />交通 31%</span><span><i class="expense-c" />其他 23%</span></div></div>
    </div>
    <div class="bills-category-metrics"><div><span>收入</span><strong class="income-text">¥21,800.00</strong></div><div><span>支出</span><strong class="expense-text">¥12,486.20</strong></div><div><span>结余</span><strong>¥9,313.80</strong></div></div>
    <div class="bills-category-bars"><div><span>收入</span><i><b class="income-bar" style="width:82%" /></i><em>82%</em></div><div><span>支出</span><i><b style="width:46%" /></i><em>46%</em></div></div>
  </article>
</template>
