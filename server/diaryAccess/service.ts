import { randomBytes } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import { getVaultId } from '../vaultIdentity.js'
import { isValidPassword } from '../auth/password.js'
import type { KdfGuard } from '../auth/kdfGuard.js'
import {
  SCRYPT_KEY_BYTES,
  SCRYPT_MAXMEM,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  SCRYPT_SALT_BYTES,
} from '../auth/password.js'
import {
  DIARY_ACCESS_FORMAT_VERSION,
  DIARY_ACCESS_KDF_ALGORITHM,
  DIARY_ACCESS_KDF_VERSION,
  DIARY_ACCESS_NONCE_BYTES,
  DIARY_ACCESS_TAG_BYTES,
  DIARY_ACCESS_WRAP_ALGORITHM,
  DIARY_ACCESS_WRAP_VERSION,
  DiaryAccessCryptoError,
  deriveDiaryKek,
  unwrapDiaryDek,
  wrapDiaryDek,
} from './crypto.js'

export const DIARY_ACCESS_CAPABILITY_HEADER = 'X-Docus-Diary-Capability'

export type DiaryAccessState = 'UNINITIALIZED' | 'LOCKED' | 'UNLOCKED'

export type DiaryAccessErrorCode =
  | 'diary-access-invalid-password'
  | 'diary-access-invalid-state'
  | 'diary-access-unavailable'
  | 'diary-access-invalid-input'

export class DiaryAccessServiceError extends Error {
  readonly code: DiaryAccessErrorCode
  readonly status: 400 | 401 | 409 | 503

  constructor(
    code: DiaryAccessErrorCode,
    status: 400 | 401 | 409 | 503,
    message: string,
  ) {
    super(message)
    this.name = 'DiaryAccessServiceError'
    this.code = code
    this.status = status
  }
}

type DiaryAccessRow = {
  id: number
  format_version: number
  kdf_algorithm: string
  kdf_version: number
  kdf_n: number
  kdf_r: number
  kdf_p: number
  kdf_maxmem: number
  salt: Buffer | Uint8Array
  wrap_algorithm: string
  wrap_version: number
  wrap_nonce: Buffer | Uint8Array
  wrapped_dek: Buffer | Uint8Array
  wrap_tag: Buffer | Uint8Array
  vault_id: string
  created_at: number
  updated_at: number
}

type DiaryAccessConfig = {
  readonly salt: Buffer
  readonly nonce: Buffer
  readonly wrappedDek: Buffer
  readonly tag: Buffer
  readonly vaultId: string
}

type Capability = {
  readonly sessionId: number
  readonly vaultId: string
  readonly epoch: number
  readonly dek: Buffer
}

function asBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return Buffer.from(value)
  if (value instanceof Uint8Array) return Buffer.from(value)
  return null
}

function isFiniteInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function configFromRow(row: DiaryAccessRow | undefined, vaultId: string): DiaryAccessConfig | null {
  if (!row) return null
  const salt = asBuffer(row.salt)
  const nonce = asBuffer(row.wrap_nonce)
  const wrappedDek = asBuffer(row.wrapped_dek)
  const tag = asBuffer(row.wrap_tag)
  if (
    row.id !== 1
    || row.format_version !== DIARY_ACCESS_FORMAT_VERSION
    || row.kdf_algorithm !== DIARY_ACCESS_KDF_ALGORITHM
    || row.kdf_version !== DIARY_ACCESS_KDF_VERSION
    || row.kdf_n !== SCRYPT_N
    || row.kdf_r !== SCRYPT_R
    || row.kdf_p !== SCRYPT_P
    || row.kdf_maxmem !== SCRYPT_MAXMEM
    || row.wrap_algorithm !== DIARY_ACCESS_WRAP_ALGORITHM
    || row.wrap_version !== DIARY_ACCESS_WRAP_VERSION
    || !salt || salt.length !== SCRYPT_SALT_BYTES
    || !nonce || nonce.length !== DIARY_ACCESS_NONCE_BYTES
    || !wrappedDek || wrappedDek.length !== SCRYPT_KEY_BYTES
    || !tag || tag.length !== DIARY_ACCESS_TAG_BYTES
    || typeof row.vault_id !== 'string'
    || row.vault_id !== vaultId
    || !isFiniteInteger(row.created_at)
    || !isFiniteInteger(row.updated_at)
  ) return null
  return { salt, nonce, wrappedDek, tag, vaultId: row.vault_id }
}

