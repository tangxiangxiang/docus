// @vitest-environment jsdom
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useI18n } from '../../../composables/useI18n'
import DiaryAccessDialog from '../DiaryAccessDialog.vue'

enableAutoUnmount(afterEach)

describe('DiaryAccessDialog', () => {
  beforeEach(() => useI18n().setLocale('zh'))
  afterEach(() => {
    document.body.innerHTML = ''
    useI18n().setLocale('zh')
  })

  it('renders setup fields, submits both passwords, and clears them after close', async () => {
    const wrapper = mount(DiaryAccessDialog, {
      props: { open: true, mode: 'setup' },
      attachTo: document.body,
    })
    const password = () => document.getElementById('diary-access-password') as HTMLInputElement
    const confirmPassword = () => document.getElementById('diary-access-confirm') as HTMLInputElement
    const form = () => document.querySelector('form.diary-access-dialog') as HTMLFormElement
    const cancel = () => document.querySelector('[data-testid="diary-access-cancel"]') as HTMLButtonElement
    expect(password()).toBeTruthy()
    expect(confirmPassword()).toBeTruthy()
    expect(password().autocomplete).toBe('new-password')
    expect(confirmPassword().autocomplete).toBe('new-password')

    password().value = 'diary-password'
    password().dispatchEvent(new Event('input', { bubbles: true }))
    confirmPassword().value = 'diary-password'
    confirmPassword().dispatchEvent(new Event('input', { bubbles: true }))
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('submit')).toEqual([[
      { password: 'diary-password', confirmPassword: 'diary-password' },
    ]])

    cancel().click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(password().value).toBe('')
  })

  it('cancels on Escape and only shows one password field in unlock mode', async () => {
    const wrapper = mount(DiaryAccessDialog, {
      props: { open: true, mode: 'unlock' },
      attachTo: document.body,
    })
    expect(document.getElementById('diary-access-confirm')).toBeNull()
    expect((document.getElementById('diary-access-password') as HTMLInputElement).autocomplete)
      .toBe('new-password')
    const form = document.querySelector('form.diary-access-dialog') as HTMLFormElement
    form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})
