// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount, RouterLinkStub } from '@vue/test-utils'
import NavBar from '../NavBar.vue'
import { VaultViewModeKey, type VaultViewMode } from '../../composables/vault/viewMode'
import { useI18n } from '../../composables/useI18n'

function makeViewModeApi(initial: VaultViewMode = 'edit') {
  const mode = ref<VaultViewMode>(initial)
  return {
    mode,
    set: (m: VaultViewMode) => { mode.value = m },
    toggle: vi.fn(() => { mode.value = mode.value === 'edit' ? 'read' : 'edit' }),
  }
}

function mountNavBar(initial: VaultViewMode = 'edit') {
  const api = makeViewModeApi(initial)
  const wrapper = mount(NavBar, {
    props: { isVault: true },
    global: {
      provide: { [VaultViewModeKey as symbol]: api },
      stubs: { RouterLink: RouterLinkStub },
    },
  })
  return { wrapper, api }
}

describe('NavBar — view-toggle button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useI18n().setLocale('en')
  })
  afterEach(() => useI18n().setLocale('zh'))

  it('renders a view-toggle button', () => {
    const { wrapper } = mountNavBar()
    expect(wrapper.find('[data-testid="view-toggle"]').exists()).toBe(true)
  })

  it('places the theme toggle before the view toggle', () => {
    const { wrapper } = mountNavBar()
    expect(wrapper.findAll('.nav-actions > button').map((button) => button.classes())).toEqual([
      ['nav-search'],
      ['theme-toggle'],
      ['view-toggle'],
      ['right-rail-toggle'],
    ])
  })

  it('clicking the button calls viewModeApi.toggle()', async () => {
    const { wrapper, api } = mountNavBar()
    await wrapper.find('[data-testid="view-toggle"]').trigger('click')
    expect(api.toggle).toHaveBeenCalledOnce()
  })

  it('shows ICON_EYE in edit mode (offering "switch to read")', () => {
    const { wrapper } = mountNavBar('edit')
    expect(wrapper.find('[data-testid="view-toggle"]').attributes('aria-label')).toBe('Switch to read')
  })

  it('shows ICON_EDIT in read mode (offering "switch to edit")', () => {
    const { wrapper } = mountNavBar('read')
    expect(wrapper.find('[data-testid="view-toggle"]').attributes('aria-label')).toBe('Switch to edit')
  })
})

describe('NavBar — brand constellation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens after hovering the brand for three seconds', async () => {
    const { wrapper } = mountNavBar()
    const brand = wrapper.find('.brand')

    await brand.trigger('mouseenter')
    vi.advanceTimersByTime(2999)
    await nextTick()
    expect(wrapper.find('.brand-constellation').exists()).toBe(false)

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(wrapper.find('.brand-constellation').exists()).toBe(true)
    expect(wrapper.findAll('.brand-network-node')).toHaveLength(9)
    expect(wrapper.find('.brand').element.tagName).toBe('A')
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toBe('/')
  })

  it('closes when the pointer leaves the brand', async () => {
    const { wrapper } = mountNavBar()
    const brand = wrapper.find('.brand')

    await brand.trigger('mouseenter')
    vi.advanceTimersByTime(3000)
    await nextTick()
    await brand.trigger('mouseleave')

    expect(wrapper.find('.brand-constellation').exists()).toBe(false)
  })

  it.each(['Escape', 'blur'])('cleans the body cursor class on %s', async (event) => {
    const { wrapper } = mountNavBar()
    await wrapper.find('.brand').trigger('mouseenter')
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(document.body.classList.contains('brand-constellation-active')).toBe(true)
    if (event === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    else window.dispatchEvent(new Event('blur'))
    expect(document.body.classList.contains('brand-constellation-active')).toBe(false)
    wrapper.unmount()
  })

  it('cleans the body cursor class on unmount and before the delay fires', async () => {
    const { wrapper } = mountNavBar()
    await wrapper.find('.brand').trigger('mouseenter')
    wrapper.unmount()
    vi.advanceTimersByTime(3000)
    expect(document.body.classList.contains('brand-constellation-active')).toBe(false)
  })
})
