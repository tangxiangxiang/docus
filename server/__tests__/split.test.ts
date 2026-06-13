// Split route tests. We exercise the Hono route layer end-to-end
// (in-process: `aiRoutes.request(...)`), stubbing the SDK client so the
// tests don't hit the network.
//
// The tests use the same Hono sub-router that server/index.ts mounts
// under /api/ai — see how ai-routes.test.ts wires this up. We follow
// that pattern: import the sub-router directly and call it with a
// mock Request.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
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

// Per-test temp dir for the source note. The happy-path test
// historically read /Users/txx/docus/src/content/inbox/init.md off
// the dev vault, which made it fragile (the test would fail in CI
// or a clean clone where that file isn't seeded). Mocking
// filePathFor to redirect into this temp dir makes the test
// self-contained.
//
// `tmpRoot` is referenced inside the mock factory, which vitest
// hoists above this assignment — but the factory is a function
// that runs per-import, so it reads `tmpRoot` lazily. As long as
// beforeEach assigns it before any test runs, this is safe.
let tmpRoot: string

vi.mock('../paths.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../paths.js')>()
  return {
    ...mod,
    filePathFor: (p: string) => path.join(tmpRoot, p + '.md'),
  }
})

// Stub the env so resolveApiKey() returns something — otherwise
// runSplit short-circuits with 'no-api-key' before reaching the SDK.
beforeEach(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  messagesCreate.mockReset()
  // Create a temp content dir and seed the source note the
  // happy-path test reads. filePathFor('inbox/init') is mocked to
  // return tmpRoot/inbox/init.md, so we need to seed that file.
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-split-test-'))
  await fs.mkdir(path.join(tmpRoot, 'inbox'), { recursive: true })
  await fs.writeFile(path.join(tmpRoot, 'inbox', 'init.md'), '# test\n', 'utf8')
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
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
    const body = await res.json() as { cards: Array<{ slug: string; source: string }> }
    expect(body.cards).toHaveLength(2)
    expect(body.cards[0]).toMatchObject({
      slug: 'cards-are-atomic',
      source: 'inbox/init',
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
