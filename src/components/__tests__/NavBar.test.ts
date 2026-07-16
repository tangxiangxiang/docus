// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
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
