import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/auth-api', () => ({
  getAuthStatus: vi.fn(),
  login: vi.fn(),
  setupOwner: vi.fn(),
}))

import { getAuthStatus, login as loginApi, setupOwner as setupApi } from '../../lib/auth-api'
import { observeAuthSessionResponse } from '../../lib/auth-session'
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
