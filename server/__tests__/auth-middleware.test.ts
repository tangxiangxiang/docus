import { afterEach, describe, expect, it } from 'vitest'
import app from '../index.js'
import { getVaultId } from '../vaultIdentity.js'
import {
  authenticatedRequest,
  closeAuthTestContext,
  createAuthenticatedTestContext,
} from './helpers/auth.js'

describe('Phase 5 central authentication boundary', () => {
  afterEach(() => {
    // Each test owns its context and closes it in the test body. This hook is
    // intentionally empty: it documents that no global test bypass exists.
  })

  it('keeps only the exact health/auth allowlist public', async () => {
    const context = createAuthenticatedTestContext()
    try {
      const health = await app.fetch(new Request('http://localhost/api/health'))
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true })

      const status = await app.fetch(new Request('http://localhost/api/auth/status'))
      expect(status.status).toBe(200)

      const unknownAuth = await app.fetch(new Request('http://localhost/api/auth/future'))
      expect(unknownAuth.status).toBe(401)
      expect(await unknownAuth.json()).toEqual({
        error: 'Authentication required.',
        code: 'auth-session-required',
      })

      const methodMismatch = await app.fetch(new Request('http://localhost/api/auth/status', { method: 'POST' }))
      expect(methodMismatch.status).toBe(401)
      const loginGet = await app.fetch(new Request('http://localhost/api/auth/login'))
      expect(loginGet.status).toBe(401)
    } finally {
      closeAuthTestContext(context)
    }
  })

  it('fails closed before handlers and protects the stable vault identity', async () => {
    const context = createAuthenticatedTestContext()
    try {
      const anonymous = await app.fetch(new Request('http://localhost/api/tree'))
      expect(anonymous.status).toBe(401)
      expect(anonymous.headers.get('cache-control')).toBe('no-store')

      for (const path of [
        '/api/files/state',
        '/api/posts',
        '/api/folders',
        '/api/recover',
        '/api/metadata/migration',
        '/api/links/index',
        '/api/ai/sessions',
        '/api/history/status',
        '/api/future-example',
      ]) {
        const response = await app.fetch(new Request(`http://localhost${path}`))
        expect(response.status, path).toBe(401)
        expect(await response.json(), path).toEqual({
          error: 'Authentication required.',
          code: 'auth-session-required',
        })
      }

      const identity = await app.fetch(authenticatedRequest(context, '/api/vault/identity'))
      expect(identity.status).toBe(200)
      expect(identity.headers.get('cache-control')).toBe('no-store')
      expect(await identity.json()).toEqual({ vaultId: getVaultId() })

      const tree = await app.fetch(authenticatedRequest(context, '/api/tree'))
      expect(tree.status).toBe(200)
      expect(tree.headers.get('cache-control')).toBe('no-store')

      const unknown = await app.fetch(authenticatedRequest(context, '/api/future-example'))
      expect(unknown.status).toBe(404)
      expect(unknown.headers.get('cache-control')).toBe('no-store')
    } finally {
      closeAuthTestContext(context)
    }
  })

  it('applies the existing CSRF/content policy to protected mutations', async () => {
    const context = createAuthenticatedTestContext()
    try {
      const wrongOrigin = await app.fetch(authenticatedRequest(context, '/api/posts', {
        method: 'POST',
        origin: 'http://evil.example',
        body: { path: 'blocked', title: 'Blocked' },
      }))
      expect(wrongOrigin.status).toBe(403)
      expect(await wrongOrigin.json()).toMatchObject({ code: 'csrf-origin-mismatch' })
      expect(wrongOrigin.headers.get('cache-control')).toBe('no-store')

      const missingContentType = await app.fetch(new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: { Cookie: context.cookie },
        body: JSON.stringify({ path: 'blocked', title: 'Blocked' }),
      }))
      expect(missingContentType.status).toBe(415)
      expect(await missingContentType.json()).toMatchObject({ code: 'invalid-content-type' })

      const bodylessDelete = await app.fetch(new Request('http://localhost/api/posts/does-not-exist', {
        method: 'DELETE',
        headers: { Cookie: context.cookie },
      }))
      expect(bodylessDelete.status).not.toBe(415)
    } finally {
      closeAuthTestContext(context)
    }
  })
})
