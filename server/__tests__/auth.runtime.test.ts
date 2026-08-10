import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { statSync } from 'node:fs'
import path from 'node:path'
import { applyMigrations } from '../db.js'
import { parsePublicOrigin } from '../auth/config.js'
import { createAuthRuntime, getAuthRuntime, resetAuthRuntimeForTesting } from '../auth/runtime.js'
import { createSession, findSessionByRawToken } from '../auth/session.js'
import { defaultKdfGuard } from '../auth/kdfGuard.js'
import { SETUP_MAX_DELAY_MS } from '../auth/rateLimit.js'

const databases: Database.Database[] = []

function newDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  databases.push(db)
  return db
}

function seedOwner(db: Database.Database): void {
  const now = 1_700_000_000_000
  db.prepare(`
    INSERT INTO users (username, username_normalized, password_hash, created_at, updated_at)
    VALUES ('admin', 'admin', 'test-hash', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO auth_instance (id, owner_user_id, created_at, updated_at)
    VALUES (1, 1, ?, ?)
  `).run(now, now)
}

afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close()
})

describe('authentication runtime', () => {
  it('revokes active sessions on startup without changing the owner', () => {
    const db = newDb()
    seedOwner(db)
    const first = createSession(db, 1, { now: 1_700_000_000_000 })
    const second = createSession(db, 1, { now: 1_700_000_000_000 })
    const config = {
      ...parsePublicOrigin('http://127.0.0.1:3000'),
      revokeSessionsOnStart: true,
    }
    const runtime = createAuthRuntime({ db, config })
    expect(runtime.service.ownerExists()).toBe(true)
    expect(findSessionByRawToken(db, first.rawToken).status).toBe('revoked')
    expect(findSessionByRawToken(db, second.rawToken).status).toBe('revoked')
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM auth_instance').get()).toEqual({ count: 1 })
  })

  it('keeps the process-wide KDF guard shared and does not create runtime state at import time', () => {
    const db = newDb()
    const runtime = createAuthRuntime({
      db,
      config: parsePublicOrigin('http://127.0.0.1:3000'),
      env: { DOCUS_SETUP_TOKEN: 'explicit-secret-0123456789abcdef' },
    })
    expect(runtime.kdfGuard).toBe(defaultKdfGuard)
    expect(runtime.bootstrap.setupRequired).toBe(true)
  })

  it('fails fast on a weak explicit setup token when no owner exists', () => {
    const db = newDb()
    const weak = 'weak-setup-token'
    expect(() => createAuthRuntime({
      db,
      config: parsePublicOrigin('http://127.0.0.1:3000'),
      env: { DOCUS_SETUP_TOKEN: weak },
    })).toThrow('DOCUS_SETUP_TOKEN must contain at least 32 UTF-8 bytes.')
    let failure: unknown
    try {
      createAuthRuntime({
        db,
        config: parsePublicOrigin('http://127.0.0.1:3000'),
        env: { DOCUS_SETUP_TOKEN: weak },
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeDefined()
    expect(String(failure)).not.toContain(weak)
  })

  it('ignores weak setup-token configuration after an owner exists', () => {
    const db = newDb()
    seedOwner(db)
    const runtime = createAuthRuntime({
      db,
      config: parsePublicOrigin('http://127.0.0.1:3000'),
      env: { DOCUS_SETUP_TOKEN: 'x' },
    })
    expect(runtime.bootstrap.setupRequired).toBe(false)
  })

  it('caps setup limiter delay even when runtime options request a larger value', () => {
    const db = newDb()
    const runtime = createAuthRuntime({
      db,
      config: parsePublicOrigin('http://127.0.0.1:3000'),
      env: { DOCUS_SETUP_TOKEN: 'explicit-secret-0123456789abcdef' },
      rateLimiterOptions: { baseRetryMs: Number.MAX_SAFE_INTEGER, maxDelayMs: Number.MAX_SAFE_INTEGER },
    })
    expect(runtime.setupLimiter.maxDelayMs).toBe(SETUP_MAX_DELAY_MS)
    expect(runtime.setupLimiter.baseRetryMs).toBe(SETUP_MAX_DELAY_MS)
  })

  it('does not initialize auth runtime or touch the production DB when importing server/index.ts', async () => {
    resetAuthRuntimeForTesting()
    const dbPath = path.resolve(process.cwd(), 'data/docus.db')
    const before = statSync(dbPath)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.resetModules()
    try {
      const runtimeModule = await import('../auth/runtime.js')
      expect(runtimeModule.getAuthRuntime()).toBeNull()
      await import('../index.js')
      expect(runtimeModule.getAuthRuntime()).toBeNull()
      const after = statSync(dbPath)
      expect(after.mtimeMs).toBe(before.mtimeMs)
      expect(logSpy).not.toHaveBeenCalled()
      expect(getAuthRuntime()).toBeNull()
    } finally {
      logSpy.mockRestore()
    }
  })
})
