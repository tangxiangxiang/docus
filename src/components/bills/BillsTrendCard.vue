<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BillsTrendPoint } from '../../features/bills/mockData'
import { formatCompactCurrency, formatCurrency } from '../../features/bills/formatters'

const props = defineProps<{
  series: BillsTrendPoint[]
}>()

const activeIndex = ref<number | null>(props.series.length - 1)
const chart = { width: 720, height: 300, left: 54, right: 22, top: 26, bottom: 46 }
const plotWidth = chart.width - chart.left - chart.right
const plotHeight = chart.height - chart.top - chart.bottom

const maxValue = computed(() => {
  const max = Math.max(...props.series.flatMap((point) => [point.income, point.expense]), 1)
  return Math.ceil(max / 5000) * 5000
})

const yTicks = computed(() => [maxValue.value, maxValue.value * 0.75, maxValue.value * 0.5, maxValue.value * 0.25, 0])

function xFor(index: number): number {
  return chart.left + (props.series.length <= 1 ? plotWidth / 2 : (index / (props.series.length - 1)) * plotWidth)
}

function yFor(value: number): number {
  return chart.top + plotHeight - (value / maxValue.value) * plotHeight
}

function pathFor(key: 'income' | 'expense'): string {
  return props.series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(1)} ${yFor(point[key]).toFixed(1)}`).join(' ')
}

const incomePath = computed(() => pathFor('income'))
const expensePath = computed(() => pathFor('expense'))
const activePoint = computed(() => activeIndex.value === null ? null : props.series[activeIndex.value])

function setActive(index: number): void {
  activeIndex.value = index
}

function moveActive(delta: number): void {
  const current = activeIndex.value ?? props.series.length - 1
  activeIndex.value = Math.min(props.series.length - 1, Math.max(0, current + delta))
}

function tickLabel(value: number): string {
  return value === 0 ? '0' : formatCompactCurrency(value)
}
</script>

<template>
  <article class="bills-card bills-trend-card" data-testid="bills-trend-card">
    <div class="bills-card-heading bills-trend-heading">
      <div>
        <div class="bills-card-title-row">
          <span class="bills-trend-pulse" aria-hidden="true" />
          <h2>收入与支出趋势</h2>
        </div>
        <p class="bills-card-helper">近 6 个月的现金流变化</p>
      </div>
      <div class="bills-chart-legend" aria-label="图例">
        <span><i class="legend-income" />收入</span>
        <span><i class="legend-expense" />支出</span>
      </div>
    </div>
    <div v-if="series.length" class="bills-chart-wrap">
      <svg class="bills-chart" :viewBox="`0 0 ${chart.width} ${chart.height}`" role="img" aria-label="近六个月收入与支出趋势图" @mouseleave="activeIndex = null">
        <defs>
          <linearGradient id="bills-income-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#14b8a6" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#14b8a6" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="bills-expense-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0" />
          </linearGradient>
        </defs>
        <g class="bills-chart-grid" aria-hidden="true">
          <line v-for="tick in yTicks" :key="tick" :x1="chart.left" :x2="chart.width - chart.right" :y1="yFor(tick)" :y2="yFor(tick)" />
        </g>
        <g class="bills-chart-axis-labels" aria-hidden="true">
          <text v-for="tick in yTicks" :key="`label-${tick}`" :x="chart.left - 12" :y="yFor(tick) + 4" text-anchor="end">{{ tickLabel(tick) }}</text>
          <text v-for="(point, index) in series" :key="point.label" :x="xFor(index)" :y="chart.height - 13" text-anchor="middle">{{ point.label }}</text>
        </g>
        <path class="bills-chart-area income" :d="`${incomePath} L ${xFor(series.length - 1)} ${chart.top + plotHeight} L ${xFor(0)} ${chart.top + plotHeight} Z`" />
        <path class="bills-chart-area expense" :d="`${expensePath} L ${xFor(series.length - 1)} ${chart.top + plotHeight} L ${xFor(0)} ${chart.top + plotHeight} Z`" />
        <path class="bills-chart-line income" :d="incomePath" />
        <path class="bills-chart-line expense" :d="expensePath" />
        <g v-for="(point, index) in series" :key="point.label" class="bills-chart-point-group">
          <line v-if="activeIndex === index" class="bills-chart-crosshair" :x1="xFor(index)" :x2="xFor(index)" :y1="chart.top" :y2="chart.top + plotHeight" />
          <circle class="bills-chart-hit-area" :cx="xFor(index)" :cy="yFor(point.income)" r="18" tabindex="0" :aria-label="`${point.label} 收入 ${formatCurrency(point.income)}，支出 ${formatCurrency(point.expense)}`" @mouseenter="setActive(index)" @focus="setActive(index)" @keydown.left.prevent="moveActive(-1)" @keydown.right.prevent="moveActive(1)" />
          <circle class="bills-chart-dot income" :class="{ active: activeIndex === index }" :cx="xFor(index)" :cy="yFor(point.income)" :r="activeIndex === index ? 6 : 4.5" aria-hidden="true" />
          <circle class="bills-chart-dot expense" :class="{ active: activeIndex === index }" :cx="xFor(index)" :cy="yFor(point.expense)" :r="activeIndex === index ? 6 : 4.5" aria-hidden="true" />
        </g>
        <g v-if="activePoint && activeIndex !== null" class="bills-chart-tooltip" :transform="`translate(${Math.min(xFor(activeIndex) + 12, chart.width - 142)} ${Math.max(chart.top + 4, yFor(activePoint.income) - 72)})`" aria-live="polite">
          <rect width="130" height="62" rx="8" />
          <text x="12" y="17" class="tooltip-month">{{ series[activeIndex].label }}</text>
          <text x="12" y="35"><tspan class="tooltip-income">收入</tspan><tspan dx="8">{{ formatCompactCurrency(series[activeIndex].income) }}</tspan></text>
          <text x="12" y="51"><tspan class="tooltip-expense">支出</tspan><tspan dx="8">{{ formatCompactCurrency(series[activeIndex].expense) }}</tspan></text>
        </g>
      </svg>
    </div>
    <div v-else class="bills-empty-state bills-chart-empty" role="status">
      <span class="bills-empty-state-icon">⌁</span>
      <p>暂无趋势数据</p>
      <small>开始记账后，这里会展示收入与支出变化。</small>
    </div>
  </article>
</template>
