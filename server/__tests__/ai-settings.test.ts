import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import { decryptApiKey, encryptApiKey, isEncryptedFormat } from '../ai/keyEncryption'
import {
  AiKeyConfigurationError,
  getAiRuntimeConfig,
  getAiSettingsView,
  readStoredAiSettings,
  saveAiSettings,
  type AiKeyConfigurationCode,
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

function aiSettingsSnapshot(db: Database.Database): Array<{ key: string; value: string }> {
  return db.prepare(`
    SELECT key, value FROM settings
    WHERE key LIKE 'ai.%'
    ORDER BY key
  `).all() as Array<{ key: string; value: string }>
}

function withIsolatedCwd(run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), 'docus-ai-settings-'))
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  try {
    run(root)
  } finally {
    cwd.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
}

function expectAiKeyError(
  run: () => unknown,
  code: AiKeyConfigurationCode,
): AiKeyConfigurationError {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(AiKeyConfigurationError)
  expect(caught).toMatchObject({ code })
  return caught as AiKeyConfigurationError
}

interface MissingFallbackFixture {
  db: Database.Database
  fallbackFile: string
  ciphertext: string
  snapshot: Array<{ key: string; value: string }>
}

function withMissingFallbackCredential(run: (fixture: MissingFallbackFixture) => void): void {
  withIsolatedCwd((root) => {
    const db = newDb()
    const fallbackFile = path.join(root, 'data', '.docus-master-key')
    try {
      saveAiSettings(db, {
        provider: 'anthropic',
        apiKey: 'sk-ant-recovery-secret',
        baseURL: 'https://anthropic.example.invalid',
        model: 'claude-recovery',
      })
      saveAiSettings(db, {
        provider: 'openai',
        apiKey: 'sk-openai-recovery-secret',
        baseURL: 'https://openai.example.invalid/v1',
        model: 'gpt-recovery',
      })
      expect(existsSync(fallbackFile)).toBe(true)

      const ciphertext = setting(db, 'ai.anthropic.apiKey')
      const snapshot = aiSettingsSnapshot(db)
      unlinkSync(fallbackFile)
      run({ db, fallbackFile, ciphertext, snapshot })
    } finally {
      db.close()
    }
  })
}

beforeEach(() => {
  delete process.env.DOCUS_MASTER_KEY
  delete process.env.DOCUS_MASTER_KEY_FILE
})

afterEach(() => {
  if (originalMasterKey === undefined) delete process.env.DOCUS_MASTER_KEY
  else process.env.DOCUS_MASTER_KEY = originalMasterKey
  if (originalMasterKeyFile === undefined) delete process.env.DOCUS_MASTER_KEY_FILE
  else process.env.DOCUS_MASTER_KEY_FILE = originalMasterKeyFile
})

