import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import {
  DiaryBodyCryptoError,
  decryptDiaryBody,
  encryptDiaryBody,
} from './body.js'

const context = {
  vaultId: 'vault-test',
  documentId: 'document-test',
  logicalPath: 'diary/2026-08-29',
}

describe('D8.2 Diary body envelope', () => {
  it('round-trips plaintext with a fresh authenticated envelope', () => {
    const key = randomBytes(32)
    const first = encryptDiaryBody('# private\n', context, key)
    const second = encryptDiaryBody('# private\n', context, key)

    expect(first.toString('utf8')).not.toContain('# private')
    expect(second.equals(first)).toBe(false)
    expect(decryptDiaryBody(first, context, key)).toMatchObject({
      raw: '# private\n', encrypted: true,
    })
    key.fill(0)
  })

  it('fails closed for tampering, identity mismatch, and unknown versions', () => {
    const key = randomBytes(32)
    const envelope = JSON.parse(encryptDiaryBody('secret', context, key).toString('utf8')) as Record<string, unknown>
    const tampered = Buffer.from(JSON.stringify({ ...envelope, ciphertext: 'dGFtcGVyZWQ=' }))
    expect(() => decryptDiaryBody(tampered, context, key)).toThrowError(
      expect.objectContaining<Partial<DiaryBodyCryptoError>>({ code: 'authentication-failed' }),
    )
    expect(() => decryptDiaryBody(Buffer.from(JSON.stringify(envelope)), { ...context, logicalPath: 'diary/2026-08-28' }, key))
      .toThrowError(expect.objectContaining({ code: 'identity-mismatch' }))
    expect(() => decryptDiaryBody(Buffer.from(JSON.stringify({ ...envelope, version: 99 })), context, key))
      .toThrowError(expect.objectContaining({ code: 'unsupported-envelope' }))
    key.fill(0)
  })

  it('keeps legacy plaintext readable for the later explicit migration phase', () => {
    const key = randomBytes(32)
    expect(decryptDiaryBody(Buffer.from('# legacy\n'), context, key)).toMatchObject({
      raw: '# legacy\n', encrypted: false,
    })
    key.fill(0)
  })
})
