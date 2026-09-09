<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NNumberAnimation as NumberAnimation } from 'naive-ui'
import { currencyExponentFor } from '../../features/ledger/money'

const props = withDefaults(defineProps<{
  minor: number
  currency: string
  signed?: boolean
}>(), { signed: false })

function parts(minor: number, currency: string) {
  const precision = currencyExponentFor(currency)
  const symbol = new Intl.NumberFormat('zh-CN', {
    style: 'currency', currency, currencyDisplay: 'symbol',
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  }).formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency
  const sign = props.signed
    ? minor > 0 ? '+' : minor < 0 ? '-' : ''
    : minor < 0 ? '-' : ''
  return {
    prefix: `${sign}${symbol}`,
    value: Math.abs(minor) / (10 ** precision),
    precision,
  }
}

const fromMinor = ref(props.minor)
const animationKey = ref(0)
let resetTimer: ReturnType<typeof setTimeout> | undefined
let initialAnimationTimer: ReturnType<typeof setTimeout> | undefined
void initialAnimationTimer
const currentParts = computed(() => parts(props.minor, props.currency))
const fromParts = computed(() => parts(fromMinor.value, props.currency))
// The Vue template compiler consumes these bindings; keep TypeScript's
// noUnusedLocals check aware of the runtime template references as well.
void NumberAnimation
void currentParts
void fromParts

watch(() => ({ minor: props.minor, currency: props.currency }), (next, previous) => {
  if (next.currency !== previous.currency) fromMinor.value = next.minor
  else fromMinor.value = previous.minor
  animationKey.value += 1
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => { fromMinor.value = props.minor }, 700)
})

onMounted(() => {
  initialAnimationTimer = setTimeout(() => {
    fromMinor.value = 0
    animationKey.value += 1
  }, 100)
})
</script>

<template>
  <span class="ledger-animated-money">
    {{ currentParts.prefix }}<component
      :is="NumberAnimation"
      :key="animationKey"
      :from="fromParts.value"
      :to="currentParts.value"
      :precision="currentParts.precision"
      show-separator
      :duration="2000"
    />
  </span>
</template>