function capabilityToken(): string {
  return randomBytes(32).toString('base64url')
}

export type DiaryAccessServiceOptions = {
  readonly db: DatabaseT
  readonly kdfGuard: KdfGuard
  readonly now?: () => number
  readonly getVaultId?: () => string
}

export class DiaryAccessService {
  readonly db: DatabaseT
  readonly kdfGuard: KdfGuard
  readonly now: () => number
  readonly getVaultId: () => string
  private epoch = 0
  private readonly capabilities = new Map<string, Capability>()

  constructor(options: DiaryAccessServiceOptions) {
    this.db = options.db
    this.kdfGuard = options.kdfGuard
    this.now = options.now ?? Date.now
    this.getVaultId = options.getVaultId ?? getVaultId
  }

  private loadConfig(): DiaryAccessConfig | null {
    const row = this.db.prepare('SELECT * FROM diary_access_config WHERE id = 1 LIMIT 1').get() as DiaryAccessRow | undefined
    if (!row) return null
    const config = configFromRow(row, this.getVaultId())
    if (!config) throw new DiaryAccessServiceError(
      'diary-access-unavailable',
      503,
      'Diary access configuration is unavailable.',
    )
    return config
  }

  private dropCapability(token: string): void {
    const capability = this.capabilities.get(token)
    if (capability) capability.dek.fill(0)
    this.capabilities.delete(token)
  }

  private dropSessionCapabilities(sessionId: number): void {
    for (const [token, capability] of this.capabilities) {
      if (capability.sessionId === sessionId) this.dropCapability(token)
    }
  }

  private dropAllCapabilities(): void {
    for (const token of this.capabilities.keys()) this.dropCapability(token)
  }

  private issueCapability(sessionId: number, vaultId: string, dek: Buffer): { capability: string; epoch: number } {
    // Epoch changes are process-wide. Drop every previous DEK before issuing
    // the new session-bound capability so an old capability cannot remain in
    // memory after a fresh setup/unlock operation.
    this.dropAllCapabilities()
    this.epoch += 1
    const capability = capabilityToken()
    this.capabilities.set(capability, { sessionId, vaultId, epoch: this.epoch, dek })
    return { capability, epoch: this.epoch }
  }

  private assertSessionId(sessionId: number): void {
    if (!Number.isSafeInteger(sessionId) || sessionId < 1) {
      throw new DiaryAccessServiceError('diary-access-invalid-input', 400, 'Invalid authentication session.')
    }
  }

  status(sessionId: number, presentedCapability?: string | null): { state: DiaryAccessState; epoch?: number } {
    this.assertSessionId(sessionId)
    const config = this.loadConfig()
    if (!config) return { state: 'UNINITIALIZED' }
    if (presentedCapability && this.isCapabilityValid(sessionId, presentedCapability, config)) {
      return { state: 'UNLOCKED', epoch: this.capabilities.get(presentedCapability)?.epoch }
    }
    return { state: 'LOCKED' }
  }

  isCapabilityValid(sessionId: number, presentedCapability: unknown, config?: DiaryAccessConfig | null): boolean {
    let resolvedConfig: DiaryAccessConfig | null
    try {
      resolvedConfig = config === undefined ? this.loadConfig() : config
    } catch {
      return false
    }
    if (!resolvedConfig || typeof presentedCapability !== 'string' || presentedCapability.length < 32 || presentedCapability.length > 128) return false
    const capability = this.capabilities.get(presentedCapability)
    return Boolean(
      capability
      && capability.sessionId === sessionId
      && capability.vaultId === resolvedConfig.vaultId
      && capability.epoch === this.epoch
      && capability.dek.length === SCRYPT_KEY_BYTES,
    )
  }

