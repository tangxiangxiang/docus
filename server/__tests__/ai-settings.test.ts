import { existsSync, mkdtempSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import { decryptApiKey, encryptApiKey } from '../ai/keyEncryption'
import {
  AiKeyConfigurationError,
  getAiSettingsView,
  readStoredAiSettings,
  saveAiSettings,
} from '../ai/settings'

const MASTER_KEY = '22'.repeat(32)
const LEGACY_KEY = Buffer.alloc(32, 0x33)
const originalMasterKey = process.env.DOCUS_MASTER_KEY
const originalMasterKeyFile = process.env.DOCUS_MASTER_KEY_FILE

function newDb(): Database.Database {
  const db = new Database(':memory:')
  applyMigrations(db)
  return db
}

function setting(db: Database.Database, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? ''
}

afterEach(() => {
  if (originalMasterKey === undefined) delete process.env.DOCUS_MASTER_KEY
  else process.env.DOCUS_MASTER_KEY = originalMasterKey
  if (originalMasterKeyFile === undefined) delete process.env.DOCUS_MASTER_KEY_FILE
  else process.env.DOCUS_MASTER_KEY_FILE = originalMasterKeyFile
})

describe('external AI master key storage', () => {
  it('does not create a database master key for an unconfigured vault', () => {
    delete process.env.DOCUS_MASTER_KEY
    delete process.env.DOCUS_MASTER_KEY_FILE
    const db = newDb()
    expect(getAiSettingsView(db).configured).toBe(false)
    expect(setting(db, 'ai.encryption.key')).toBe('')
    db.close()
  })

  it('encrypts API keys with DOCUS_MASTER_KEY and never stores that key in SQLite', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    delete process.env.DOCUS_MASTER_KEY_FILE
    const db = newDb()
    saveAiSettings(db, { apiKey: 'sk-ant-secret-value' })
    const blob = setting(db, 'ai.anthropic.apiKey')
    expect(blob).not.toContain('sk-ant-secret-value')
    expect(setting(db, 'ai.encryption.key')).toBe('')
    expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-ant-secret-value')
    db.close()
  })

  it('does not rewrite an API key when reading with the active master key', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    delete process.env.DOCUS_MASTER_KEY_FILE
    const db = newDb()
    saveAiSettings(db, { apiKey: 'sk-read-only-value' })
    const before = setting(db, 'ai.anthropic.apiKey')

    expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-read-only-value')
    expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-read-only-value')
    expect(getAiSettingsView(db).configured).toBe(true)

    expect(setting(db, 'ai.anthropic.apiKey')).toBe(before)
    db.close()
  })

  it('supports a secret file when the environment value is absent', () => {
    delete process.env.DOCUS_MASTER_KEY
    const dir = mkdtempSync(path.join(tmpdir(), 'docus-master-key-'))
    const file = path.join(dir, 'master.key')
    writeFileSync(file, MASTER_KEY, { mode: 0o600 })
    process.env.DOCUS_MASTER_KEY_FILE = file
    const db = newDb()
    saveAiSettings(db, { apiKey: 'sk-file-secret' })
    expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-file-secret')
    unlinkSync(file)
    rmdirSync(dir)
    db.close()
  })

  it('creates a separate local master key file when no environment key is configured', () => {
    delete process.env.DOCUS_MASTER_KEY
    delete process.env.DOCUS_MASTER_KEY_FILE
    const root = mkdtempSync(path.join(tmpdir(), 'docus-local-key-'))
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    const db = newDb()
    try {
      saveAiSettings(db, { apiKey: 'sk-local-secret' })
      expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-local-secret')
      expect(setting(db, 'ai.encryption.key')).toBe('')
      expect(existsSync(path.join(root, 'data', '.docus-master-key'))).toBe(true)
    } finally {
      db.close()
      cwd.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a wrong master key without altering the encrypted row', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    const db = newDb()
    saveAiSettings(db, { apiKey: 'sk-keep-this-value' })
    const before = setting(db, 'ai.anthropic.apiKey')
    process.env.DOCUS_MASTER_KEY = '44'.repeat(32)
    expect(() => readStoredAiSettings(db)).toThrowError(
      expect.objectContaining<Partial<AiKeyConfigurationError>>({ code: 'master-key-invalid' }),
    )
    expect(setting(db, 'ai.anthropic.apiKey')).toBe(before)
    db.close()
  })

  it('migrates the old in-database key transactionally', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    const db = newDb()
    const legacyBlob = encryptApiKey('sk-legacy-value', LEGACY_KEY)
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai.encryption.key', LEGACY_KEY.toString('base64'))
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai.anthropic.apiKey', legacyBlob)

    expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-legacy-value')
    const migrated = setting(db, 'ai.anthropic.apiKey')
    expect(setting(db, 'ai.encryption.key')).toBe('')
    expect(migrated).not.toBe(legacyBlob)
    expect(decryptApiKey(migrated, Buffer.from(MASTER_KEY, 'hex'))).toBe('sk-legacy-value')
    db.close()
  })

  it('leaves legacy data untouched if migration decryption fails', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    const db = newDb()
    const wrongBlob = encryptApiKey('sk-legacy-value', Buffer.alloc(32, 0x55))
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai.encryption.key', LEGACY_KEY.toString('base64'))
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai.anthropic.apiKey', wrongBlob)

    expect(() => readStoredAiSettings(db)).toThrowError(AiKeyConfigurationError)
    expect(setting(db, 'ai.encryption.key')).toBe(LEGACY_KEY.toString('base64'))
    expect(setting(db, 'ai.anthropic.apiKey')).toBe(wrongBlob)
    db.close()
  })
})
