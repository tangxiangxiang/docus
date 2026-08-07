// AI provider settings stored in SQLite.
//
// API keys are encrypted with AES-256-GCM. SQLite only stores the ciphertext,
// IV and auth tag. An explicitly supplied DOCUS_MASTER_KEY or
// DOCUS_MASTER_KEY_FILE takes precedence; otherwise Docus creates a separate
// local secret file next to the database. The master key is never stored in
// SQLite. Existing databases that contain ai.encryption.key are migrated
// transactionally on first access.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import {
  decryptApiKey,
  encryptApiKey,
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

export type AiKeyConfigurationCode =
  | 'master-key-required'
  | 'master-key-invalid'
  | 'master-key-file-unreadable'
  | 'master-key-file-unwritable'
  | 'stored-key-invalid'

/** Safe-to-display configuration errors. Never include key material here. */
export class AiKeyConfigurationError extends Error {
  readonly code: AiKeyConfigurationCode

  constructor(code: AiKeyConfigurationCode, message: string) {
    super(message)
    this.name = 'AiKeyConfigurationError'
    this.code = code
  }
}

/* Default models per provider. baseURL is intentionally not defaulted
   here — the SDK applies its own sane default when no override is set. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'
export const DEFAULT_OPENAI_MODEL = 'gpt-4o'
export const MAX_AI_API_KEY_LENGTH = 256
export const MAX_AI_BASE_URL_LENGTH = 2048
export const MAX_AI_MODEL_LENGTH = 100

const KEY_ACTIVE_PROVIDER = 'ai.active.provider'
const KEY_ENCRYPTION_KEY = 'ai.encryption.key'
const KEY_MASTER_ENV = 'DOCUS_MASTER_KEY'
const KEY_MASTER_FILE_ENV = 'DOCUS_MASTER_KEY_FILE'
function defaultMasterKeyFile(): string {
  return path.resolve(process.cwd(), 'data', '.docus-master-key')
}

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

function decodeKeyMaterial(raw: string, source: string, kind: 'master' | 'stored'): Buffer {
  const value = raw.trim()
  const invalid = () => new AiKeyConfigurationError(
    kind === 'master' ? 'master-key-invalid' : 'stored-key-invalid',
    `${source} must encode exactly 32 bytes as 64 hex characters or base64`,
  )
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw invalid()
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== value) throw invalid()
  return decoded
}

function readMasterKeyFile(filePath: string, code: 'master-key-file-unreadable' | 'master-key-file-unwritable'): Buffer {
  let fileValue: string
  try {
    fileValue = readFileSync(filePath, 'utf8')
  } catch {
    throw new AiKeyConfigurationError(code, 'The Docus master key file could not be read')
  }
  return decodeKeyMaterial(fileValue, filePath, 'master')
}

function createDefaultMasterKey(filePath: string): Buffer {
  const generated = randomBytes(32)
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, `${generated.toString('base64')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    return generated
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return readMasterKeyFile(filePath, 'master-key-file-unreadable')
    }
    throw new AiKeyConfigurationError(
      'master-key-file-unwritable',
      'The Docus master key file could not be created; check the data directory permissions',
    )
  }
}

/**
 * Read the external master key. Environment value takes precedence. When no
 * value is supplied, use a separate local file so a first Settings save does
 * not require a .env file. The file is deliberately outside SQLite.
 */
export function resolveMasterKey(
  env: NodeJS.ProcessEnv = process.env,
  fallbackFile = defaultMasterKeyFile(),
): Buffer {
  const configured = env[KEY_MASTER_ENV]?.trim()
  if (configured) return decodeKeyMaterial(configured, KEY_MASTER_ENV, 'master')

  const filePath = env[KEY_MASTER_FILE_ENV]?.trim()
  if (filePath) return readMasterKeyFile(filePath, 'master-key-file-unreadable')

  try {
    return readMasterKeyFile(fallbackFile, 'master-key-file-unreadable')
  } catch (error) {
    if (error instanceof AiKeyConfigurationError && !readFileExists(fallbackFile)) {
      return createDefaultMasterKey(fallbackFile)
    }
    throw error
  }
}

function readFileExists(filePath: string): boolean {
  try {
    readFileSync(filePath)
    return true
  } catch {
    return false
  }
}

function requireMasterKey(masterKey: Buffer | undefined): Buffer {
  if (!masterKey) {
    throw new AiKeyConfigurationError(
      'master-key-required',
      'The Docus master key is unavailable; check the data directory or configure DOCUS_MASTER_KEY_FILE',
    )
  }
  return masterKey
}

function decodeStoredEncryptionKey(value: string): Buffer {
  try {
    return decodeKeyMaterial(value, KEY_ENCRYPTION_KEY, 'stored')
  } catch {
    throw new AiKeyConfigurationError(
      'stored-key-invalid',
      'The legacy database encryption key is invalid; no AI credentials were changed',
    )
  }
}

function storedApiKeyRows(db: DatabaseT): Map<Provider, string> {
  return new Map(SUPPORTED_PROVIDERS.map((provider) => [provider, getSetting(db, keyApiKey(provider))]))
}

/**
 * Resolve and, if needed, migrate every provider key before any settings are
 * exposed. All plaintext/decryption work happens before the write transaction;
 * a failed migration therefore leaves the old rows untouched.
 */
