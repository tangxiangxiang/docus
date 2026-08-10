import { getCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import { checkCsrfHeaders, checkJsonContentType, isUnsafeMethod } from './csrf.js'
import { getAuthRuntime } from './runtime.js'
import { selectSessionToken } from './session.js'

const PUBLIC_ENDPOINTS = new Set([
  'GET /api/health',
  'GET /api/auth/status',
  'POST /api/auth/setup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
])

function jsonError(c: any, status: number, error: string, code: string): Response {
  c.header('Cache-Control', 'no-store')
  return c.json({ error, code }, status)
}

function isPublicEndpoint(method: string, path: string): boolean {
  return PUBLIC_ENDPOINTS.has(`${method.toUpperCase()} ${path}`)
}

function requestHasBody(request: Request): boolean {
  // Browser DELETE/fetch requests are commonly forwarded by the Vite
  // adapter with an empty stream. Prefer the wire-level length when it is
  // available so a bodyless mutation is not mistaken for a body-bearing one.
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const length = Number(contentLength)
    if (Number.isFinite(length)) return length > 0
  }
  return request.body !== null
}

/**
 * The single application authentication boundary. It intentionally owns no
 * domain behavior: route handlers remain responsible for their existing
 * validation and persistence semantics.
 */
export const authBoundary: MiddlewareHandler = async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (isPublicEndpoint(method, c.req.path)) return next()

  // Set the protected response cache policy before the handler runs. Hono
  // merges context headers into handler responses, including errors.
  c.header('Cache-Control', 'no-store')

  const runtime = getAuthRuntime()
  if (!runtime) {
    return jsonError(c, 503, 'Authentication is temporarily unavailable.', 'auth-unavailable')
  }

  let status: ReturnType<NonNullable<ReturnType<typeof getAuthRuntime>>['service']['status']>
  try {
    const rawToken = selectSessionToken(getCookie(c), runtime.config)
    status = runtime.service.status(rawToken)
  } catch {
    return jsonError(c, 503, 'Authentication is temporarily unavailable.', 'auth-unavailable')
  }
  if (!status.authenticated || !status.user) {
    return jsonError(c, 401, 'Authentication required.', 'auth-session-required')
  }

  // Reuse the lookup result already produced by status(); maintenance must
  // never perform a second raw-token lookup. A valid status without its
  // session record is an internal consistency failure, not an invitation to
  // continue into the protected handler.
  if (!status.session || status.session.status !== 'valid' || !status.session.session) {
    return jsonError(c, 503, 'Authentication is temporarily unavailable.', 'auth-unavailable')
  }
  try {
    runtime.service.maintainAuthenticatedSession(status.session.session)
  } catch {
    return jsonError(c, 503, 'Authentication is temporarily unavailable.', 'auth-unavailable')
  }

  // Keep the context deliberately safe and minimal. Existing handlers do
  // not depend on it yet; it is the future owner-identity seam.
  c.set('authUser', { id: status.user.id, username: status.user.username })

  if (isUnsafeMethod(method)) {
    const csrf = checkCsrfHeaders(c.req.raw.headers, method, runtime.config)
    if (!csrf.ok) return jsonError(c, 403, csrf.message, csrf.code)

    // A body-bearing mutation must be JSON. Request.body is inspected
    // without consuming the stream, so streaming handlers remain intact.
    if (requestHasBody(c.req.raw)) {
      const content = checkJsonContentType(c.req.raw.headers)
      if (!content.ok) return jsonError(c, 415, content.message, content.code)
    }
  }

  return next()
}

export { PUBLIC_ENDPOINTS, isPublicEndpoint }
