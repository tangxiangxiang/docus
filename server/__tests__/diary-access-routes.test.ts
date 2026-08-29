import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app from '../index.js'
import {
  authenticatedRequest,
  closeAuthTestContext,
  createAuthenticatedTestContext,
  jsonRequest,
  withDiaryCapability,
  type AuthenticatedTestContext,
} from './helpers/auth.js'
import { revokeSessionById } from '../auth/session.js'

const PASSWORD = 'diary-access-route-password'

let context: AuthenticatedTestContext

beforeEach(() => {
  context = createAuthenticatedTestContext()
})

afterEach(() => {
  closeAuthTestContext(context)
})

function protectedJson(path: string, body: unknown): Request {
  return jsonRequest(path, {
    method: 'POST',
    origin: context.runtime.config.publicOrigin,
    cookie: context.cookie,
    body,
  })
}

describe('D8.1 Diary access routes', () => {
  it('sets up exactly once, exposes only an opaque capability, and locks it', async () => {
    const initial = await app.fetch(authenticatedRequest(context, '/api/diary/access/status'))
    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({ state: 'UNINITIALIZED' })

    const setup = await app.fetch(protectedJson('/api/diary/access/setup', { password: PASSWORD }))
    expect(setup.status).toBe(201)
    const setupBody = await setup.json() as { state: string; capability: string; epoch: number }
    expect(setupBody.state).toBe('UNLOCKED')
    expect(setupBody.capability).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(setupBody.capability).not.toContain(PASSWORD)
    expect(setupBody.epoch).toBeGreaterThan(0)

    const unlocked = await app.fetch(withDiaryCapability(
      context,
      authenticatedRequest(context, '/api/diary/access/status'),
      setupBody.capability,
    ))
    expect(await unlocked.json()).toMatchObject({ state: 'UNLOCKED', epoch: setupBody.epoch })

    const duplicate = await app.fetch(protectedJson('/api/diary/access/setup', { password: PASSWORD }))
    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toMatchObject({ code: 'diary-access-invalid-state' })

    const lock = await app.fetch(withDiaryCapability(
      context,
      protectedJson('/api/diary/access/lock', {}),
      setupBody.capability,
    ))
    expect(lock.status).toBe(200)
    expect(await lock.json()).toEqual({ state: 'LOCKED' })

    const locked = await app.fetch(withDiaryCapability(
      context,
      authenticatedRequest(context, '/api/diary/access/status'),
      setupBody.capability,
    ))
    expect(await locked.json()).toEqual({ state: 'LOCKED' })
  })

  it('keeps wrong-password unlock locked and issues a new session-bound capability on success', async () => {
    const setup = await app.fetch(protectedJson('/api/diary/access/setup', { password: PASSWORD }))
    const first = await setup.json() as { capability: string; epoch: number }
    await app.fetch(withDiaryCapability(
      context,
      protectedJson('/api/diary/access/lock', {}),
      first.capability,
    ))

    const wrong = await app.fetch(protectedJson('/api/diary/access/unlock', { password: 'wrong-diary-password' }))
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({ code: 'diary-access-invalid-password' })

    const correct = await app.fetch(protectedJson('/api/diary/access/unlock', { password: PASSWORD }))
    expect(correct.status).toBe(200)
    const second = await correct.json() as { state: string; capability: string; epoch: number }
    expect(second.state).toBe('UNLOCKED')
    expect(second.capability).not.toBe(first.capability)
    expect(second.epoch).toBeGreaterThan(first.epoch)

    const old = await app.fetch(withDiaryCapability(
      context,
      authenticatedRequest(context, '/api/diary/access/status'),
      first.capability,
    ))
    expect(await old.json()).toEqual({ state: 'LOCKED' })

    const current = await app.fetch(withDiaryCapability(
      context,
      authenticatedRequest(context, '/api/diary/access/status'),
      second.capability,
    ))
    expect(await current.json()).toMatchObject({ state: 'UNLOCKED', epoch: second.epoch })
  })

  it('invalidates the capability before logout completes', async () => {
    const setup = await app.fetch(protectedJson('/api/diary/access/setup', { password: PASSWORD }))
    const { capability } = await setup.json() as { capability: string }
    expect(context.runtime.diaryAccess.isCapabilityValid(context.session.id, capability)).toBe(true)

    const logout = await app.fetch(jsonRequest('/api/auth/logout', {
      method: 'POST',
      origin: context.runtime.config.publicOrigin,
      cookie: context.cookie,
    }))
    expect(logout.status).toBe(204)
    expect(context.runtime.diaryAccess.isCapabilityValid(context.session.id, capability)).toBe(false)
  })

  it('invalidates the capability when the auth boundary observes a revoked session', async () => {
    const setup = await app.fetch(protectedJson('/api/diary/access/setup', { password: PASSWORD }))
    const { capability } = await setup.json() as { capability: string }
    expect(context.runtime.diaryAccess.isCapabilityValid(context.session.id, capability)).toBe(true)

    expect(revokeSessionById(context.db, context.session.id)).toBe(true)
    const status = await app.fetch(withDiaryCapability(
      context,
      authenticatedRequest(context, '/api/diary/access/status'),
      capability,
    ))
    expect(status.status).toBe(401)
    expect(await status.json()).toMatchObject({ code: 'auth-session-required' })
    expect(context.runtime.diaryAccess.isCapabilityValid(context.session.id, capability)).toBe(false)
  })
})
