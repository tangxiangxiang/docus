import Database from 'better-sqlite3'
import { applyMigrations } from '../../db.js'
import { parsePublicOrigin, type AuthConfig } from '../../auth/config.js'
import type { KdfGuard } from '../../auth/kdfGuard.js'
import { createAuthRuntime, installAuthRuntimeForTesting, resetAuthRuntimeForTesting, type AuthRuntime } from '../../auth/runtime.js'
import type { RateLimiterOptions } from '../../auth/rateLimit.js'

export const TEST_SETUP_TOKEN = 'phase-2-test-token-0123456789abcdef'

export type AuthTestContext = {
  readonly db: Database.Database
  readonly runtime: AuthRuntime
  readonly logs: string[]
}

export function createAuthTestContext(options: {
  origin?: string
  setupToken?: string
  revokeSessionsOnStart?: boolean
  now?: () => number
  logger?: (message: string) => void
  rateLimiterOptions?: RateLimiterOptions
  fallbackBootstrap?: boolean
  kdfGuard?: KdfGuard
} = {}): AuthTestContext {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  const logs: string[] = []
  const config: AuthConfig = {
    ...parsePublicOrigin(options.origin ?? 'http://127.0.0.1:3000'),
    revokeSessionsOnStart: options.revokeSessionsOnStart ?? false,
  }
  const runtime = createAuthRuntime({
    db,
    config,
    env: options.fallbackBootstrap
      ? {}
      : { DOCUS_SETUP_TOKEN: options.setupToken ?? TEST_SETUP_TOKEN },
    logger: (message) => {
      logs.push(message)
      options.logger?.(message)
    },
    now: options.now,
    rateLimiterOptions: options.rateLimiterOptions,
    kdfGuard: options.kdfGuard,
  })
  installAuthRuntimeForTesting(runtime)
  return { db, runtime, logs }
}

export function closeAuthTestContext(context: AuthTestContext): void {
  resetAuthRuntimeForTesting()
  if (context.db.open) context.db.close()
}

export function jsonRequest(
  path: string,
  init: { method: string; body?: unknown; origin?: string; cookie?: string; contentType?: string },
): Request {
  const headers = new Headers()
  if (init.origin !== undefined) headers.set('Origin', init.origin)
  if (init.cookie !== undefined) headers.set('Cookie', init.cookie)
  if (init.body !== undefined) {
    if (init.contentType !== '') headers.set('Content-Type', init.contentType ?? 'application/json')
  }
  return new Request(`http://localhost${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
}

export function cookieFromResponse(response: Response): string {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('response did not set a cookie')
  return setCookie.split(';', 1)[0]
}

export function countRows(db: Database.Database, table: string): number {
  if (!/^[a-z_]+$/.test(table)) throw new Error('unsafe table name in test')
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)
}