function loadAndMigrateApiKeys(db: DatabaseT): Map<Provider, string> {
  const rows = storedApiKeyRows(db)
  const legacyKeyValue = getSetting(db, KEY_ENCRYPTION_KEY)
  const hasStoredMaterial = Boolean(legacyKeyValue) || [...rows.values()].some(Boolean)
  if (!hasStoredMaterial) return new Map(SUPPORTED_PROVIDERS.map((provider) => [provider, '']))

  const masterKey = resolveMasterKey()
  const legacyKey = legacyKeyValue ? decodeStoredEncryptionKey(legacyKeyValue) : undefined
  const plaintext = new Map<Provider, string>()
  const providersToMigrate = new Set<Provider>()

  for (const provider of SUPPORTED_PROVIDERS) {
    const blob = rows.get(provider) ?? ''
    if (!blob) {
      plaintext.set(provider, '')
      continue
    }
    if (!isEncryptedFormat(blob)) {
      plaintext.set(provider, blob)
      if (blob) providersToMigrate.add(provider)
      continue
    }

    let decrypted: string | undefined
    let decryptedWithLegacyKey = false
    const candidates: Array<{ key: Buffer; legacy: boolean }> = legacyKey
      ? [{ key: legacyKey, legacy: true }, { key: masterKey, legacy: false }]
      : [{ key: masterKey, legacy: false }]
    for (const candidate of candidates) {
      try {
        decrypted = decryptApiKey(blob, candidate.key)
        decryptedWithLegacyKey = candidate.legacy
        break
      } catch {
        // Try the next known key. No error details contain key material.
      }
    }
    if (decrypted === undefined) {
      throw new AiKeyConfigurationError(
        'master-key-invalid',
        'DOCUS_MASTER_KEY does not match the encrypted AI API key',
      )
    }
    plaintext.set(provider, decrypted)
    if (decryptedWithLegacyKey) providersToMigrate.add(provider)
  }

  // A normal read of a ciphertext encrypted with the active master key is
  // deliberately read-only. Only legacy plaintext, legacy-key ciphertext,
  // or the legacy key row itself requires a write transaction.
  if (providersToMigrate.size === 0 && !legacyKeyValue) return plaintext

  const migrate = db.transaction(() => {
    for (const provider of providersToMigrate) {
      const value = plaintext.get(provider) ?? ''
      if (value) setSetting(db, keyApiKey(provider), encryptApiKey(value, masterKey))
      else deleteSetting(db, keyApiKey(provider))
    }
    if (legacyKeyValue) deleteSetting(db, KEY_ENCRYPTION_KEY)
  })
  migrate()
  return plaintext
}

function readActiveProvider(db: DatabaseT): Provider {
  return getSetting(db, KEY_ACTIVE_PROVIDER) === 'openai' ? 'openai' : 'anthropic'
}

function readProviderConfig(
  db: DatabaseT,
  provider: Provider,
  apiKeys: Map<Provider, string>,
): StoredProviderConfig {
  return {
    apiKey: apiKeys.get(provider) ?? '',
    baseURL: getSetting(db, keyBaseURL(provider)),
    model: getSetting(db, keyModel(provider)) || defaultModelFor(provider),
  }
}

export function readStoredAiSettings(db: DatabaseT): StoredAiSettings {
  const apiKeys = loadAndMigrateApiKeys(db)
  return {
    provider: readActiveProvider(db),
    anthropic: readProviderConfig(db, 'anthropic', apiKeys),
    openai: readProviderConfig(db, 'openai', apiKeys),
  }
}

export interface SaveAiSettingsInput {
  provider?: Provider
  apiKey?: string
  baseURL?: string
  model?: string
}

export function saveAiSettings(db: DatabaseT, input: SaveAiSettingsInput): StoredAiSettings {
  // Read/migrate before changing the active provider, so a bad master key
  // cannot leave a partially applied settings update behind.
  const current = readStoredAiSettings(db)
  const target = input.provider ?? current.provider
  const apiKey = input.apiKey?.trim()
  const baseURL = input.baseURL?.trim()
  const model = input.model?.trim()
  const masterKey = apiKey ? resolveMasterKey() : undefined

  const save = db.transaction(() => {
    if (input.provider !== undefined) setSetting(db, KEY_ACTIVE_PROVIDER, input.provider)
    if (apiKey !== undefined) {
      if (apiKey) setSetting(db, keyApiKey(target), encryptApiKey(apiKey, requireMasterKey(masterKey)))
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
  })
  save()
  return readStoredAiSettings(db)
}

export function clearAiApiKey(db: DatabaseT, provider?: Provider): StoredAiSettings {
  const current = readStoredAiSettings(db)
  const target = provider ?? current.provider
  const clear = db.transaction(() => deleteSetting(db, keyApiKey(target)))
  clear()
  return readStoredAiSettings(db)
}

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 16) return '••••••••'
  return `${key.slice(0, 8)}...${key.slice(-8)}`
}

export function getAiRuntimeConfig(db: DatabaseT): AiRuntimeConfig {
  const stored = readStoredAiSettings(db)
  const provider = stored.provider
  const active = stored[provider]
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
