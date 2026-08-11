// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import AccountMenu from '../AccountMenu.vue'
import { useI18n } from '../../../composables/useI18n'

const wrappers: VueWrapper[] = []

function mountAccount(props: { username?: string; logoutBusy?: boolean } = {}) {
  const wrapper = mount(AccountMenu, {
    props: { username: 'xiangxiang', ...props },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => useI18n().setLocale('en'))

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  useI18n().setLocale('zh')
})

describe('AccountMenu', () => {
  it('opens a compact account menu with the current username and toggles closed', async () => {
    const wrapper = mountAccount()
    const button = wrapper.get('[data-testid="account-button"]')

    expect(button.element.tagName).toBe('BUTTON')
    expect(button.attributes('aria-label')).toBe('Account')
    expect(button.attributes('aria-haspopup')).toBe('menu')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-testid="account-menu"]').exists()).toBe(false)

    await button.trigger('click')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="account-menu"]').text()).toContain('xiangxiang')
    expect(wrapper.get('[data-testid="account-logout"]').text()).toContain('Log out')

    await button.trigger('click')
    expect(wrapper.find('[data-testid="account-menu"]').exists()).toBe(false)
  })

  it('closes on outside pointer and Escape, returning focus to the account button', async () => {
    const wrapper = mountAccount()
    const button = wrapper.get('[data-testid="account-button"]')

    await button.trigger('click')
    document.dispatchEvent(new Event('pointerdown'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="account-menu"]').exists()).toBe(false)

    await button.trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="account-menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(button.element)
  })

  it('emits a logout intent without making an authentication request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const wrapper = mountAccount()

    await wrapper.get('[data-testid="account-button"]').trigger('click')
    await wrapper.get('[data-testid="account-logout"]').trigger('click')

    expect(wrapper.emitted('logout')).toHaveLength(1)
    expect(wrapper.find('[data-testid="account-menu"]').exists()).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('disables the account entry and prevents duplicate logout intents while busy', async () => {
    const wrapper = mountAccount()
    const button = wrapper.get('[data-testid="account-button"]')

    await button.trigger('click')
    await wrapper.setProps({ logoutBusy: true })

    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('[data-testid="account-menu"]').exists()).toBe(false)
    expect(wrapper.emitted('logout')).toBeUndefined()
  })
})
