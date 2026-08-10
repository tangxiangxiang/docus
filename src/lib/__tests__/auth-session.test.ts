import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceAuthSessionGeneration,
  captureAuthSessionGeneration,
  observeAuthSessionResponse,
  resetAuthSessionForTesting,
  subscribeAuthSessionRequired,
} from '../auth-session'

afterEach(() => {
  resetAuthSessionForTesting()
  vi.restoreAllMocks()
})
describe('auth-session response observer', () => {
  it.each([
    [401, { code: 'auth-session-required' }, true],
    [401, { code: 'ai-authentication-failed' }, false],
    [401, { code: 'openai-tools-unsupported' }, false],
    [401, {}, false],
    [401, null, false],
    [403, { code: 'auth-session-required' }, false],
    [500, { code: 'auth-session-required' }, false],
  ])('classifies status=%s body=%o as %s', async (status, body, expected) => {
    const response = new Response(body === null ? 'not json' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
    await expect(observeAuthSessionResponse(response)).resolves.toBe(expected)
  })

  it('uses a clone and leaves the original response readable', async () => {
    const response = new Response(JSON.stringify({ error: 'Authentication required.', code: 'auth-session-required' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
    await expect(observeAuthSessionResponse(response)).resolves.toBe(true)
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required.',
      code: 'auth-session-required',
    })
  })

  it('emits one event with the request generation', async () => {
    const listener = vi.fn()
    const stop = subscribeAuthSessionRequired(listener)
    const requestGeneration = captureAuthSessionGeneration()
    const response = new Response(JSON.stringify({ code: 'auth-session-required' }), { status: 401 })
    await observeAuthSessionResponse(response, requestGeneration)
    expect(listener).toHaveBeenCalledWith({ generation: requestGeneration })
    stop()
    advanceAuthSessionGeneration()
  })
})
