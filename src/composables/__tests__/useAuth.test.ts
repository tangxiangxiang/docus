import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth-api', () => ({
  getAuthStatus: vi.fn(),
  login: vi.fn(),
  setupOwner: vi.fn(),
}))

import { getAuthStatus, login as loginApi, setupOwner as setupApi } from '../../lib/auth-api'
import { captureAuthSessionGeneration, observeAuthSessionResponse } from '../../lib/auth-session'
import { useAuth } from '../useAuth'

const auth = useAuth()

beforeEach(() => {
  auth.resetAuthForTesting()
  vi.mocked(getAuthStatus).mockReset()
  vi.mocked(loginApi).mockReset()
  vi.mocked(setupApi).mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('useAuth singleton coordinator', () => {
  it('deduplicates concurrent hydration and maps setup state', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false, setupRequired: true })
    const [first, second] = await Promise.all([auth.ensureHydrated(), auth.ensureHydrated()])
    expect(first).toBe('setup-required')
    expect(second).toBe('setup-required')
    expect(getAuthStatus).toHaveBeenCalledOnce()
  })

  it('maps a valid status to authenticated safe user data', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({
      authenticated: true,
      setupRequired: false,
      user: { id: 3, username: 'owner' },
    })
    await auth.ensureHydrated()
    expect(auth.state.value).toBe('authenticated')
    expect(auth.user.value).toEqual({ id: 3, username: 'owner' })
  })

  it('keeps a generic hydration failure unknown and allows an explicit retry', async () => {
    vi.mocked(getAuthStatus).mockRejectedValueOnce(new Error('network down'))
    await expect(auth.ensureHydrated()).resolves.toBe('unknown')
    expect(auth.state.value).toBe('unknown')
    expect(auth.hydrationError.value).toBeInstanceOf(Error)

    vi.mocked(getAuthStatus).mockResolvedValueOnce({ authenticated: false, setupRequired: true })
    await expect(auth.refreshStatus()).resolves.toBe('setup-required')
    expect(auth.state.value).toBe('setup-required')
  })

  it('does not let late hydration overwrite a successful login', async () => {
    let resolveStatus: ((value: { authenticated: false; setupRequired: false }) => void) | undefined
    vi.mocked(getAuthStatus).mockImplementation(() => new Promise((resolve) => { resolveStatus = resolve }))
    const hydration = auth.ensureHydrated()
    vi.mocked(loginApi).mockResolvedValue({ authenticated: true, user: { id: 1, username: 'owner' } })
    await auth.login({ username: 'owner', password: 'secret' })
    resolveStatus?.({ authenticated: false, setupRequired: false })
    await hydration
    expect(auth.state.value).toBe('authenticated')
    expect(auth.user.value).toEqual({ id: 1, username: 'owner' })
  })

  it('does not let a failed login overwrite the existing authenticated state', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({
      authenticated: true,
      setupRequired: false,
      user: { id: 1, username: 'owner' },
    })
    await auth.ensureHydrated()
    vi.mocked(loginApi).mockRejectedValue(new Error('invalid credentials'))

    await expect(auth.login({ username: 'owner', password: 'wrong' })).rejects.toThrow('invalid credentials')
    expect(auth.state.value).toBe('authenticated')
    expect(auth.user.value).toEqual({ id: 1, username: 'owner' })
  })

  it('moves to authenticated after setup and clears an earlier expiry marker', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false, setupRequired: true })
    await auth.ensureHydrated()
    vi.mocked(setupApi).mockResolvedValue({ authenticated: true, user: { id: 1, username: 'owner' } })

    await auth.setup({ bootstrapToken: 'bootstrap', username: 'owner', password: 'secret' })

    expect(auth.state.value).toBe('authenticated')
    expect(auth.user.value).toEqual({ id: 1, username: 'owner' })
    expect(auth.sessionExpired.value).toBe(false)
  })

  it('does not let an old-generation expiry event invalidate a newer login', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false, setupRequired: false })
    await auth.ensureHydrated()
    const oldGeneration = captureAuthSessionGeneration()
    vi.mocked(loginApi).mockResolvedValue({ authenticated: true, user: { id: 1, username: 'owner' } })
    await auth.login({ username: 'owner', password: 'secret' })

    await observeAuthSessionResponse(
      new Response(JSON.stringify({ code: 'auth-session-required' }), { status: 401 }),
      oldGeneration,
    )

    expect(auth.state.value).toBe('authenticated')
    expect(auth.sessionExpired.value).toBe(false)
  })

  it('transitions once for the Docus-owned expiry response', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: true, setupRequired: false, user: { id: 1, username: 'owner' } })
    await auth.ensureHydrated()
    const expired = vi.fn()
    const stop = auth.onSessionExpired(expired)
    await observeAuthSessionResponse(new Response(JSON.stringify({ code: 'auth-session-required' }), { status: 401 }))
    await observeAuthSessionResponse(new Response(JSON.stringify({ code: 'auth-session-required' }), { status: 401 }))
    expect(auth.state.value).toBe('unauthenticated')
    expect(auth.sessionExpired.value).toBe(true)
    expect(expired).toHaveBeenCalledOnce()
    stop()
  })
})
