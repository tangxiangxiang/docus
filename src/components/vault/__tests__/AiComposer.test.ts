// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiComposer from '../AiComposer.vue'

function mountComposer(props: Partial<InstanceType<typeof AiComposer>['$props']> = {}) {
  return mount(AiComposer, {
    props: {
      modelValue: '',
      busy: false,
      configured: true,
      currentPath: null,
      ...props,
    },
  })
}

describe('AiComposer', () => {
  it('owns input updates and Enter/Shift+Enter behavior', async () => {
    const wrapper = mountComposer({ modelValue: 'hello' })
    const input = wrapper.get('textarea')

    await input.setValue('updated')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['updated'])

    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toBeUndefined()
    await input.trigger('keydown', { key: 'Enter', shiftKey: false })
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('switches the primary action from send to stop while busy', async () => {
    const idle = mountComposer({ modelValue: 'hello' })
    await idle.get('.ai-send').trigger('click')
    expect(idle.emitted('send')).toHaveLength(1)

    const busy = mountComposer({ modelValue: '', busy: true })
    expect(busy.get('.ai-send').attributes('aria-label')).toBe('Stop')
    expect(busy.get('.ai-send').attributes('disabled')).toBeUndefined()
    await busy.get('.ai-send').trigger('click')
    expect(busy.emitted('stop')).toHaveLength(1)
  })

  it('shows the current-note context and disables send without configuration', () => {
    const wrapper = mountComposer({
      modelValue: 'hello',
      configured: false,
      currentPath: 'zettel/example.md',
    })
    expect(wrapper.get('.ai-context-path').text()).toBe('zettel/example.md')
    expect(wrapper.get('.ai-send').attributes('disabled')).toBeDefined()
  })
})
