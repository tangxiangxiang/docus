import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db.js'
import { BootstrapState } from '../auth/bootstrap.js'

function dbWithOwner(): Database.Database {
  const db = new Database(':memory:')
  applyMigrations(db)
  const now = Date.now()
  db.prepare(`
    INSERT INTO users (username, username_normalized, password_hash, created_at, updated_at)
    VALUES ('admin', 'admin', 'hash', ?, ?)
  `).run(now, now)
  db.prepare(`
    INSERT INTO auth_instance (id, owner_user_id, created_at, updated_at)
    VALUES (1, 1, ?, ?)
  `).run(now, now)
  return db
}

describe('authentication bootstrap state', () => {
  it('generates and logs a fallback token exactly once, then closes after commit', () => {
    const db = new Database(':memory:')
    applyMigrations(db)
    const logs: string[] = []
    const state = BootstrapState.create({ db, logger: (message) => logs.push(message) })
    expect(state.setupRequired).toBe(true)
    expect(logs).toHaveLength(1)
    const token = logs[0]!.split(': ').at(-1)!
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(state.verify(token)).toBe(true)
    expect(state.verify(`${token}wrong`)).toBe(false)
    state.markOwnerCommitted()
    expect(state.setupRequired).toBe(false)
    expect(state.verify(token)).toBe(false)
    expect(logs).toHaveLength(1)
    db.close()
  })

  it('does not log explicit tokens or create a fallback after owner creation', () => {
    const explicitDb = new Database(':memory:')
    applyMigrations(explicitDb)
    const explicitLogs: string[] = []
    const explicit = BootstrapState.create({
      db: explicitDb,
      explicitToken: 'operator-secret',
      logger: (message) => explicitLogs.push(message),
    })
    expect(explicitLogs).toEqual([])
    expect(explicit.verify('operator-secret')).toBe(true)
    explicitDb.close()

    const ownerDb = dbWithOwner()
    const ownerLogs: string[] = []
    const owner = BootstrapState.create({ db: ownerDb, logger: (message) => ownerLogs.push(message) })
    expect(owner.setupRequired).toBe(false)
    expect(ownerLogs).toEqual([])
    ownerDb.close()
  })
})
