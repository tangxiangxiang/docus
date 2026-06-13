// Hono sub-router for /api/zettel. Mounted by server/index.ts.
//
// /draft/batch is the one route we add here. It writes a batch of
// Card[] (from the AI split-to-draft feature) to zettel/draft/,
// enforcing:
//
//   - The path prefix is hardcoded to zettel/draft/. The user only
//     controls the *slug* (the last path segment), which we validate
//     against SEGMENT_RE (same rule as POST /api/posts uses for the
//     final path segment).
//   - Slug collisions are auto-resolved with -2, -3, … suffix and
//     reported in the response as the final path used.
//   - Per-card errors do NOT abort the whole batch: the user gets
//     a per-card status (written / failed) and can re-try the failed
//     ones after fixing the cause.
//
// We use filePathFor to get the absolute path so the existing
// path-safety check (no .., no absolute paths) applies automatically.
import { Hono } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { filePathFor, SEGMENT_RE } from './paths.js'
import type { Card } from '../src/lib/ai-api.js'

const zettel = new Hono()

interface WriteResult {
  written: { slug: string; path: string }[]
  skipped: { slug: string; reason: string }[]
  failed:  { slug: string; reason: string }[]
}

function bad(c: any, msg: string, code = 400) {
  return c.json({ error: msg }, code)
}

/** Returns a unique slug in dir by appending -2, -3, … to `base`. */
async function uniqueSlug(dir: string, base: string): Promise<string> {
  if (!await exists(path.join(dir, base + '.md'))) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = base + '-' + i
    if (!await exists(path.join(dir, candidate + '.md'))) return candidate
  }
  // Pathological — 1000+ duplicates. Fall through with a timestamp suffix.
  return base + '-' + Date.now()
}

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true } catch { return false }
}

function renderCard(card: Card, today: string): string {
  // Zettel frontmatter is intentionally minimal: title + dates +
  // tags + provenance (source, splitMode). No `summary:` field —
  // zettel are atomic by definition, the title + body are the
  // complete card, and forcing a one-line summary out of the
  // body either produces a placeholder line that conveys nothing
  // or a fragile regex extraction that splits on the wrong
  // punctuation. If the user wants an explicit summary they
  // can add one by hand to a non-draft card.
  const tagsYaml = card.tags.length ? '[' + card.tags.join(', ') + ']' : '[]'
  return [
    '---',
    `title: ${card.title}`,
    `created: ${today}`,
    `updated: ${today}`,
    `tags: ${tagsYaml}`,
    `source: ${card.source}`,
    `splitMode: ${card.splitMode}`,
    '---',
    '',
    `# ${card.title}`,
    '',
    card.body,
  ].join('\n')
}

zettel.post('/draft/batch', async (c) => {
  const body = await c.req.json().catch(() => null) as { cards?: unknown } | null
  if (!body || !Array.isArray(body.cards)) return bad(c, 'cards array required')

  const cards = body.cards as Card[]
  const today = new Date().toISOString().slice(0, 10)
  const result: WriteResult = { written: [], skipped: [], failed: [] }

  for (const card of cards) {
    // Per-card shape check + slug validation. A single bad card
    // does not abort the batch — we report it in `failed` and move
    // on, so the user only re-tries the bad ones.
    if (!card || typeof card !== 'object' ||
        typeof card.title !== 'string' || typeof card.body !== 'string' ||
        !Array.isArray(card.tags) || typeof card.slug !== 'string' ||
        typeof card.source !== 'string' ||
        (card.splitMode !== 'inbox' && card.splitMode !== 'literature')) {
      result.failed.push({ slug: String((card as any)?.slug ?? '?'), reason: 'shape' })
      continue
    }
    if (!SEGMENT_RE.test(card.slug)) {
      result.failed.push({ slug: card.slug, reason: 'invalid slug' })
      continue
    }
    let abs: string
    try { abs = filePathFor('zettel/draft/' + card.slug) } catch (e: any) {
      result.failed.push({ slug: card.slug, reason: e.message })
      continue
    }
    const finalSlug = await uniqueSlug(path.dirname(abs), card.slug)
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, renderCard(card, today), 'utf8')
      result.written.push({ slug: finalSlug, path: 'zettel/draft/' + finalSlug })
    } catch (e: any) {
      result.failed.push({ slug: card.slug, reason: e.message })
    }
  }

  return c.json(result)
})

export default zettel
