// GET /api/posts/* must return the markdown body with the frontmatter
// stripped, under the `content` field. The client-side full-text search
// primes its body cache from this field; if it is missing, body-only
// queries (e.g. "H3" inside a doc whose title is the first H1) silently
// return zero hits because the cache ends up as empty strings.
import { describe, it, expect } from 'vitest'
import app from '../index'

async function get(urlPath: string) {
  const req = new Request(`http://localhost${urlPath}`)
  return app.fetch(req)
}

describe('GET /api/posts/*', () => {
  it('returns the markdown body with frontmatter stripped under `content`', async () => {
    const r = await get('/api/posts/inbox/markdown-syntax')
    expect(r.status).toBe(200)
    const body = await r.json() as { raw: string; content: string; frontmatter: unknown }
    // raw is the on-disk file (frontmatter + body, intact).
    expect(body.raw).toMatch(/^---\n[\s\S]*\n---\n/)
    // content is the body only — the frontmatter block is gone, and
    // markdown headings are present.
    expect(body.content.startsWith('---')).toBe(false)
    expect(body.content).toMatch(/^# H1/m)
    expect(body.content).toMatch(/^### H3/m)
    // frontmatter is parsed and exposed separately.
    expect(body.frontmatter).toMatchObject({ title: 'Markdown syntax quick reference' })
  })
})
