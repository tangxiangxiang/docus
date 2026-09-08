<script setup lang="ts">
import { ref, watch } from 'vue'
import { NDatePicker, NInputGroup, NTimePicker, type DatePickerInst, type TimePickerInst } from 'naive-ui'
import { composeLedgerLocalDateTime, splitLedgerLocalDateTime } from '../../features/ledger/naiveTemporal'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  testId?: string
  disabled?: boolean
}>(), {
  testId: undefined,
  disabled: false,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const datePicker = ref<DatePickerInst | null>(null)
const timePicker = ref<TimePickerInst | null>(null)
const datePart = ref('')
const timePart = ref('')

function syncParts(value: string): void {
  const parts = splitLedgerLocalDateTime(value)
  datePart.value = parts.date
  timePart.value = parts.time
}

watch(() => props.modelValue, syncParts, { immediate: true })

function emitComposedValue(): void {
  emit('update:modelValue', composeLedgerLocalDateTime(datePart.value, timePart.value))
}

function updateDate(value: string | null): void {
  datePart.value = value ?? ''
  emitComposedValue()
}

function updateTime(formattedValue: string | null, _timestampValue: number | null): void {
  timePart.value = formattedValue ?? ''
  emitComposedValue()
}

defineExpose({
  focus: () => datePicker.value?.focus(),
  focusTime: () => timePicker.value?.focus(),
  blur: () => {
    datePicker.value?.blur()
    timePicker.value?.blur()
  },
})
</script>

<template>
  <NInputGroup
    class="ledger-date-time-picker"
    :data-testid="props.testId"
    role="group"
    :aria-label="props.label"
  >
    <NDatePicker
      ref="datePicker"
      class="ledger-date-time-date"
      :data-testid="props.testId ? `${props.testId}-date` : undefined"
      type="date"
      format="yyyy-MM-dd"
      value-format="yyyy-MM-dd"
      :formatted-value="datePart || null"
      :disabled="props.disabled"
      :aria-label="`${props.label} 日期`"
      @update:formatted-value="updateDate"
    />
    <NTimePicker
      ref="timePicker"
      class="ledger-date-time-time"
      :data-testid="props.testId ? `${props.testId}-time` : undefined"
      format="HH:mm"
      value-format="HH:mm"
      :formatted-value="timePart || null"
      :clearable="false"
      :disabled="props.disabled"
      :aria-label="`${props.label} 时间`"
      @update:formatted-value="updateTime"
    />
  </NInputGroup>
</template>
