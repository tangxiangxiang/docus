<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  raw: string
  comparisonKey: string
}>()

const { t } = useI18n()
const lines = computed(() => props.raw.split('\n'))
const lineDigits = computed(() => String(Math.max(1, lines.value.length)).length)
</script>

<template>
  <div
    class="history-unchanged-content"
    role="table"
    :aria-label="t('history.unchanged_content')"
    :style="{ '--diff-line-digits': lineDigits }"
    tabindex="0"
  >
    <div
      v-for="(text, index) in lines"
      :key="`${comparisonKey}:${index}`"
      class="history-unchanged-line"
      role="row"
    >
      <span class="history-unchanged-line-number" aria-hidden="true">{{ index + 1 }}</span>
      <code class="history-unchanged-line-content">{{ text }}</code>
    </div>
  </div>
</template>
