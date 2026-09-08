<script setup lang="ts">
import { ref } from 'vue'
import { NDatePicker, type DatePickerInst, type DatePickerProps } from 'naive-ui'

type LedgerIsDateDisabled = NonNullable<DatePickerProps['isDateDisabled']>

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  size?: DatePickerProps['size']
  testId?: string
  disabled?: boolean
  clearable?: boolean
  placeholder?: string
  isDateDisabled?: LedgerIsDateDisabled
}>(), {
  size: 'medium',
  testId: undefined,
  disabled: false,
  clearable: false,
  placeholder: undefined,
  isDateDisabled: undefined,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const picker = ref<DatePickerInst | null>(null)

function updateValue(value: string | null): void {
  emit('update:modelValue', value ?? '')
}

defineExpose({
  focus: () => picker.value?.focus(),
  blur: () => picker.value?.blur(),
})
</script>

<template>
  <NDatePicker
    ref="picker"
    class="ledger-date-picker"
    :size="props.size"
    type="date"
    format="yyyy-MM-dd"
    value-format="yyyy-MM-dd"
    :formatted-value="props.modelValue || null"
    :clearable="props.clearable"
    :disabled="props.disabled"
    :placeholder="props.placeholder"
    :is-date-disabled="props.isDateDisabled"
    :aria-label="props.label"
    :data-testid="props.testId"
    @update:formatted-value="updateValue"
  />
</template>
