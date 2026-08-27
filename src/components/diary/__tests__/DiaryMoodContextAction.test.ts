// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useI18n } from '../../../composables/useI18n'
import DiaryMoodContextAction from '../DiaryMoodContextAction.vue'

enableAutoUnmount(afterEach)

describe('DiaryMoodContextAction', () => {
  beforeEach(() => {
    useI18n().setLocale('en')
  })

  afterEach(() => {
    useI18n().setLocale('zh')
  })

  it('owns one trigger/picker presentation and returns focus after Escape', async () => {
    const wrapper = mount(DiaryMoodContextAction, {
      props: { currentMood: 'happy' },
      attachTo: document.body,
    })
    const trigger = wrapper.get('[data-testid="diary-mood-trigger"]')

    expect(wrapper.findAll('[data-testid="diary-mood-picker"]')).toHaveLength(0)
    await trigger.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="diary-mood-picker"]')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('[data-mood-id="happy"]').element)

    await wrapper.get('[data-mood-id="happy"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.findAll('[data-testid="diary-mood-picker"]')).toHaveLength(0)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('forwards canonical selection and clear without owning persistence', async () => {
    const wrapper = mount(DiaryMoodContextAction, { props: { currentMood: 'happy' } })
    await wrapper.get('[data-testid="diary-mood-trigger"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-mood-id="sad"]').trigger('click')
    await wrapper.get('[data-testid="diary-mood-clear"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([['sad']])
    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect(wrapper.find('[data-testid="diary-mood-picker"]').exists()).toBe(true)
  })

  it('closes on an outside pointer and does not expose mutation when the CAS token is absent', async () => {
    const wrapper = mount(DiaryMoodContextAction, {
      props: { currentMood: null, disabled: true },
      attachTo: document.body,
    })
    const trigger = wrapper.get('[data-testid="diary-mood-trigger"]')
    expect(trigger.attributes('disabled')).toBeDefined()
    expect(trigger.attributes('aria-label')).toContain('Not set')

    await wrapper.setProps({ disabled: false })
    await trigger.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="diary-mood-picker"]').exists()).toBe(true)

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('[data-testid="diary-mood-picker"]').exists()).toBe(false)
  })
})
