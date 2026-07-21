import { promises as fs } from 'node:fs'
import { Hono } from 'hono'
import { getDocumentMetadataById, saveDocumentMetadata } from '../documentMetadata.js'
import {
  cleanDocumentFrontmatter,
  exportDocumentFrontmatter,
  previewFrontmatterCleanup,
  restoreDocumentFrontmatter,
} from '../frontmatterArchive.js'
import { getIndex as getLinkIndex } from '../linkIndex.js'
import {
  getMetadataMigrationSummary,
  listMetadataMigrationRecords,
  migrateVaultMetadata,
} from '../metadataMigration.js'
import { CONTENT_DIR, filePathFor } from '../paths.js'
import { bad, ensureMetadata, exists, metadataDb } from './shared.js'

const metadataRoutes = new Hono()

let activeMetadataMigration: Promise<Awaited<ReturnType<typeof migrateVaultMetadata>>> | null = null

function runMetadataMigration() {
  if (activeMetadataMigration) return activeMetadataMigration
  activeMetadataMigration = migrateVaultMetadata(metadataDb(), CONTENT_DIR)
    .finally(() => { activeMetadataMigration = null })
  return activeMetadataMigration
}

metadataRoutes.get('/api/metadata/migration', (c) => {
  const records = listMetadataMigrationRecords(metadataDb())
  return c.json({
    running: activeMetadataMigration !== null,
    summary: getMetadataMigrationSummary(metadataDb()),
    failures: records.filter((record) => record.status === 'failed'),
    cleanedPaths: records.filter((record) => record.status === 'cleaned').map((record) => record.path),
  })
})

metadataRoutes.post('/api/metadata/migrate', async (c) => {
  const report = await runMetadataMigration()
  return c.json({ report, summary: getMetadataMigrationSummary(metadataDb()) })
})

metadataRoutes.get('/api/metadata/cleanup/preview', async (c) => {
  return c.json(await previewFrontmatterCleanup(metadataDb()))
})

metadataRoutes.get('/api/metadata/export', (c) => {
  const documentPath = c.req.query('path')
  const mode = c.req.query('mode') ?? 'canonical'
  if (!documentPath) return bad(c, 'path required')
  if (mode !== 'canonical' && mode !== 'original') return bad(c, 'invalid export mode')
  const frontmatter = exportDocumentFrontmatter(metadataDb(), documentPath, mode)
  if (frontmatter === null) return bad(c, 'frontmatter export not available', 404)
  return c.json({ path: documentPath, mode, frontmatter })
})

function confirmedPaths(body: unknown, confirmation: string): string[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as { paths?: unknown; confirm?: unknown }
  if (value.confirm !== confirmation || !Array.isArray(value.paths)
      || value.paths.length === 0 || value.paths.length > 1000
      || value.paths.some((item) => typeof item !== 'string')) return null
  return value.paths as string[]
}

metadataRoutes.post('/api/metadata/cleanup', async (c) => {
  const paths = confirmedPaths(await c.req.json().catch(() => null), 'REMOVE_FRONTMATTER')
  if (!paths) return bad(c, 'explicit confirmation and paths are required')
  return c.json(await cleanDocumentFrontmatter(metadataDb(), paths))
})

metadataRoutes.post('/api/metadata/restore', async (c) => {
  const body = await c.req.json().catch(() => null) as { paths?: unknown; confirm?: unknown; mode?: unknown } | null
  const paths = confirmedPaths(body, 'RESTORE_FRONTMATTER')
  const mode = body?.mode ?? 'original'
  if (!paths) return bad(c, 'explicit confirmation and paths are required')
  if (mode !== 'original' && mode !== 'canonical') return bad(c, 'invalid restore mode')
  return c.json(await restoreDocumentFrontmatter(metadataDb(), paths, mode))
})

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error(`${field} must be an array of at most 50 strings`)
  if (value.some((item) => typeof item !== 'string' || item.length > 100)) {
    throw new Error(`${field} items must be strings of at most 100 characters`)
  }
  return value as string[]
}

// Current metadata by STABLE document id (single-segment UUID) —
// method-disambiguated from the path-splat PATCH below. Draft
// recovery's path resolver queries this: after an emptied-family
// probe, only a by-identity server lookup can certify where the
// document lives now. `updatedAt` travels as the version token.
metadataRoutes.get('/api/metadata/documents/:id', (c) => {
  const metadata = getDocumentMetadataById(metadataDb(), c.req.param('id'))
  if (!metadata) return bad(c, 'not found', 404)
  return c.json(metadata)
})

metadataRoutes.patch('/api/metadata/documents/*', async (c) => {
  const documentPath = c.req.path.replace(/^\/api\/metadata\/documents\//, '')
  let abs: string
  try { abs = filePathFor(documentPath) } catch (error: any) { return bad(c, error.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || Array.isArray(body)) return bad(c, 'body required')

  const [raw, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
  const current = ensureMetadata(documentPath, raw, stat.mtimeMs)
  const title = body.title === undefined ? current.title : body.title
  const summary = body.summary === undefined ? current.summary : body.summary
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return bad(c, 'title must be a non-empty string of at most 200 characters')
  }
  if (typeof summary !== 'string' || summary.length > 2000) {
    return bad(c, 'summary must be a string of at most 2000 characters')
  }

  let tags = current.tags
  try {
    if (body.tags !== undefined) tags = stringList(body.tags, 'tags')
  } catch (error) {
    return bad(c, (error as Error).message)
  }
  const saved = saveDocumentMetadata(metadataDb(), {
    ...current,
    title,
    summary,
    tags,
    updatedAt: Date.now(),
  })
  try {
    const idx = await getLinkIndex()
    idx.setTitle(documentPath, saved.title)
  } catch { /* next rebuild repairs a stale display title */ }
  return c.json(saved)
})

export default metadataRoutes
