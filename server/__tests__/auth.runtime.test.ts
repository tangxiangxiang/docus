import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db.js'
import { parsePublicOrigin } from '../auth/config.js'
import { createAuthRuntime } from '../auth/runtime.js'
import { createSession, findSessionByRawToken } from '../auth/session.js'
import { defaultKdfGuard } from '../auth/kdfGuard.js'

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
      env: { DOCUS_SETUP_TOKEN: 'explicit-secret' },
    })
    expect(runtime.kdfGuard).toBe(defaultKdfGuard)
    expect(runtime.bootstrap.setupRequired).toBe(true)
  })
})
