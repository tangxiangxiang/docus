import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { applyMigrations } from '../db.js'
import { KdfGuard } from '../auth/kdfGuard.js'
import { SCRYPT_KEY_BYTES } from '../auth/password.js'
import { wrapDiaryDek } from './crypto.js'
import { DiaryAccessService } from './service.js'

const PASSWORD = 'diary-access-test-password'
const VAULT_ID = 'test-vault-01'

function makeService(
  db: Database.Database,
  now = 1_700_000_000_000,
  vaultId = VAULT_ID,
  resolveAuthSession: (sessionId: number) => { valid: boolean; expiresAt?: number } = () => ({
    valid: true,
    expiresAt: now + 60_000,
  }),
): DiaryAccessService {
  return new DiaryAccessService({
    db,
    kdfGuard: new KdfGuard({ concurrency: 1, maxQueue: 2, maxQueueWaitMs: 10_000 }),
    now: () => now,
    getVaultId: () => vaultId,
    resolveAuthSession,
  })
}

describe('D8.1 Diary access foundation', () => {
  it('starts uninitialized, stores only wrapped key material, and unlocks with an in-memory capability', async () => {
    const db = new Database(':memory:')
    applyMigrations(db)
    const service = makeService(db)

    expect(service.status(7)).toEqual({ state: 'UNINITIALIZED' })
    const setup = await service.setup(7, PASSWORD)
    expect(setup.state).toBe('UNLOCKED')
    expect(setup.capability).not.toContain(PASSWORD)
    expect(service.status(7, setup.capability).state).toBe('UNLOCKED')
    expect(service.isCapabilityValid(7, setup.capability)).toBe(true)
    expect(service.isCapabilityValid(8, setup.capability)).toBe(false)

    const row = db.prepare('SELECT * FROM diary_access_config WHERE id = 1').get() as Record<string, unknown>
    expect(row).toBeTruthy()
    expect(row.password).toBeUndefined()
    expect(row.kek).toBeUndefined()
    expect(row.dek).toBeUndefined()
    expect(row.wrapped_dek).toBeTruthy()

    service.lock(7)
    expect(service.status(7, setup.capability).state).toBe('LOCKED')
    db.close()
  })

  it('rejects a wrong password and loses unlocked state on a new process owner', async () => {
    const db = new Database(':memory:')
    applyMigrations(db)
    const first = makeService(db)
    await first.setup(7, PASSWORD)

    await expect(first.unlock(7, 'wrong-diary-password')).rejects.toMatchObject({
      code: 'diary-access-invalid-password',
      status: 401,
    })

    const restarted = makeService(db)
    expect(restarted.status(7).state).toBe('LOCKED')
    const unlocked = await restarted.unlock(7, PASSWORD)
    expect(restarted.status(7, unlocked.capability).state).toBe('UNLOCKED')
    db.close()
  })

  it('does not overwrite a concurrently initialized singleton', async () => {
    const db = new Database(':memory:')
    applyMigrations(db)
    const first = makeService(db)
    const second = makeService(db)
    const [a, b] = await Promise.allSettled([
      first.setup(7, PASSWORD),
      second.setup(8, `${PASSWORD}-other`),
    ])
    expect([a.status, b.status].filter((status) => status === 'fulfilled')).toHaveLength(1)
    expect([a.status, b.status].filter((status) => status === 'rejected')).toHaveLength(1)
    expect(db.prepare('SELECT COUNT(*) AS count FROM diary_access_config').get()).toEqual({ count: 1 })
    db.close()
  })

  it('fails closed for malformed KDF, format, and vault-binding configuration', async () => {
    const db = new Database(':memory:')
    applyMigrations(db)
    const service = makeService(db)
    await service.setup(7, PASSWORD)

    db.prepare('UPDATE diary_access_config SET kdf_n = ? WHERE id = 1').run(1)
    expect(() => service.status(7)).toThrowError(expect.objectContaining({
      code: 'diary-access-unavailable',
      status: 503,
    }))

    db.prepare('UPDATE diary_access_config SET kdf_n = ?, format_version = ? WHERE id = 1')
      .run(32_768, 99)
    expect(() => service.status(7)).toThrowError(expect.objectContaining({
      code: 'diary-access-unavailable',
      status: 503,
    }))

    db.prepare('UPDATE diary_access_config SET format_version = ?, vault_id = ? WHERE id = 1')
      .run(1, 'other-vault')
    expect(() => service.status(7)).toThrowError(expect.objectContaining({
      code: 'diary-access-unavailable',
      status: 503,
    }))
    db.close()
  })

  it('uses a fresh random wrapping nonce for each key-wrap operation', () => {
    const kek = randomBytes(SCRYPT_KEY_BYTES)
    const dek = randomBytes(SCRYPT_KEY_BYTES)
    const first = wrapDiaryDek(kek, dek, VAULT_ID)
    const second = wrapDiaryDek(kek, dek, VAULT_ID)
    expect(first.nonce).toHaveLength(12)
    expect(second.nonce).toHaveLength(12)
    expect(second.nonce.equals(first.nonce)).toBe(false)
    kek.fill(0)
    dek.fill(0)
  })

  it('fails closed when auth is invalidated during KDF and expires capabilities per session', async () => {
    const db = new Database(':memory:')
    applyMigrations(db)
    let now = 1_700_000_000_000
    const valid = new Map<number, boolean>([[7, true], [8, true]])
    const expiresAt = new Map<number, number>([[7, now + 10_000], [8, now + 20_000]])
    const service = makeService(db, now, VAULT_ID, (sessionId) => ({
      valid: valid.get(sessionId) === true,
      expiresAt: expiresAt.get(sessionId),
    }))
    const first = await service.setup(7, PASSWORD)
    const second = await service.unlock(8, PASSWORD)

    service.lock(7)
    const pending = service.unlock(7, PASSWORD)
    valid.set(7, false)
    await expect(pending).rejects.toMatchObject({
      code: 'diary-access-auth-session-invalid',
      status: 401,
    })
    expect(service.isCapabilityValid(7, first.capability)).toBe(false)
    expect(service.isCapabilityValid(8, second.capability)).toBe(true)

    now += 20_001
    // The service clock is captured by makeService, so create a second owner
    // over the same config to prove absolute auth-session expiry cleanup.
    const expiring = new DiaryAccessService({
      db,
      kdfGuard: new KdfGuard({ concurrency: 1, maxQueue: 2, maxQueueWaitMs: 10_000 }),
      now: () => now,
      getVaultId: () => VAULT_ID,
      resolveAuthSession: (sessionId) => ({
        valid: valid.get(sessionId) === true,
        expiresAt: expiresAt.get(sessionId),
      }),
    })
    await expect(expiring.unlock(8, PASSWORD)).rejects.toMatchObject({
      code: 'diary-access-auth-session-invalid',
    })
    db.close()
  })
})
