// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import NavBar from '../NavBar.vue'
import { VaultViewModeKey, type VaultViewMode } from '../../composables/vault/viewMode'
import { useI18n } from '../../composables/useI18n'
import { useScopeFilter } from '../../composables/vault/useScopeFilter'
import { AppShellContextKey } from '../../composables/appShellContext'

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

  it('does not render a logout action in the top-right chrome', () => {
    const { wrapper } = mountNavBar()
    expect(wrapper.find('[data-testid="logout-button"]').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/log out/i)
  })

  it('keeps the top chrome busy without rendering a logout button', () => {
    const api = makeViewModeApi()
    const wrapper = mount(NavBar, {
      props: { isVault: true, logoutBusy: true },
      global: { provide: { [VaultViewModeKey as symbol]: api } },
    })
    expect(wrapper.find('.navbar').attributes('inert')).toBeDefined()
    expect(wrapper.find('.navbar').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('[data-testid="logout-button"]').exists()).toBe(false)
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

  it('hides reading and right-rail controls on Diary Calendar Home', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/vault', name: 'vault', component: { template: '<div />' } }],
    })
    await router.push('/vault')
    await router.isReady()

    const scope = useScopeFilter()
    scope.activeScope.value = 'diary'
    const api = makeViewModeApi()
    const wrapper = mount(NavBar, {
      props: { isVault: true },
      global: {
        plugins: [router],
        provide: { [VaultViewModeKey as symbol]: api },
      },
    })

    expect(wrapper.find('[data-testid="view-toggle"]').exists()).toBe(false)
    expect(wrapper.find('.right-rail-toggle').exists()).toBe(false)

    scope.activeScope.value = 'note'
    await nextTick()
    expect(wrapper.find('[data-testid="view-toggle"]').exists()).toBe(true)
    expect(wrapper.find('.right-rail-toggle').exists()).toBe(true)
    wrapper.unmount()
  })

  it('follows the resolved Calendar visibility when a document URL is retained', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/vault/:pathMatch(.*)*', name: 'vault-doc', component: { template: '<div />' } }],
    })
    await router.push('/vault/inbox/kept-note')
    await router.isReady()

    const calendarVisible = ref(true)
    const api = makeViewModeApi()
    const wrapper = mount(NavBar, {
      props: { isVault: true },
      global: {
        plugins: [router],
        provide: {
          [VaultViewModeKey as symbol]: api,
          [AppShellContextKey as symbol]: {
            settingsRequestTick: ref(0),
            diaryCalendarVisible: calendarVisible,
          },
        },
      },
    })

    expect(wrapper.find('[data-testid="view-toggle"]').exists()).toBe(false)
    expect(wrapper.find('.right-rail-toggle').exists()).toBe(false)

    calendarVisible.value = false
    await nextTick()
    expect(wrapper.find('[data-testid="view-toggle"]').exists()).toBe(true)
    expect(wrapper.find('.right-rail-toggle').exists()).toBe(true)
    wrapper.unmount()
  })

  it('places the account entry in the navbar actions and forwards settings', async () => {
    const { wrapper } = mountNavBar()

    expect(wrapper.find('.nav-actions [data-testid="account-button"]').exists()).toBe(true)
    expect(wrapper.find('.nav-actions [data-testid="account-button"]').element.closest('.activity-bar')).toBeNull()

    await wrapper.find('[data-testid="account-button"]').trigger('click')
    await wrapper.find('[data-testid="account-settings"]').trigger('click')

    expect(wrapper.emitted('open-settings')).toHaveLength(1)
  })
})

describe('NavBar — scope chips', () => {
  beforeEach(() => {
    useI18n().setLocale('en')
    useScopeFilter().activeScope.value = 'note'
  })
  afterEach(() => useI18n().setLocale('zh'))

  it('shows the content-oriented scope names', () => {
    const { wrapper } = mountNavBar()

    expect(wrapper.findAll('.scope-chip')[0].attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.scope-chip-label').map((chip) => chip.text())).toEqual([
      'note',
      'diary',
      'ledger',
    ])
  })

  it('uses content scopes instead of exposing individual vault roots', async () => {
    const { wrapper } = mountNavBar()
    const chips = wrapper.findAll('.scope-chip')

    await chips[1].trigger('click')

    expect(chips[1].attributes('aria-pressed')).toBe('true')
    expect(chips[1].attributes('aria-label')).toBe('Current scope: diary')
  })

  it('uses the ledger scope chip as the Bills entry', async () => {
    const api = makeViewModeApi()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/vault', name: 'vault', component: { template: '<div />' } },
        { path: '/bills', name: 'bills', component: { template: '<div />' } },
      ],
    })
    await router.push('/vault')
    await router.isReady()

    const wrapper = mount(NavBar, {
      props: { isVault: true },
      global: {
        plugins: [router],
        provide: { [VaultViewModeKey as symbol]: api },
      },
    })

    expect(wrapper.find('[data-testid="bills-nav-link"]').exists()).toBe(false)
    await wrapper.findAll('.scope-chip')[2].trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(router.currentRoute.value.name).toBe('bills')
  })

  it('only renders scope chips in the Vault chrome', () => {
    const api = makeViewModeApi()
    const wrapper = mount(NavBar, {
      props: { isVault: false },
      global: {
        provide: { [VaultViewModeKey as symbol]: api },
      },
    })

    expect(wrapper.find('.scope-chips').exists()).toBe(false)
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
    expect(wrapper.find('.brand').element.tagName).toBe('BUTTON')
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

  it('cleans the body cursor class when the document becomes hidden', async () => {
    const { wrapper } = mountNavBar()
    await wrapper.find('.brand').trigger('mouseenter')
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(document.body.classList.contains('brand-constellation-active')).toBe(true)

    const originalHidden = document.hidden
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.body.classList.contains('brand-constellation-active')).toBe(false)
    Object.defineProperty(document, 'hidden', { configurable: true, value: originalHidden })
    wrapper.unmount()
  })

  it('cleans the body cursor class when the route changes', async () => {
    const api = makeViewModeApi()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/vault', component: { template: '<div />' } },
      ],
    })
    const wrapper = mount(NavBar, {
      props: { isVault: true },
      global: {
        plugins: [router],
        provide: { [VaultViewModeKey as symbol]: api },
      },
    })
    await router.push('/')
    await router.isReady()
    await wrapper.find('.brand').trigger('mouseenter')
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(document.body.classList.contains('brand-constellation-active')).toBe(true)

    await router.push('/vault')
    await nextTick()
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
