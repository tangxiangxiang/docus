import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'

export const DIARY_BODY_ENVELOPE_VERSION = 1 as const
export const DIARY_BODY_ALGORITHM = 'aes-256-gcm' as const
export const DIARY_BODY_NONCE_BYTES = 12
export const DIARY_BODY_TAG_BYTES = 16
export const DIARY_BODY_CONTEXT = 'docus/diary-body/v1'

type BodyContext = {
  readonly vaultId: string
  readonly documentId: string
  readonly logicalPath: string
}

export type DiaryBodyRead = {
  readonly raw: string
  readonly encrypted: boolean
  readonly bytes: Buffer
}

export class DiaryBodyCryptoError extends Error {
  readonly code:
    | 'invalid-key'
    | 'invalid-envelope'
    | 'unsupported-envelope'
    | 'identity-mismatch'
    | 'authentication-failed'

  constructor(
    code: DiaryBodyCryptoError['code'],
    message = 'Diary body encryption failed',
  ) {
    super(message)
    this.name = 'DiaryBodyCryptoError'
    this.code = code
  }
}

type DiaryBodyEnvelope = {
  kind: 'docus-diary-body'
  version: typeof DIARY_BODY_ENVELOPE_VERSION
  algorithm: typeof DIARY_BODY_ALGORITHM
  documentId: string
  logicalPath: string
  nonce: string
  ciphertext: string
  tag: string
}

function aadFor(context: BodyContext): Buffer {
  return Buffer.from([
    DIARY_BODY_CONTEXT,
    context.vaultId,
    context.documentId,
    context.logicalPath,
    String(DIARY_BODY_ENVELOPE_VERSION),
  ].join('\u0000'), 'utf8')
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new DiaryBodyCryptoError('invalid-key')
  }
}

function decodeBase64(value: unknown, expectedLength: number, field: string): Buffer {
  if (typeof value !== 'string' || !value) {
    throw new DiaryBodyCryptoError('invalid-envelope', `Diary body envelope has no valid ${field}`)
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== expectedLength && field !== 'ciphertext') {
    throw new DiaryBodyCryptoError('invalid-envelope', `Diary body envelope has invalid ${field}`)
  }
  return decoded
}

function parseEnvelope(bytes: Buffer): DiaryBodyEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.kind !== 'docus-diary-body') return null
  if (record.version !== DIARY_BODY_ENVELOPE_VERSION || record.algorithm !== DIARY_BODY_ALGORITHM) {
    throw new DiaryBodyCryptoError('unsupported-envelope', 'Diary body envelope version is not supported')
  }
  if (typeof record.documentId !== 'string' || typeof record.logicalPath !== 'string') {
    throw new DiaryBodyCryptoError('invalid-envelope', 'Diary body envelope identity is invalid')
  }
  if (typeof record.nonce !== 'string' || typeof record.ciphertext !== 'string' || typeof record.tag !== 'string') {
    throw new DiaryBodyCryptoError('invalid-envelope', 'Diary body envelope payload is invalid')
  }
  return record as unknown as DiaryBodyEnvelope
}

export function encryptDiaryBody(raw: string, context: BodyContext, key: Buffer): Buffer {
  assertKey(key)
  const nonce = randomBytes(DIARY_BODY_NONCE_BYTES)
  const cipher = createCipheriv(DIARY_BODY_ALGORITHM, key, nonce)
  cipher.setAAD(aadFor(context))
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(raw, 'utf8')), cipher.final()])
  const tag = cipher.getAuthTag()
  if (tag.length !== DIARY_BODY_TAG_BYTES) throw new DiaryBodyCryptoError('invalid-key')
  const envelope: DiaryBodyEnvelope = {
    kind: 'docus-diary-body',
    version: DIARY_BODY_ENVELOPE_VERSION,
    algorithm: DIARY_BODY_ALGORITHM,
    documentId: context.documentId,
    logicalPath: context.logicalPath,
    nonce: nonce.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  }
  return Buffer.from(JSON.stringify(envelope), 'utf8')
}

export function decryptDiaryBody(bytes: Buffer, context: BodyContext, key: Buffer): DiaryBodyRead {
  assertKey(key)
  const envelope = parseEnvelope(bytes)
  if (!envelope) {
    // D8.4 owns migration. D8.2 can read a legacy plaintext body only as an
    // explicit compatibility path; every D8.2 write emits an envelope.
    return { raw: bytes.toString('utf8'), encrypted: false, bytes }
  }
  if (envelope.documentId !== context.documentId || envelope.logicalPath !== context.logicalPath) {
    throw new DiaryBodyCryptoError('identity-mismatch', 'Diary body identity binding does not match')
  }
  const nonce = decodeBase64(envelope.nonce, DIARY_BODY_NONCE_BYTES, 'nonce')
  const ciphertext = decodeBase64(envelope.ciphertext, 0, 'ciphertext')
  const tag = decodeBase64(envelope.tag, DIARY_BODY_TAG_BYTES, 'tag')
  try {
    const decipher = createDecipheriv(DIARY_BODY_ALGORITHM, key, nonce)
    decipher.setAAD(aadFor(context))
    decipher.setAuthTag(tag)
    const raw = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return { raw, encrypted: true, bytes }
  } catch {
    throw new DiaryBodyCryptoError('authentication-failed', 'Diary body authentication failed')
  }
}

export async function readDiaryBody(
  absolutePath: string,
  context: BodyContext,
  key: Buffer,
): Promise<DiaryBodyRead & { readonly stat: Awaited<ReturnType<typeof fs.stat>> }> {
  const bytes = await fs.readFile(absolutePath)
  const first = decryptDiaryBody(bytes, context, key)
  const stat = await fs.stat(absolutePath)
  const second = await fs.readFile(absolutePath)
  if (!bytes.equals(second)) {
    throw new DiaryBodyCryptoError('authentication-failed', 'Diary body changed during read')
  }
  return { ...first, stat }
}
