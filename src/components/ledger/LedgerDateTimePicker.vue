<script setup lang="ts">
import { ref } from 'vue'
import { NDatePicker, type DatePickerInst } from 'naive-ui'

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
const picker = ref<DatePickerInst | null>(null)

function updateValue(value: string | null): void {
  emit('update:modelValue', value ?? '')
}

defineExpose({
  focus: () => picker.value?.focus(),
  focusTime: () => picker.value?.focus(),
  blur: () => picker.value?.blur(),
})
</script>

<template>
  <NDatePicker
    ref="picker"
    class="ledger-date-time-picker"
    :data-testid="props.testId"
    type="datetime"
    to="body"
    format="yyyy-MM-dd HH:mm"
    value-format="yyyy-MM-dd'T'HH:mm"
    :formatted-value="props.modelValue || null"
    :clearable="false"
    :disabled="props.disabled"
    :aria-label="props.label"
    @update:formatted-value="updateValue"
  />
</template>

<style>
.v-binder-follower-container:has(.n-date-panel) {
  z-index: 10000 !important;
}
</style>
