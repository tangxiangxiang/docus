// AI settings storage and retrieval.
//
// Resolution order: SQLite only. There is no env-var override path —
// configuration lives entirely in the `settings` table so a single
// DB backup captures everything.
//
// At-rest encryption:
//   - The Anthropic API key is encrypted with AES-256-GCM before
//     writing to `settings.key = 'ai.anthropic.apiKey'`.
//   - The 32-byte encryption key itself is stored at
//     `settings.key = 'ai.encryption.key'` (base64).
//     Putting the key in the same DB is a deliberate trade-off —
//     see keyEncryption.ts for the rationale.
//   - baseURL and model stay plaintext. They are not sensitive.
//
// Legacy migration:
//   - Before encryption, the API key was stored as plaintext. On the
//     first read after this change, any plaintext value is detected
//     via isEncryptedFormat() and re-encrypted in place. One-time,
//     automatic, transparent.
//
// Failure modes:
//   - Decryption error → treat as empty (user can re-enter). We do
//     NOT throw, because the only way to recover is for the user to
//     type a new key and save.
import type { Database as DatabaseT } from 'better-sqlite3'
import {
  decryptApiKey,
  encryptApiKey,
  generateApiKeyEncryptionKey,
  isEncryptedFormat,
} from './keyEncryption.js'

export type AiSettingsSource = 'db' | 'none'

export interface StoredAiSettings {
  apiKey: string
  baseURL: string
  model: string
}

export interface AiRuntimeConfig {
  apiKey?: string
  baseURL?: string
  model: string
  source: AiSettingsSource
}

export interface AiSettingsView {
  provider: 'anthropic'
  configured: boolean
  source: AiSettingsSource
  maskedKey: string
  baseURL: string
  model: string
}

const KEY_API_KEY = 'ai.anthropic.apiKey'
const KEY_BASE_URL = 'ai.anthropic.baseURL'
const KEY_MODEL = 'ai.anthropic.model'
const KEY_ENCRYPTION_KEY = 'ai.encryption.key'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
export const MAX_AI_API_KEY_LENGTH = 256
export const MAX_AI_BASE_URL_LENGTH = 2048
export const MAX_AI_MODEL_LENGTH = 100

function getSetting(db: DatabaseT, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? ''
}

function setSetting(db: DatabaseT, key: string, value: string): void {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function deleteSetting(db: DatabaseT, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

/* Get the encryption key from the DB, creating it on first use. The
   encryption key is generated once and persisted; rotating it would
   invalidate every previously-saved API key, so we don't expose a
   rotate path here. */
function getOrCreateEncryptionKey(db: DatabaseT): Buffer {
  const stored = getSetting(db, KEY_ENCRYPTION_KEY)
  if (stored) {
    return Buffer.from(stored, 'base64')
  }
  const key = generateApiKeyEncryptionKey()
  setSetting(db, KEY_ENCRYPTION_KEY, key.toString('base64'))
  return key
}

/* Read the stored API key, handling both encrypted and legacy
   plaintext formats. Legacy plaintext is migrated to encrypted on
   first read so the DB converges to encrypted-only after the first
   settings load. */
function readApiKey(db: DatabaseT, encryptionKey: Buffer): string {
  const blob = getSetting(db, KEY_API_KEY)
  if (!blob) return ''
  if (isEncryptedFormat(blob)) {
    try {
      return decryptApiKey(blob, encryptionKey)
    } catch {
      // Decryption failed (corrupt blob or rotated key). Treat as
      // empty — the only recovery is for the user to re-enter.
      return ''
    }
  }
  // Legacy plaintext: migrate to encrypted in place, then return.
  const plaintext = blob
  setSetting(db, KEY_API_KEY, encryptApiKey(plaintext, encryptionKey))
  return plaintext
}

export function readStoredAiSettings(db: DatabaseT): StoredAiSettings {
  const encryptionKey = getOrCreateEncryptionKey(db)
  return {
    apiKey: readApiKey(db, encryptionKey),
    baseURL: getSetting(db, KEY_BASE_URL),
    model: getSetting(db, KEY_MODEL) || DEFAULT_ANTHROPIC_MODEL,
  }
}

export function saveAiSettings(
  db: DatabaseT,
  input: { apiKey?: string; baseURL?: string; model?: string },
): StoredAiSettings {
  // Three-state write contract:
  //   undefined -> leave the existing DB value unchanged
  //   ''        -> delete that setting
  //   nonempty  -> trim and save the new value
  // This lets the Settings modal save model/baseURL without clearing
  // an existing API key whose password field is intentionally blank.
  const apiKey = input.apiKey?.trim()
  const baseURL = input.baseURL?.trim()
  const model = input.model?.trim()
  const encryptionKey = getOrCreateEncryptionKey(db)
  if (apiKey !== undefined) {
    if (apiKey) setSetting(db, KEY_API_KEY, encryptApiKey(apiKey, encryptionKey))
    else deleteSetting(db, KEY_API_KEY)
  }
  if (baseURL !== undefined) {
    if (baseURL) setSetting(db, KEY_BASE_URL, baseURL)
    else deleteSetting(db, KEY_BASE_URL)
  }
  if (model !== undefined) {
    if (model) setSetting(db, KEY_MODEL, model)
    else deleteSetting(db, KEY_MODEL)
  }
  return readStoredAiSettings(db)
}

export function clearAiApiKey(db: DatabaseT): StoredAiSettings {
  deleteSetting(db, KEY_API_KEY)
  return readStoredAiSettings(db)
}

/* Show 8 leading + 8 trailing chars so the user can verify the right
   key is loaded without exposing the full secret. Keys shorter than
   16 chars collapse to bullets — we don't have enough head + tail
   to safely reveal either end without effectively printing the key. */
export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 16) return '••••••••'
  return `${key.slice(0, 8)}...${key.slice(-8)}`
}

export function getAiRuntimeConfig(db?: DatabaseT): AiRuntimeConfig {
  const stored = db ? readStoredAiSettings(db) : null
  if (stored?.apiKey) {
    return {
      apiKey: stored.apiKey,
      baseURL: stored.baseURL || undefined,
      model: stored.model || DEFAULT_ANTHROPIC_MODEL,
      source: 'db',
    }
  }
  return {
    baseURL: stored?.baseURL || undefined,
    model: stored?.model || DEFAULT_ANTHROPIC_MODEL,
    source: 'none',
  }
}

export function getAiSettingsView(db: DatabaseT): AiSettingsView {
  const stored = readStoredAiSettings(db)
  return {
    provider: 'anthropic',
    configured: Boolean(stored.apiKey),
    source: stored.apiKey ? 'db' : 'none',
    maskedKey: maskKey(stored.apiKey),
    baseURL: stored.baseURL,
    model: stored.model,
  }
}