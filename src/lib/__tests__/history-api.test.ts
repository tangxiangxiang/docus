// Wire-level tests for the typed fetch wrappers in src/lib/history-api.ts.
//
// Stub global.fetch so no real network is hit. The assertions pin down:
//   1. Request shape (URL, query, method, body) — caught regressions
//      where the client URL drifted from the server route.
//   2. Response mapping on 2xx (the success shape comes through).
//   3. The non-2xx contract for endpoints that throw (server's
//      `{ error }` body surfaces verbatim) vs. the one endpoint that
//      doesn't (/status uses 503 + `{ available: false }` as a
//      graceful-unavailable signal, not an error — getStatus must
//      resolve that body, not throw).
//
// The mock-passthrough pattern mirrors src/lib/__tests__/ai-api.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as api from '../history-api'

type FetchCall = { url: string; init: RequestInit }

let calls: FetchCall[] = []
let responses: { status: number; body: unknown }[] = []

beforeEach(() => {
  calls = []
  responses = []
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses.shift() ?? { status: 200, body: {} }
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
})

describe('getStatus', () => {
  it('resolves with the body on a 2xx', async () => {
    responses.push({ status: 200, body: { dirty: [{ path: 'a.md', index: '?', worktree: '?' }], available: true } })
    const out = await api.getStatus()
    expect(out).toEqual({ dirty: [{ path: 'a.md', index: '?', worktree: '?' }], available: true })
  })

  it('resolves with { available: false } on a 503 (graceful unavailable, not an error)', async () => {
    /* /status uses 503 + `{ dirty: [], available: false }` to mean
       "git is not on this machine". The History panel reads
       `available` off the body and renders an EmptyState — throwing
       here would surface a useless "getStatus failed: 503" instead
       and hide the actual reason. This test pins that contract so
       a future "normalize all error handling" refactor doesn't
       silently regress the panel into an error state. */
    responses.push({ status: 503, body: { dirty: [], available: false } })
    const out = await api.getStatus()
    expect(out).toEqual({ dirty: [], available: false })
  })
})

describe('getDiff', () => {
  it('throws the server error message on a 4xx', async () => {
    responses.push({ status: 404, body: { error: 'file does not exist at ref HEAD~1' } })
    await expect(api.getDiff('inbox/a.md', 'HEAD~1', 'HEAD'))
      .rejects.toThrow('file does not exist at ref HEAD~1')
  })

  it('falls back to "<endpoint> failed: <status>" when the body has no error field', async () => {
    responses.push({ status: 500, body: {} })
    await expect(api.getDiff('inbox/a.md', 'HEAD~1', 'HEAD'))
      .rejects.toThrow('getDiff inbox/a.md failed: 500')
  })
})

describe('createCommit', () => {
  it('throws the server error message on a non-2xx', async () => {
    responses.push({ status: 409, body: { error: 'nothing to commit' } })
    await expect(api.createCommit(['a.md'], 'msg'))
      .rejects.toThrow('nothing to commit')
  })
})

describe('restoreFile', () => {
  it('posts one document path and revision and returns restored bytes', async () => {
    responses.push({
      status: 200,
      body: { path: 'a.md', ref: 'abc1234', raw: '# Historical', mtime: 100 },
    })

    await expect(api.restoreFile('a.md', 'abc1234')).resolves.toEqual({
      path: 'a.md',
      ref: 'abc1234',
      raw: '# Historical',
      mtime: 100,
    })
    expect(calls).toEqual([expect.objectContaining({
      url: '/api/history/restore',
      init: expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: 'a.md', ref: 'abc1234' }),
      }),
    })])
  })

  it('throws the server error message on a non-2xx', async () => {
    responses.push({ status: 404, body: { error: 'file does not exist at ref HEAD' } })
    await expect(api.restoreFile('a.md', 'HEAD'))
      .rejects.toThrow('file does not exist at ref HEAD')
  })
})

describe('getFileAt', () => {
  it('throws the server error message on a non-2xx', async () => {
    responses.push({ status: 400, body: { error: 'invalid ref' } })
    await expect(api.getFileAt('a.md', 'main'))
      .rejects.toThrow('invalid ref')
  })

  it('falls back to "<endpoint> failed: <status>" when the body has no error field', async () => {
    responses.push({ status: 503, body: {} })
    await expect(api.getFileAt('a.md', 'WORKTREE'))
      .rejects.toThrow('getFileAt a.md@WORKTREE failed: 503')
  })
})

describe('getLog', () => {
  it('throws the server error message on a non-2xx', async () => {
    responses.push({ status: 503, body: { error: 'git not available' } })
    await expect(api.getLog()).rejects.toThrow('git not available')
  })
})
