import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../index.js'
import { createSession, findSessionByRawToken } from '../auth/session.js'
import {
  closeAuthTestContext,
  cookieFromResponse,
  countRows,
  createAuthTestContext,
  jsonRequest,
  type AuthTestContext,
} from './helpers/auth.js'
import { resetAuthRuntimeForTesting } from '../auth/runtime.js'

let context: AuthTestContext

beforeEach(() => {
  context = createAuthTestContext()
})

afterEach(() => {
  closeAuthTestContext(context)
})

async function setupOwner(token = 'phase-2-test-token'): Promise<{ cookie: string; body: any; response: Response }> {
  const response = await app.fetch(jsonRequest('/api/auth/setup', {
    method: 'POST',
    origin: context.runtime.config.publicOrigin,
    body: { bootstrapToken: token, username: 'Admin', password: 'correct horse battery staple' },
  }))
  const body = await response.json()
  return { cookie: cookieFromResponse(response), body, response }
}

describe('Phase 2 auth routes', () => {
  it('reports setup state, creates one owner/session, and never returns secrets', async () => {
    const initial = await app.fetch(new Request('http://localhost/api/auth/status'))
    expect(initial.status).toBe(200)
    expect(initial.headers.get('cache-control')).toBe('no-store')
    expect(await initial.json()).toEqual({ authenticated: false, setupRequired: true })

    const created = await setupOwner()
    expect(created.response.status).toBe(201)
    expect(created.body).toEqual({
      authenticated: true,
      user: { id: 1, username: 'admin' },
    })
    expect(JSON.stringify(created.body)).not.toContain('phase-2-test-token')
    expect(created.response.headers.get('set-cookie')).toMatch(/docus_session=/)
    expect(created.response.headers.get('set-cookie')).toMatch(/HttpOnly/)
    expect(created.response.headers.get('set-cookie')).toMatch(/SameSite=Lax/)
    expect(created.response.headers.get('set-cookie')).toMatch(/Path=\//)
    expect(created.response.headers.get('set-cookie')).toMatch(/Max-Age=2592000/)
    expect(countRows(context.db, 'users')).toBe(1)
    expect(countRows(context.db, 'auth_instance')).toBe(1)
    expect(countRows(context.db, 'auth_sessions')).toBe(1)

    const status = await app.fetch(new Request('http://localhost/api/auth/status', {
      headers: { Cookie: created.cookie },
    }))
    expect(status.status).toBe(200)
    expect(await status.json()).toEqual({
      authenticated: true,
      setupRequired: false,
      user: { id: 1, username: 'admin' },
    })

    const second = await app.fetch(jsonRequest('/api/auth/setup', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { bootstrapToken: 'wrong-token', username: 'other', password: 'correct horse battery staple' },
    }))
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({ code: 'already-initialized' })
  })

  it('uses bootstrap-invalid for both missing and incorrect setup tokens', async () => {
    const missing = await app.fetch(jsonRequest('/api/auth/setup', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { username: 'admin', password: 'correct horse battery staple' },
    }))
    const wrong = await app.fetch(jsonRequest('/api/auth/setup', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { bootstrapToken: 'wrong-token', username: 'admin', password: 'correct horse battery staple' },
    }))
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({ error: 'Bootstrap token is invalid.', code: 'bootstrap-invalid' })
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toEqual({ error: 'Bootstrap token is invalid.', code: 'bootstrap-invalid' })
  })

  it('runs a concurrent setup race with exactly one owner and no orphan user', async () => {
    closeAuthTestContext(context)
    context = createAuthTestContext()
    const requests = [1, 2].map(() => app.fetch(jsonRequest('/api/auth/setup', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { bootstrapToken: 'phase-2-test-token', username: 'admin', password: 'correct horse battery staple' },
    })))
    const responses = await Promise.all(requests)
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    expect(countRows(context.db, 'users')).toBe(1)
    expect(countRows(context.db, 'auth_instance')).toBe(1)
  })

  it('accepts the one-time generated fallback token without persisting it', async () => {
    closeAuthTestContext(context)
    context = createAuthTestContext({ fallbackBootstrap: true })
    expect(context.logs).toHaveLength(1)
    const token = context.logs[0]!.split(': ').at(-1)!
    const created = await setupOwner(token)
    expect(created.response.status).toBe(201)
    expect(context.logs).toHaveLength(1)
    const authRows = context.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'auth_%'").all() as Array<{ name: string }>
    const serialized = JSON.stringify(authRows)
    expect(serialized).not.toContain(token)
  })

  it('uses identical generic public failures for wrong, unknown, and disabled owners', async () => {
    const created = await setupOwner()
    const request = (username: string, password: string) => app.fetch(jsonRequest('/api/auth/login', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { username, password },
    }))

    const wrong = await request('admin', 'wrong password')
    const unknown = await request('unknown', 'wrong password')
    context.db.prepare('UPDATE users SET disabled = 1 WHERE id = 1').run()
    const disabled = await request('admin', 'correct horse battery staple')
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(disabled.status).toBe(401)
    const wrongBody = await wrong.json()
    expect(await unknown.json()).toEqual(wrongBody)
    expect(await disabled.json()).toEqual(wrongBody)
    expect(wrongBody).toEqual({ error: 'Invalid username or password.', code: 'invalid-credentials' })
    expect(created.cookie).toMatch(/^docus_session=/)
  })

  it('does not pre-lock a hot username bucket before verifying a correct password', async () => {
    closeAuthTestContext(context)
    context = createAuthTestContext({ rateLimiterOptions: { threshold: 2, baseRetryMs: 10, maxDelayMs: 100 } })
    await setupOwner()
    const login = (password: string) => app.fetch(jsonRequest('/api/auth/login', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { username: 'admin', password },
    }))
    expect((await login('wrong password')).status).toBe(401)
    expect((await login('wrong password')).status).toBe(429)
    const correct = await login('correct horse battery staple')
    expect(correct.status).toBe(200)
    expect(context.runtime.loginLimiter.size).toBe(0)
  })

  it('creates a fresh session for every successful login', async () => {
    await setupOwner()
    const login = () => app.fetch(jsonRequest('/api/auth/login', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { username: 'admin', password: 'correct horse battery staple' },
    }))
    const first = await login()
    const second = await login()
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(cookieFromResponse(first)).not.toBe(cookieFromResponse(second))
    expect(countRows(context.db, 'auth_sessions')).toBe(3)
  })

  it('logout is idempotent, reads only the active profile, and clears both cookie names', async () => {
    const created = await setupOwner()
    const logout = await app.fetch(jsonRequest('/api/auth/logout', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      cookie: created.cookie,
    }))
    expect(logout.status).toBe(204)
    const setCookies = (logout.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [logout.headers.get('set-cookie') ?? '']
    expect(setCookies.some((value) => value.startsWith('__Host-docus_session=') || value.startsWith('docus_session='))).toBe(true)
    expect(setCookies.join('\n')).toContain('__Host-docus_session=')
    expect(setCookies.join('\n')).toContain('docus_session=')
    const status = await app.fetch(new Request('http://localhost/api/auth/status', {
      headers: { Cookie: created.cookie },
    }))
    expect(await status.json()).toEqual({ authenticated: false, setupRequired: false })

    const noCookieLogout = await app.fetch(jsonRequest('/api/auth/logout', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
    }))
    expect(noCookieLogout.status).toBe(204)
  })

  it('never accepts the alternate secure cookie in a local HTTP profile', async () => {
    await setupOwner()
    const created = createSession(context.db, 1, { now: Date.now() })
    const status = await app.fetch(new Request('http://localhost/api/auth/status', {
      headers: { Cookie: `__Host-docus_session=${created.rawToken}` },
    }))
    expect(await status.json()).toEqual({ authenticated: false, setupRequired: false })
    expect(findSessionByRawToken(context.db, created.rawToken).status).toBe('valid')
  })

  it('uses secure __Host cookies for HTTPS origins', async () => {
    closeAuthTestContext(context)
    context = createAuthTestContext({ origin: 'https://docus.example.com' })
    const created = await setupOwner()
    const header = created.response.headers.get('set-cookie')!
    expect(header).toMatch(/^__Host-docus_session=/)
    expect(header).toMatch(/Secure/)
    expect(header).toMatch(/HttpOnly/)
    expect(header).toMatch(/SameSite=Lax/)
    expect(header).toMatch(/Path=\//)
    expect(header).not.toMatch(/Domain=/)
  })

  it('rejects cross-origin/cross-site mutations and non-JSON setup bodies', async () => {
    const mismatch = await app.fetch(jsonRequest('/api/auth/setup', {
      method: 'POST',
      origin: 'https://evil.example',
      body: { bootstrapToken: 'phase-2-test-token', username: 'admin', password: 'correct horse battery staple' },
    }))
    expect(mismatch.status).toBe(403)
    expect(await mismatch.json()).toMatchObject({ code: 'csrf-origin-mismatch' })

    const crossSite = jsonRequest('/api/auth/setup', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      body: { bootstrapToken: 'phase-2-test-token', username: 'admin', password: 'correct horse battery staple' },
    })
    crossSite.headers.set('Sec-Fetch-Site', 'cross-site')
    const crossSiteResponse = await app.fetch(crossSite)
    expect(crossSiteResponse.status).toBe(403)
    expect(await crossSiteResponse.json()).toMatchObject({ code: 'csrf-cross-site' })

    const missingType = await app.fetch(jsonRequest('/api/auth/setup', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      contentType: '',
      body: { bootstrapToken: 'phase-2-test-token', username: 'admin', password: 'correct horse battery staple' },
    }))
    expect(missingType.status).toBe(415)
    expect(await missingType.json()).toMatchObject({ code: 'invalid-content-type' })
  })

  it('keeps the existing anonymous health response and handles an uninitialized auth runtime safely', async () => {
    const health = await app.fetch(new Request('http://localhost/api/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ ok: true, vaultId: expect.any(String) })

    closeAuthTestContext(context)
    const status = await app.fetch(new Request('http://localhost/api/auth/status'))
    expect(status.status).toBe(503)
    expect(status.headers.get('cache-control')).toBe('no-store')
    expect(await status.json()).toEqual({
      error: 'Authentication is temporarily unavailable.',
      code: 'auth-unavailable',
    })
    // Prevent afterEach from attempting to close the same context twice.
    context = createAuthTestContext()
  })
})
