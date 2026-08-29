import { classifyDiaryPath } from '../../shared/diaryProtocol.js'
import { getAuthRuntime } from '../auth/runtime.js'
import { DIARY_ACCESS_CAPABILITY_HEADER } from './service.js'

/** History routes conventionally include `.md`; the live API uses logical paths. */
function logicalBodyPath(path: string): string {
  return path.endsWith('.md') ? path.slice(0, -3) : path
}

function lockedResponse(c: any): Response {
  c.header('Cache-Control', 'no-store')
  return c.json({ error: 'Diary access is locked.', code: 'diary-locked' }, 423)
}

export function isManagedDiaryBodyPath(path: string): boolean {
  return classifyDiaryPath(logicalBodyPath(path)) === 'managed'
}

export function hasDiaryBodyAccess(sessionId: unknown, capability: unknown): boolean {
  if (typeof sessionId !== 'number') return false
  const runtime = getAuthRuntime()
  return Boolean(runtime && runtime.diaryAccess.isCapabilityValid(sessionId, capability))
}

/**
 * Return a 423 response for managed Diary body access without a capability.
 * Structural metadata endpoints intentionally do not call this helper.
 */
export function requireDiaryBodyAccess(c: any, path: string): Response | null {
  if (!isManagedDiaryBodyPath(path)) return null
  const runtime = getAuthRuntime()
  const sessionId = c.get('authSessionId')
  const capability = c.req.header(DIARY_ACCESS_CAPABILITY_HEADER)
  if (runtime && hasDiaryBodyAccess(sessionId, capability)) return null
  return lockedResponse(c)
}

/**
 * Gate a vault-wide metadata migration, which scans raw Markdown and cannot
 * be checked one path at a time before the scan starts. An uninitialized
 * Diary access configuration is intentionally allowed; once configured, the
 * whole scan requires the same capability as a managed Diary body read.
 */
export function requireDiaryVaultBodyAccess(c: any): Response | null {
  const runtime = getAuthRuntime()
  if (!runtime) return null
  try {
    const status = runtime.diaryAccess.status(
      c.get('authSessionId'),
      c.req.header(DIARY_ACCESS_CAPABILITY_HEADER),
    )
    if (status.state === 'UNINITIALIZED' || status.state === 'UNLOCKED') return null
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.json({
      error: 'Diary access is temporarily unavailable.',
      code: 'diary-access-unavailable',
    }, 503)
  }
  return lockedResponse(c)
}
