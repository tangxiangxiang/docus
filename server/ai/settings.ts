import type { Database as DatabaseT } from 'better-sqlite3'

export type AiSettingsSource = 'env' | 'db' | 'none'

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
  envOverride: boolean
}

const KEY_API_KEY = 'ai.anthropic.apiKey'
const KEY_BASE_URL = 'ai.anthropic.baseURL'
const KEY_MODEL = 'ai.anthropic.model'
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

export function readStoredAiSettings(db: DatabaseT): StoredAiSettings {
  return {
    apiKey: getSetting(db, KEY_API_KEY),
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
  if (apiKey !== undefined) {
    if (apiKey) setSetting(db, KEY_API_KEY, apiKey)
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

export function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

export function getAiRuntimeConfig(db?: DatabaseT): AiRuntimeConfig {
  const envKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY
  const envBaseURL = process.env.ANTHROPIC_BASE_URL
  const envModel = process.env.ANTHROPIC_MODEL
  if (envKey) {
    return {
      apiKey: envKey,
      baseURL: envBaseURL,
      model: envModel || DEFAULT_ANTHROPIC_MODEL,
      source: 'env',
    }
  }

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
    baseURL: stored?.baseURL || envBaseURL || undefined,
    model: stored?.model || envModel || DEFAULT_ANTHROPIC_MODEL,
    source: 'none',
  }
}

export function getAiSettingsView(db: DatabaseT): AiSettingsView {
  const stored = readStoredAiSettings(db)
  const runtime = getAiRuntimeConfig(db)
  const envOverride = runtime.source === 'env'
  const displayKey = envOverride ? runtime.apiKey ?? '' : stored.apiKey
  return {
    provider: 'anthropic',
    configured: Boolean(runtime.apiKey),
    source: runtime.source,
    maskedKey: maskKey(displayKey),
    baseURL: envOverride ? (runtime.baseURL ?? '') : stored.baseURL,
    model: envOverride ? runtime.model : stored.model,
    envOverride,
  }
}
