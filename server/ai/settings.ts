// AI settings storage and retrieval.
//
// Resolution order: SQLite only. There is no env-var override path —
// configuration lives entirely in the `settings` table so a single
// DB backup captures everything.
//
// Per-provider storage layout:
//
//   ai.active.provider          = 'anthropic' | 'openai'   (which is active)
//   ai.anthropic.apiKey         = encrypted blob | legacy plaintext
//   ai.anthropic.baseURL        = plaintext
//   ai.anthropic.model          = plaintext
//   ai.openai.apiKey            = encrypted blob | legacy plaintext
//   ai.openai.baseURL           = plaintext
//   ai.openai.model             = plaintext
//   ai.encryption.key           = base64 32-byte AES-256-GCM key (shared)
//
// Putting the encryption key in the same DB is a deliberate trade-off
// — see keyEncryption.ts for the rationale.
//
// At-rest encryption:
//   - Each provider's API key is encrypted with AES-256-GCM before
//     writing. The encryption key is generated once on first use and
//     persisted to ai.encryption.key.
//
// Legacy migration:
//   - Pre-multi-provider, the apiKey lived at ai.anthropic.apiKey
//     (plaintext). readStoredAiSettings() detects this via
//     isEncryptedFormat() and re-encrypts in place on first read.
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

export const SUPPORTED_PROVIDERS = ['anthropic', 'openai'] as const
export type Provider = typeof SUPPORTED_PROVIDERS[number]
export type AiSettingsSource = 'db' | 'none'

export interface StoredProviderConfig {
  apiKey: string
  baseURL: string
  model: string
}

export interface StoredAiSettings {
  provider: Provider
  anthropic: StoredProviderConfig
  openai: StoredProviderConfig
}

export interface AiRuntimeConfig {
  apiKey?: string
  baseURL?: string
  model: string
  provider: Provider
  source: AiSettingsSource
}

export interface AiSettingsView {
  provider: Provider
  configured: boolean
  source: AiSettingsSource
  maskedKey: string
  baseURL: string
  model: string
}

/* Default models per provider. baseURL is intentionally not defaulted
   here — the SDK applies its own sane default (Anthropic: api.anthropic.com,
   OpenAI: api.openai.com/v1) when no override is set. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
export const DEFAULT_OPENAI_MODEL = 'gpt-4o'
export const MAX_AI_API_KEY_LENGTH = 256
export const MAX_AI_BASE_URL_LENGTH = 2048
export const MAX_AI_MODEL_LENGTH = 100

const KEY_ACTIVE_PROVIDER = 'ai.active.provider'
const KEY_ENCRYPTION_KEY = 'ai.encryption.key'
function keyApiKey(provider: Provider): string { return `ai.${provider}.apiKey` }
function keyBaseURL(provider: Provider): string { return `ai.${provider}.baseURL` }
function keyModel(provider: Provider): string { return `ai.${provider}.model` }

function defaultModelFor(provider: Provider): string {
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL
}

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

/* Read a single provider's API key, handling both encrypted and legacy
   plaintext formats. Legacy plaintext is migrated to encrypted on
   first read so the DB converges to encrypted-only after the first
   settings load. */
function readProviderApiKey(db: DatabaseT, provider: Provider, encryptionKey: Buffer): string {
  const blob = getSetting(db, keyApiKey(provider))
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
  setSetting(db, keyApiKey(provider), encryptApiKey(plaintext, encryptionKey))
  return plaintext
}

function readProviderConfig(db: DatabaseT, provider: Provider, encryptionKey: Buffer): StoredProviderConfig {
  return {
    apiKey: readProviderApiKey(db, provider, encryptionKey),
    baseURL: getSetting(db, keyBaseURL(provider)),
    model: getSetting(db, keyModel(provider)) || defaultModelFor(provider),
  }
}

function readActiveProvider(db: DatabaseT): Provider {
  const stored = getSetting(db, KEY_ACTIVE_PROVIDER)
  if (stored === 'openai') return 'openai'
  // Legacy default + unknown values fall through to Anthropic. This
  // means existing single-provider DBs automatically come up on
  // Anthropic without any migration step.
  return 'anthropic'
}

export function readStoredAiSettings(db: DatabaseT): StoredAiSettings {
  const encryptionKey = getOrCreateEncryptionKey(db)
  return {
    provider: readActiveProvider(db),
    anthropic: readProviderConfig(db, 'anthropic', encryptionKey),
    openai: readProviderConfig(db, 'openai', encryptionKey),
  }
}

export interface SaveAiSettingsInput {
  /* Optional provider switch. If set and different from current,
     the active provider is updated and subsequent apiKey/baseURL/
     model writes land on that provider's slot. If omitted, the
     current active provider is preserved. */
  provider?: Provider
  apiKey?: string
  baseURL?: string
  model?: string
}

export function saveAiSettings(
  db: DatabaseT,
  input: SaveAiSettingsInput,
): StoredAiSettings {
  // Resolve the target provider: switch if the caller asked, otherwise
  // keep what's already active. Reads happen before writes so a
  // single PUT can both switch provider and update its config.
  const target: Provider = input.provider ?? readActiveProvider(db)
  if (input.provider !== undefined) {
    setSetting(db, KEY_ACTIVE_PROVIDER, input.provider)
  }
  // Three-state write contract (per field):
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
    if (apiKey) setSetting(db, keyApiKey(target), encryptApiKey(apiKey, encryptionKey))
    else deleteSetting(db, keyApiKey(target))
  }
  if (baseURL !== undefined) {
    if (baseURL) setSetting(db, keyBaseURL(target), baseURL)
    else deleteSetting(db, keyBaseURL(target))
  }
  if (model !== undefined) {
    if (model) setSetting(db, keyModel(target), model)
    else deleteSetting(db, keyModel(target))
  }
  return readStoredAiSettings(db)
}

export function clearAiApiKey(db: DatabaseT, provider?: Provider): StoredAiSettings {
  const target = provider ?? readActiveProvider(db)
  deleteSetting(db, keyApiKey(target))
  return readStoredAiSettings(db)
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 16) return '••••••••'
  return `${key.slice(0, 8)}...${key.slice(-8)}`
}

/* Resolve the active provider's runtime config. Used by llm.ts and
   the other AI helpers — they don't care about inactive providers. */
export function getAiRuntimeConfig(db?: DatabaseT): AiRuntimeConfig {
  const stored = db ? readStoredAiSettings(db) : null
  const provider = stored?.provider ?? 'anthropic'
  const active = stored?.[provider]
  if (active?.apiKey) {
    return {
      apiKey: active.apiKey,
      baseURL: active.baseURL || undefined,
      model: active.model || defaultModelFor(provider),
      provider,
      source: 'db',
    }
  }
  return {
    baseURL: active?.baseURL || undefined,
    model: active?.model || defaultModelFor(provider),
    provider,
    source: 'none',
  }
}

/* View returned to the UI exposes only the active provider's config.
   The inactive provider's state stays server-side; the UI can switch
   providers via a subsequent PUT that carries { provider: 'openai' }. */
export function getAiSettingsView(db: DatabaseT): AiSettingsView {
  const stored = readStoredAiSettings(db)
  const active = stored[stored.provider]
  return {
    provider: stored.provider,
    configured: Boolean(active.apiKey),
    source: active.apiKey ? 'db' : 'none',
    maskedKey: maskKey(active.apiKey),
    baseURL: active.baseURL,
    model: active.model,
  }
}