// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { AuthApiError } from '../../lib/auth-api'
import LoginView from '../LoginView.vue'
import SetupView from '../SetupView.vue'
import { useI18n } from '../../composables/useI18n'

const mocks = vi.hoisted(() => ({
  route: { query: {} as Record<string, unknown> },
  router: {
    replace: vi.fn(),
    resolve: vi.fn((target: unknown) => target),
  },
  auth: {
    submitting: { value: false },
    login: vi.fn(),
    setup: vi.fn(),
    refreshStatus: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}))

vi.mock('../../composables/useAuth', () => ({
  useAuth: () => mocks.auth,
}))

const wrappers: VueWrapper[] = []

function mountLogin() {
  const wrapper = mount(LoginView, { attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}

function mountSetup() {
  const wrapper = mount(SetupView, { attachTo: document.body })
  wrappers.push(wrapper)
  return wrapper
}

function fill(wrapper: VueWrapper, selector: string, value: string) {
  const input = wrapper.get(selector)
  input.setValue(value)
  return input
}

function error(code: string, status = 401, retryAfterSeconds?: number): AuthApiError {
  return new AuthApiError('request failed', status, { code }, retryAfterSeconds)
}

beforeEach(() => {
  useI18n().setLocale('zh')
  mocks.route.query = {}
  mocks.router.replace.mockReset()
  mocks.router.resolve.mockClear()
  mocks.auth.submitting = ref(false)
  mocks.auth.login.mockReset()
  mocks.auth.setup.mockReset()
  mocks.auth.refreshStatus.mockReset()
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  useI18n().setLocale('zh')
})

describe('LoginView', () => {
  it('submits username and password, including Enter/form submission', async () => {
    mocks.auth.login.mockResolvedValue({ authenticated: true, user: { id: 1, username: 'owner' } })
    mocks.route.query = { redirect: '/vault/a?view=read#section' }
    const wrapper = mountLogin()
    await fill(wrapper, '#login-username', 'owner').trigger('input')
    await fill(wrapper, '#login-password', 'secret').trigger('input')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.auth.login).toHaveBeenCalledWith({ username: 'owner', password: 'secret' })
    expect(mocks.router.replace).toHaveBeenCalledWith('/vault/a?view=read#section')
  })

  it('focuses the username field and prevents duplicate pending submissions', async () => {
    let resolveLogin: (() => void) | undefined
    mocks.auth.login.mockImplementation(() => {
      mocks.auth.submitting.value = true
      return new Promise<void>((resolve) => { resolveLogin = resolve })
    })
    const wrapper = mountLogin()
    await fill(wrapper, '#login-username', 'owner').trigger('input')
    await fill(wrapper, '#login-password', 'secret').trigger('input')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper.get('#login-username').element)

    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    await nextTick()
    expect(mocks.auth.login).toHaveBeenCalledOnce()
    expect(wrapper.get('.auth-submit').attributes('disabled')).toBeDefined()
    resolveLogin?.()
  })

  it('shows generic invalid-credentials and rate-limit errors without user enumeration', async () => {
    mocks.auth.login.mockRejectedValueOnce(error('invalid-credentials'))
    const wrapper = mountLogin()
    await fill(wrapper, '#login-username', 'owner').trigger('input')
    await fill(wrapper, '#login-password', 'wrong').trigger('input')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('用户名或密码错误')
    expect(wrapper.get('#login-username').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#login-username').attributes('aria-describedby')).toBe('login-error')

    mocks.auth.login.mockRejectedValueOnce(error('auth-rate-limited', 429, 12))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('12')
  })

  it('uses a safe fallback for malicious redirects and generic failures', async () => {
    mocks.route.query = { redirect: 'https://evil.example' }
    mocks.auth.login.mockRejectedValue(new Error('network down'))
    const wrapper = mountLogin()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('认证服务暂时不可用')
    expect(wrapper.get('label[for="login-username"]')).toBeTruthy()

    mocks.auth.login.mockResolvedValue({ authenticated: true, user: { id: 1, username: 'owner' } })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.router.replace).toHaveBeenCalledWith('/vault')
  })
})

describe('SetupView', () => {
  it('validates password confirmation without a network request', async () => {
    const wrapper = mountSetup()
    await fill(wrapper, '#setup-password', 'secret').trigger('input')
    await fill(wrapper, '#setup-confirm-password', 'different').trigger('input')
    await wrapper.get('form').trigger('submit')

    expect(mocks.auth.setup).not.toHaveBeenCalled()
    expect(wrapper.get('#setup-confirm-error').text()).toContain('两次输入的密码不一致')
    expect(wrapper.get('#setup-confirm-password').attributes('aria-invalid')).toBe('true')
  })

  it('sends only bootstrapToken, username, and password, then restores a deep link', async () => {
    mocks.route.query = { redirect: '/vault/inbox/note?view=read#section' }
    mocks.auth.setup.mockResolvedValue({ authenticated: true, user: { id: 1, username: 'owner' } })
    const wrapper = mountSetup()
    await fill(wrapper, '#setup-token', 'bootstrap-secret').trigger('input')
    await fill(wrapper, '#setup-username', 'owner').trigger('input')
    await fill(wrapper, '#setup-password', 'secret').trigger('input')
    await fill(wrapper, '#setup-confirm-password', 'secret').trigger('input')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.auth.setup).toHaveBeenCalledWith({
      bootstrapToken: 'bootstrap-secret',
      username: 'owner',
      password: 'secret',
    })
    expect(JSON.stringify(mocks.auth.setup.mock.calls[0]?.[0])).not.toContain('confirmPassword')
    expect(mocks.router.replace).toHaveBeenCalledWith('/vault/inbox/note?view=read#section')
  })

  it('shows bootstrap-invalid and rate-limit errors', async () => {
    mocks.auth.setup.mockRejectedValueOnce(error('bootstrap-invalid'))
    const wrapper = mountSetup()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Bootstrap Token 无效')

    mocks.auth.setup.mockRejectedValueOnce(error('auth-rate-limited', 429, 10))
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('10')
  })

  it('re-resolves already-initialized setup instead of getting stuck', async () => {
    mocks.route.query = { redirect: '/vault/inbox/note' }
    mocks.auth.setup.mockRejectedValue(error('already-initialized', 409))
    mocks.auth.refreshStatus.mockResolvedValue('unauthenticated')
    const wrapper = mountSetup()
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mocks.auth.refreshStatus).toHaveBeenCalledOnce()
    expect(mocks.router.replace).toHaveBeenCalledWith({
      name: 'login',
      query: { redirect: '/vault/inbox/note' },
    })
  })

  it('rejects malicious redirects after successful setup', async () => {
    mocks.route.query = { redirect: 'https://evil.example' }
    mocks.auth.setup.mockResolvedValue({ authenticated: true, user: { id: 1, username: 'owner' } })
    const wrapper = mountSetup()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.router.replace).toHaveBeenCalledWith('/vault')
  })
})