describe('external AI master key storage', () => {
  it('does not create a fallback master key for an unconfigured vault', () => {
    withIsolatedCwd((root) => {
      const db = newDb()
      try {
        expect(getAiSettingsView(db).configured).toBe(false)
        expect(setting(db, 'ai.encryption.key')).toBe('')
        expect(existsSync(path.join(root, 'data', '.docus-master-key'))).toBe(false)
      } finally {
        db.close()
      }
    })
  })

  it('encrypts API keys with DOCUS_MASTER_KEY and never stores that key in SQLite', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    const db = newDb()
    try {
      saveAiSettings(db, { apiKey: 'sk-ant-secret-value' })
      const blob = setting(db, 'ai.anthropic.apiKey')
      expect(blob).not.toContain('sk-ant-secret-value')
      expect(setting(db, 'ai.encryption.key')).toBe('')
      expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-ant-secret-value')
    } finally {
      db.close()
    }
  })

  it('does not rewrite an API key when reading with the active master key', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    const db = newDb()
    try {
      saveAiSettings(db, { apiKey: 'sk-read-only-value' })
      const before = setting(db, 'ai.anthropic.apiKey')

      expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-read-only-value')
      expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-read-only-value')
      expect(getAiSettingsView(db).configured).toBe(true)

      expect(setting(db, 'ai.anthropic.apiKey')).toBe(before)
    } finally {
      db.close()
    }
  })

  it('supports a secret file when the environment value is absent', () => {
    withIsolatedCwd((root) => {
      const file = path.join(root, 'master.key')
      writeFileSync(file, MASTER_KEY, { mode: 0o600 })
      process.env.DOCUS_MASTER_KEY_FILE = file
      const db = newDb()
      try {
        saveAiSettings(db, { apiKey: 'sk-file-secret' })
        expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-file-secret')
        expect(existsSync(path.join(root, 'data', '.docus-master-key'))).toBe(false)
      } finally {
        db.close()
      }
    })
  })

  it('creates a separate local master key file on the first API-key save', () => {
    withIsolatedCwd((root) => {
      const db = newDb()
      try {
        saveAiSettings(db, { apiKey: 'sk-local-secret' })
        const ciphertext = setting(db, 'ai.anthropic.apiKey')
        expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-local-secret')
        expect(setting(db, 'ai.anthropic.apiKey')).toBe(ciphertext)
        expect(setting(db, 'ai.encryption.key')).toBe('')
        expect(existsSync(path.join(root, 'data', '.docus-master-key'))).toBe(true)
      } finally {
        db.close()
      }
    })
  })

  it('reports master-key-required without recreating a missing fallback key or mutating AI settings', () => {
    withMissingFallbackCredential(({ db, fallbackFile, ciphertext, snapshot }) => {
      const error = expectAiKeyError(() => readStoredAiSettings(db), 'master-key-required')

      expect(error.message).toContain('Restore data/.docus-master-key from backup')
      expect(error.message).toContain('DOCUS_MASTER_KEY / DOCUS_MASTER_KEY_FILE')
      expect(error.message).not.toContain('sk-ant-recovery-secret')
      expect(error.message).not.toContain(ciphertext)
      expect(existsSync(fallbackFile)).toBe(false)
      expect(setting(db, 'ai.anthropic.apiKey')).toBe(ciphertext)
      expect(aiSettingsSnapshot(db)).toEqual(snapshot)
    })
  })

  it('fails the settings view safely when encrypted credentials have lost their fallback key', () => {
    withMissingFallbackCredential(({ db, fallbackFile, snapshot }) => {
      expectAiKeyError(() => getAiSettingsView(db), 'master-key-required')

      expect(existsSync(fallbackFile)).toBe(false)
      expect(aiSettingsSnapshot(db)).toEqual(snapshot)
    })
  })

  it('fails runtime config safely when encrypted credentials have lost their fallback key', () => {
    withMissingFallbackCredential(({ db, fallbackFile, snapshot }) => {
      expectAiKeyError(() => getAiRuntimeConfig(db), 'master-key-required')

      expect(existsSync(fallbackFile)).toBe(false)
      expect(aiSettingsSnapshot(db)).toEqual(snapshot)
    })
  })

  it('rejects a wrong explicit master key without altering the encrypted row', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    const db = newDb()
    try {
      saveAiSettings(db, {
        apiKey: 'sk-keep-this-value',
        baseURL: 'https://keep.example.invalid',
        model: 'keep-model',
      })
      const before = aiSettingsSnapshot(db)
      const ciphertext = setting(db, 'ai.anthropic.apiKey')
      process.env.DOCUS_MASTER_KEY = '44'.repeat(32)

      expectAiKeyError(() => readStoredAiSettings(db), 'master-key-invalid')
      expect(setting(db, 'ai.anthropic.apiKey')).toBe(ciphertext)
      expect(aiSettingsSnapshot(db)).toEqual(before)
    } finally {
      db.close()
    }
  })

  it('does not fall back when DOCUS_MASTER_KEY_FILE names a missing file', () => {
    withIsolatedCwd((root) => {
      process.env.DOCUS_MASTER_KEY = MASTER_KEY
      const db = newDb()
      try {
        saveAiSettings(db, { apiKey: 'sk-explicit-file-secret' })
        const before = aiSettingsSnapshot(db)
        const ciphertext = setting(db, 'ai.anthropic.apiKey')

        delete process.env.DOCUS_MASTER_KEY
        process.env.DOCUS_MASTER_KEY_FILE = path.join(root, 'missing-master.key')
        expectAiKeyError(() => readStoredAiSettings(db), 'master-key-file-unreadable')

        expect(existsSync(path.join(root, 'data', '.docus-master-key'))).toBe(false)
        expect(setting(db, 'ai.anthropic.apiKey')).toBe(ciphertext)
        expect(aiSettingsSnapshot(db)).toEqual(before)
      } finally {
        db.close()
      }
    })
  })

  it('does not replace a corrupted fallback key or mutate encrypted settings', () => {
    withIsolatedCwd((root) => {
      const db = newDb()
      const fallbackFile = path.join(root, 'data', '.docus-master-key')
      try {
        saveAiSettings(db, { apiKey: 'sk-corrupt-file-secret' })
        const before = aiSettingsSnapshot(db)
        const ciphertext = setting(db, 'ai.anthropic.apiKey')
        const corruptContents = 'not-valid-master-key\n'
        writeFileSync(fallbackFile, corruptContents, 'utf8')

        expectAiKeyError(() => readStoredAiSettings(db), 'master-key-invalid')
        expect(readFileSync(fallbackFile, 'utf8')).toBe(corruptContents)
        expect(setting(db, 'ai.anthropic.apiKey')).toBe(ciphertext)
        expect(aiSettingsSnapshot(db)).toEqual(before)
      } finally {
        db.close()
      }
    })
  })

  it('creates a fallback key to migrate a legacy plaintext API key', () => {
    withIsolatedCwd((root) => {
      const db = newDb()
      const fallbackFile = path.join(root, 'data', '.docus-master-key')
      try {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
          .run('ai.anthropic.apiKey', 'sk-legacy-plaintext')

        expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-legacy-plaintext')
        const migrated = setting(db, 'ai.anthropic.apiKey')
        expect(isEncryptedFormat(migrated)).toBe(true)
        expect(existsSync(fallbackFile)).toBe(true)
        expect(setting(db, 'ai.encryption.key')).toBe('')

        const masterKey = Buffer.from(readFileSync(fallbackFile, 'utf8').trim(), 'base64')
        expect(decryptApiKey(migrated, masterKey)).toBe('sk-legacy-plaintext')
      } finally {
        db.close()
      }
    })
  })

  it('migrates the old in-database key transactionally', () => {
    withIsolatedCwd((root) => {
      const db = newDb()
      const fallbackFile = path.join(root, 'data', '.docus-master-key')
      try {
        const legacyBlob = encryptApiKey('sk-legacy-value', LEGACY_KEY)
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
          .run('ai.encryption.key', LEGACY_KEY.toString('base64'))
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
          .run('ai.anthropic.apiKey', legacyBlob)

        expect(readStoredAiSettings(db).anthropic.apiKey).toBe('sk-legacy-value')
        const migrated = setting(db, 'ai.anthropic.apiKey')
        expect(setting(db, 'ai.encryption.key')).toBe('')
        expect(migrated).not.toBe(legacyBlob)
        expect(existsSync(fallbackFile)).toBe(true)

        const masterKey = Buffer.from(readFileSync(fallbackFile, 'utf8').trim(), 'base64')
        expect(decryptApiKey(migrated, masterKey)).toBe('sk-legacy-value')
      } finally {
        db.close()
      }
    })
  })

  it('leaves legacy data untouched if migration decryption fails', () => {
    process.env.DOCUS_MASTER_KEY = MASTER_KEY
    const db = newDb()
    try {
      const wrongBlob = encryptApiKey('sk-legacy-value', Buffer.alloc(32, 0x55))
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('ai.encryption.key', LEGACY_KEY.toString('base64'))
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
        .run('ai.anthropic.apiKey', wrongBlob)

      expect(() => readStoredAiSettings(db)).toThrowError(AiKeyConfigurationError)
      expect(setting(db, 'ai.encryption.key')).toBe(LEGACY_KEY.toString('base64'))
      expect(setting(db, 'ai.anthropic.apiKey')).toBe(wrongBlob)
    } finally {
      db.close()
    }
  })
})
