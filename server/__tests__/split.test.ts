// Split route tests. We exercise the Hono route layer end-to-end
// (in-process: `aiRoutes.request(...)`), stubbing the SDK client so the
// tests don't hit the network.
//
// The tests use the same Hono sub-router that server/index.ts mounts
// under /api/ai — see how ai-routes.test.ts wires this up. We follow
// that pattern: import the sub-router directly and call it with a
// mock Request.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import aiRoutes from '../ai/routes.js'

// Stub the SDK so we don't need an API key in tests. The stub is
// per-test (see beforeEach) so each test can return a different
// shape to exercise parse paths.
const messagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = { create: (...args: unknown[]) => messagesCreate(...args) }
    },
  }
})

// Stub the env so resolveApiKey() returns something — otherwise
// runSplit short-circuits with 'no-api-key' before reaching the SDK.
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  messagesCreate.mockReset()
})

// Helper: build a POST request with a JSON body.
function postJson(path: string, body: unknown): Request {
  return new Request('http://localhost' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/ai/split', () => {
  it('returns 200 with parsed Card[] for a happy-path model output', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify([
          { title: 'Cards are atomic', body: 'Each card…', tags: ['meta'], slug: 'cards-are-atomic' },
          { title: 'Slug rules', body: 'Lowercase…', tags: ['meta', 'naming'], slug: 'slug-rules' },
        ]),
      }],
    })
    const res = await aiRoutes.request(postJson('/split', { path: 'inbox/init', mode: 'inbox' }))
    expect(res.status).toBe(200)
    const body = await res.json() as { cards: Array<{ slug: string; source: string; splitMode: string }> }
    expect(body.cards).toHaveLength(2)
    expect(body.cards[0]).toMatchObject({
      slug: 'cards-are-atomic',
      source: 'inbox/init',
      splitMode: 'inbox',
    })
  })

  it('rejects paths outside inbox/ and literature/ with 400', async () => {
    const res = await aiRoutes.request(postJson('/split', { path: 'zettel/init', mode: 'inbox' }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/inbox|literature/)
  })

  it('returns 400 when path is missing', async () => {
    const res = await aiRoutes.request(postJson('/split', { mode: 'inbox' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when mode is missing', async () => {
    const res = await aiRoutes.request(postJson('/split', { path: 'inbox/init' }))
    expect(res.status).toBe(400)
  })

  it('returns 502 when the model returns non-JSON', async () => {
    messagesCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Sorry, I cannot…' }] })
    const res = await aiRoutes.request(postJson('/split', { path: 'inbox/init', mode: 'inbox' }))
    expect(res.status).toBe(502)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('parse-failed')
  })

  it('returns 502 when a card slug fails SEGMENT_RE', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify([{ title: 'Bad', body: 'x', tags: ['t'], slug: 'Bad Slug' }]),
      }],
    })
    const res = await aiRoutes.request(postJson('/split', { path: 'inbox/init', mode: 'inbox' }))
    expect(res.status).toBe(502)
  })

  it('strips stray code fences the model sometimes wraps JSON in', async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '```json\n' + JSON.stringify([{ title: 't', body: 'b', tags: [], slug: 'a-b' }]) + '\n```',
      }],
    })
    const res = await aiRoutes.request(postJson('/split', { path: 'inbox/init', mode: 'inbox' }))
    expect(res.status).toBe(200)
  })

  it('caps results at 12 cards (silently truncates overshoots)', async () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({
      title: 't' + i, body: 'b', tags: [], slug: 's' + i,
    }))
    messagesCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(cards) }] })
    const res = await aiRoutes.request(postJson('/split', { path: 'inbox/init', mode: 'inbox' }))
    const body = await res.json() as { cards: unknown[] }
    expect(body.cards).toHaveLength(12)
  })
})
