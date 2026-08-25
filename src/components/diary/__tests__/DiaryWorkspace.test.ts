// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DiaryWorkspace from '../DiaryWorkspace.vue'

describe('DiaryWorkspace shell', () => {
  it('shows the Home slot without unmounting it when the shell is eligible', () => {
    const wrapper = mount(DiaryWorkspace, {
      props: { eligible: true, visible: true, mode: 'home' },
      slots: {
        home: '<div data-testid="calendar-slot">calendar</div>',
      },
    })

    expect(wrapper.get('[data-testid="diary-workspace-shell"]').attributes('data-presentation-mode')).toBe('home')
    expect(wrapper.get('[data-testid="calendar-slot"]').isVisible()).toBe(true)
  })

  it('keeps Home mounted but hidden for future Reader and Editor presentation slots', async () => {
    const wrapper = mount(DiaryWorkspace, {
      props: { eligible: true, visible: true, mode: 'home' },
      slots: {
        home: '<div data-testid="calendar-slot">calendar</div>',
        reader: '<div data-testid="reader-slot">reader</div>',
        editor: '<div data-testid="editor-slot">editor</div>',
      },
    })

    await wrapper.setProps({ mode: 'reader' })
    expect(wrapper.find('[data-testid="calendar-slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="calendar-slot"]').isVisible()).toBe(false)
    expect(wrapper.get('[data-testid="reader-slot"]').isVisible()).toBe(true)

    await wrapper.setProps({ mode: 'editor' })
    expect(wrapper.find('[data-testid="calendar-slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="calendar-slot"]').isVisible()).toBe(false)
    expect(wrapper.get('[data-testid="editor-slot"]').isVisible()).toBe(true)
  })

  it('hides the whole shell when Diary presentation is ineligible', () => {
    const wrapper = mount(DiaryWorkspace, {
      props: { eligible: false, visible: false, mode: 'home' },
      slots: { home: '<div data-testid="calendar-slot">calendar</div>' },
    })

    expect(wrapper.get('[data-testid="diary-workspace-shell"]').isVisible()).toBe(false)
    expect(wrapper.find('[data-testid="calendar-slot"]').exists()).toBe(true)
  })
})
