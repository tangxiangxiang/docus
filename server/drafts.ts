// Hono sub-router for /api/drafts. It writes a batch of Card[]
// from the AI split-to-draft feature to the draft folder that belongs
// to the source area: inbox/draft/ or literature/draft/, enforcing:
//
//   - The path prefix is derived from `source`. The user only controls
//     the slug (the last path segment), which is validated with SLUG_RE.
//   - Slug collisions are auto-resolved with -2, -3, ... suffix and
//     reported in the response as the final path used.
//   - Per-card errors do not abort the whole batch: the user gets a
//     per-card status and can retry only the failed ones.
//
// We use filePathFor to get the absolute path so the existing path-safety
// check (no .., no absolute paths) applies automatically.
import { Hono } from 'hono'
import type { Context } from 'hono'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Database as DatabaseT } from 'better-sqlite3'
import { filePathFor, SLUG_RE } from './paths.js'
import { getDb } from './db.js'
import { saveDocumentMetadata } from './documentMetadata.js'
import type { Card } from '../src/lib/ai-api.js'

interface WriteResult {
  written: { slug: string; path: string }[]
  skipped: { slug: string; reason: string }[]
  failed: { slug: string; reason: string }[]
}

function bad(c: Context, msg: string) {
  return c.json({ error: msg }, 400)
}

async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true } catch { return false }
}

/** Returns a unique slug in dir by appending -2, -3, ... to `base`. */
async function uniqueSlug(dir: string, base: string): Promise<string> {
  if (!await exists(path.join(dir, base + '.md'))) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = base + '-' + i
    if (!await exists(path.join(dir, candidate + '.md'))) return candidate
  }
  return base + '-' + Date.now()
}

function draftPrefixForSource(source: string): string | null {
  if (source.startsWith('inbox/')) return 'inbox/draft'
  if (source.startsWith('literature/')) return 'literature/draft'
  return null
}

function renderCard(card: Card): string {
  return [
    `# ${card.title}`,
    '',
    card.body,
  ].join('\n')
}

export async function writeDraftBatchHandler(c: Context, db: DatabaseT = getDb()) {
  const body = await c.req.json().catch(() => null) as { cards?: unknown } | null
  if (!body || !Array.isArray(body.cards)) return bad(c, 'cards array required')

  const cards = body.cards as Card[]
  const result: WriteResult = { written: [], skipped: [], failed: [] }

  for (const card of cards) {
    if (!card || typeof card !== 'object' ||
        typeof card.title !== 'string' || typeof card.body !== 'string' ||
        !Array.isArray(card.tags) || typeof card.slug !== 'string' ||
        typeof card.source !== 'string') {
      result.failed.push({ slug: String((card as any)?.slug ?? '?'), reason: 'shape' })
      continue
    }
    if (!SLUG_RE.test(card.slug)) {
      result.failed.push({ slug: card.slug, reason: 'invalid slug' })
      continue
    }
    const draftPrefix = draftPrefixForSource(card.source)
    if (!draftPrefix) {
      result.failed.push({ slug: card.slug, reason: 'source must be under inbox/ or literature/' })
      continue
    }
    const draftPath = `${draftPrefix}/${card.slug}`
    let abs: string
    try { abs = filePathFor(draftPath) } catch (e: any) {
      result.failed.push({ slug: card.slug, reason: e.message })
      continue
    }
    const finalSlug = await uniqueSlug(path.dirname(abs), card.slug)
    const finalPath = `${draftPrefix}/${finalSlug}`
    const finalAbs = filePathFor(finalPath)
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(finalAbs, renderCard(card), 'utf8')
      const stat = await fs.stat(finalAbs)
      saveDocumentMetadata(db, {
        path: finalPath,
        title: card.title,
        tags: card.tags,
        createdAt: stat.mtimeMs,
        updatedAt: stat.mtimeMs,
      })
      result.written.push({ slug: finalSlug, path: finalPath })
    } catch (e: any) {
      await fs.rm(finalAbs, { force: true }).catch(() => undefined)
      result.failed.push({ slug: card.slug, reason: e.message })
    }
  }

  return c.json(result)
}

export function createDraftRoutes(dbProvider: () => DatabaseT = getDb) {
  const routes = new Hono()
  routes.post('/batch', (c) => writeDraftBatchHandler(c, dbProvider()))
  return routes
}

export default createDraftRoutes()