  async setup(sessionId: number, password: unknown, signal?: AbortSignal): Promise<{ state: 'UNLOCKED'; capability: string; epoch: number }> {
    this.assertSessionId(sessionId)
    if (!isValidPassword(password)) {
      throw new DiaryAccessServiceError('diary-access-invalid-input', 400, 'Diary access password is invalid.')
    }
    if (this.loadConfig()) {
      throw new DiaryAccessServiceError('diary-access-invalid-state', 409, 'Diary access is already initialized.')
    }

    const vaultId = this.getVaultId()
    const salt = randomBytes(SCRYPT_SALT_BYTES)
    const dek = randomBytes(SCRYPT_KEY_BYTES)
    let kek: Buffer | null = null
    try {
      kek = await deriveDiaryKek(password, salt, this.kdfGuard, signal)
      const wrapped = wrapDiaryDek(kek, dek, vaultId)
      const now = this.now()
      try {
        const transaction = this.db.transaction(() => {
          const existing = this.db.prepare('SELECT id FROM diary_access_config WHERE id = 1 LIMIT 1').get()
          if (existing) throw new DiaryAccessServiceError('diary-access-invalid-state', 409, 'Diary access is already initialized.')
          this.db.prepare(`
            INSERT INTO diary_access_config (
              id, format_version, kdf_algorithm, kdf_version,
              kdf_n, kdf_r, kdf_p, kdf_maxmem, salt,
              wrap_algorithm, wrap_version, wrap_nonce, wrapped_dek,
              wrap_tag, vault_id, created_at, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            DIARY_ACCESS_FORMAT_VERSION,
            DIARY_ACCESS_KDF_ALGORITHM,
            DIARY_ACCESS_KDF_VERSION,
            SCRYPT_N,
            SCRYPT_R,
            SCRYPT_P,
            SCRYPT_MAXMEM,
            salt,
            DIARY_ACCESS_WRAP_ALGORITHM,
            DIARY_ACCESS_WRAP_VERSION,
            wrapped.nonce,
            wrapped.wrappedDek,
            wrapped.tag,
            vaultId,
            now,
            now,
          )
        })
        transaction.immediate()
      } catch (error) {
        if (error instanceof DiaryAccessServiceError) throw error
        throw new DiaryAccessServiceError('diary-access-unavailable', 503, 'Diary access setup could not be saved.')
      }
      const issued = this.issueCapability(sessionId, vaultId, dek)
      return { state: 'UNLOCKED', ...issued }
    } catch (error) {
      if (error instanceof DiaryAccessServiceError) throw error
      if (error instanceof DiaryAccessCryptoError && error.code === 'invalid-password') {
        throw new DiaryAccessServiceError('diary-access-invalid-password', 401, 'Diary access password is invalid.')
      }
      throw new DiaryAccessServiceError('diary-access-unavailable', 503, 'Diary access setup is unavailable.')
    } finally {
      kek?.fill(0)
      // The issued capability owns this Buffer after a successful setup. On
      // failure there is no owner, so clear it before returning.
      if (![...this.capabilities.values()].some((entry) => entry.dek === dek)) dek.fill(0)
    }
  }

  async unlock(sessionId: number, password: unknown, signal?: AbortSignal): Promise<{ state: 'UNLOCKED'; capability: string; epoch: number }> {
    this.assertSessionId(sessionId)
    if (!isValidPassword(password)) {
      throw new DiaryAccessServiceError('diary-access-invalid-password', 401, 'Diary access password is invalid.')
    }
    const config = this.loadConfig()
    if (!config) throw new DiaryAccessServiceError('diary-access-invalid-state', 409, 'Diary access is not initialized.')
    try {
      const dek = await unwrapDiaryDek(password, config, this.kdfGuard, signal)
      if (dek.length !== SCRYPT_KEY_BYTES) {
        dek.fill(0)
        throw new DiaryAccessServiceError('diary-access-unavailable', 503, 'Diary access configuration is unavailable.')
      }
      const issued = this.issueCapability(sessionId, config.vaultId, dek)
      return { state: 'UNLOCKED', ...issued }
    } catch (error) {
      if (error instanceof DiaryAccessServiceError) throw error
      if (error instanceof DiaryAccessCryptoError && error.code === 'invalid-password') {
        throw new DiaryAccessServiceError('diary-access-invalid-password', 401, 'Diary access password is invalid.')
      }
      throw new DiaryAccessServiceError('diary-access-unavailable', 503, 'Diary access is unavailable.')
    }
  }

  lock(sessionId: number): { state: 'LOCKED' } {
    this.assertSessionId(sessionId)
    this.dropAllCapabilities()
    this.epoch += 1
    return { state: 'LOCKED' }
  }

  invalidateAuthSession(sessionId: number): void {
    if (!Number.isSafeInteger(sessionId) || sessionId < 1) return
    this.dropSessionCapabilities(sessionId)
  }

  resetForTesting(): void {
    this.dropAllCapabilities()
    this.epoch = 0
  }
}
