// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { NDatePicker, NTimePicker } from 'naive-ui'
import LedgerDatePicker from '../LedgerDatePicker.vue'
import LedgerDateTimePicker from '../LedgerDateTimePicker.vue'

describe('Ledger Naive temporal controls', () => {
  it('keeps a canonical date string in the public date picker contract', async () => {
    const wrapper = mount(LedgerDatePicker, {
      props: { modelValue: '2026-09-05', label: '查看日期', testId: 'ledger-date-test' },
    })
    const picker = wrapper.findComponent(NDatePicker)

    expect(picker.props('size')).toBe('medium')
    expect(picker.props('formattedValue')).toBe('2026-09-05')
    expect(picker.props('valueFormat')).toBe('yyyy-MM-dd')
    await picker.vm.$emit('update:formatted-value', '2026-09-06')
    expect(wrapper.emitted('update:modelValue')).toEqual([['2026-09-06']])
  })

  it('composes date and time fields without browser-local timestamp conversion', async () => {
    const wrapper = mount(LedgerDateTimePicker, {
      props: { modelValue: '2026-09-05T12:30', label: '发生时间', testId: 'ledger-datetime-test' },
    })
    const datePicker = wrapper.findComponent(NDatePicker)
    const timePicker = wrapper.findComponent(NTimePicker)

    expect(datePicker.props('formattedValue')).toBe('2026-09-05')
    expect(datePicker.props('valueFormat')).toBe('yyyy-MM-dd')
    expect(timePicker.props('formattedValue')).toBe('12:30')
    expect(timePicker.props('valueFormat')).toBe('HH:mm')

    await datePicker.vm.$emit('update:formatted-value', '2026-09-06')
    await nextTick()
    await timePicker.vm.$emit('update:formatted-value', '13:45', 0)
    await nextTick()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['2026-09-06T13:45'])
    expect(wrapper.find('[data-testid="ledger-datetime-test-date"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-datetime-test-time"]').exists()).toBe(true)
  })

  it('clears the canonical model until both fields are complete', async () => {
    const wrapper = mount(LedgerDateTimePicker, {
      props: { modelValue: '2026-09-05T12:30', label: '发生时间' },
    })
    const datePicker = wrapper.findComponent(NDatePicker)

    await datePicker.vm.$emit('update:formatted-value', null)
    await nextTick()

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([''])
  })
})
