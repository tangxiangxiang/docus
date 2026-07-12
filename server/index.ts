import { Hono } from 'hono'
import type { Database as DatabaseT } from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import matter from 'gray-matter'
import { filePathFor, folderPathFor, CONTENT_DIR, isValidPathSyntax, isValidSegment } from './paths.js'
import { listPostsFlat, buildTree, listSubtreePaths, readFrontmatter } from './tree.js'
import { getIndex as getLinkIndex } from './linkIndex.js'
import aiRoutes from './ai/routes.js'
import historyRoutes from './history/routes.js'
import draftsRoutes from './drafts.js'
import zettelRoutes from './zettel.js'
import { isInZettel } from '../src/composables/zettelProtocol.js'
import type { PostSummary, PostDetail } from '../src/lib/api.js'
import { getDb } from './db.js'
import {
  deleteDocumentMetadata,
  deleteDocumentMetadataPrefix,
  ensureDocumentMetadata,
  getDocumentMetadata,
  listDocumentMetadata,
  moveDocumentMetadataPrefix,
  saveDocumentMetadata,
} from './documentMetadata.js'
import { renameDocumentWithMetadata } from './documentFileLifecycle.js'
import { rewriteDocumentReferences } from './renameReferences.js'
import {
  getMetadataMigrationSummary,
  listMetadataMigrationRecords,
  migrateVaultMetadata,
  trackCleanedDocumentWrite,
} from './metadataMigration.js'
import {
  cleanDocumentFrontmatter,
  exportDocumentFrontmatter,
  previewFrontmatterCleanup,
  restoreDocumentFrontmatter,
} from './frontmatterArchive.js'

// The server is intentionally not in the type-check graph (no tsconfig include),
// but the wire shapes still have to agree with the client. Importing the same
// types that the client uses means there is a single source of truth for the
// JSON contract — and the previous local copy was already drifting (missing
// `summary?: string`), so a shared import also fixes a latent type bug.

const app = new Hono()

let metadataDbOverride: DatabaseT | null = null

/** Test-only injection so temp-vault integration tests never write the user's database. */
export function __setMetadataDbForTesting(db: DatabaseT | null): void {
  metadataDbOverride = db
}

function metadataDb(): DatabaseT {
  return metadataDbOverride ?? getDb()
}

function bad(c: any, msg: string, code = 400) { return c.json({ error: msg }, code) }

async function exists(p: string) {
  try { await fs.stat(p); return true } catch { return false }
}

async function uniqueMoveTarget(absPath: string, relPath: string): Promise<{ abs: string; rel: string }> {
  if (!await exists(absPath)) return { abs: absPath, rel: relPath }
  const ext = path.extname(absPath)
  const absBase = absPath.slice(0, -ext.length)
  const relBase = relPath
  for (let i = 2; i < 1000; i++) {
    const nextAbs = `${absBase}-${i}${ext}`
    if (!await exists(nextAbs)) return { abs: nextAbs, rel: `${relBase}-${i}` }
  }
  const suffix = Date.now()
  return { abs: `${absBase}-${suffix}${ext}`, rel: `${relBase}-${suffix}` }
}

function ensureMetadata(path: string, raw: string, mtimeMs: number, updatedAt = mtimeMs) {
  return ensureDocumentMetadata(metadataDb(), path, raw, mtimeMs, updatedAt)
}

// Vault identity. Used by the client to scope per-vault persistent
// state (tabs, expanded paths, layout). Hashes the absolute content
// dir, so different vault roots in the same browser do not share
// localStorage keys. The hash is short enough to fit in a key and is
// returned via /api/health so the client can fetch it once at mount.
const VAULT_ID = createHash('sha256').update(CONTENT_DIR).digest('hex').slice(0, 12)

app.get('/api/health', (c) => c.json({ ok: true, vaultId: VAULT_ID }))

let activeMetadataMigration: Promise<Awaited<ReturnType<typeof migrateVaultMetadata>>> | null = null

function runMetadataMigration() {
  if (activeMetadataMigration) return activeMetadataMigration
  activeMetadataMigration = migrateVaultMetadata(metadataDb(), CONTENT_DIR)
    .finally(() => { activeMetadataMigration = null })
  return activeMetadataMigration
}

app.get('/api/metadata/migration', (c) => {
  const records = listMetadataMigrationRecords(metadataDb())
  return c.json({
    running: activeMetadataMigration !== null,
    summary: getMetadataMigrationSummary(metadataDb()),
    failures: records.filter((record) => record.status === 'failed'),
    cleanedPaths: records.filter((record) => record.status === 'cleaned').map((record) => record.path),
  })
})

app.post('/api/metadata/migrate', async (c) => {
  const report = await runMetadataMigration()
  return c.json({ report, summary: getMetadataMigrationSummary(metadataDb()) })
})

app.get('/api/metadata/cleanup/preview', async (c) => {
  return c.json(await previewFrontmatterCleanup(metadataDb()))
})

app.get('/api/metadata/export', (c) => {
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

app.post('/api/metadata/cleanup', async (c) => {
  const paths = confirmedPaths(await c.req.json().catch(() => null), 'REMOVE_FRONTMATTER')
  if (!paths) return bad(c, 'explicit confirmation and paths are required')
  return c.json(await cleanDocumentFrontmatter(metadataDb(), paths))
})

app.post('/api/metadata/restore', async (c) => {
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

app.patch('/api/metadata/documents/*', async (c) => {
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
  let aliases = current.aliases
  try {
    if (body.tags !== undefined) tags = stringList(body.tags, 'tags')
    if (body.aliases !== undefined) aliases = stringList(body.aliases, 'aliases')
  } catch (error) {
    return bad(c, (error as Error).message)
  }
  const saved = saveDocumentMetadata(metadataDb(), {
    ...current,
    title,
    summary,
    tags,
    aliases,
    updatedAt: Date.now(),
  })
  try {
    const idx = await getLinkIndex()
    idx.setTitle(documentPath, saved.title)
  } catch { /* next rebuild repairs a stale display title */ }
  return c.json(saved)
})

app.get('/api/tree', async (c) => {
  const tree = await buildTree(CONTENT_DIR, metadataDb())
  return c.json(tree)
})

app.get('/api/posts', async (c) => {
  const posts = await listPostsFlat(CONTENT_DIR, metadataDb())
  return c.json(posts)
})

// Create a new post. Body: { path: string, title?: string }
app.post('/api/posts', async (c) => {
  const body = await c.req.json().catch(() => null) as { path?: unknown; title?: unknown } | null
  if (!body || typeof body.path !== 'string') return bad(c, 'path required')
  if (!isValidPathSyntax(body.path)) {
    return bad(c, 'invalid path syntax')
  }
  if (isInZettel(body.path)) {
    return bad(c, 'zettel notes must be created through archive flow', 422)
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return bad(c, 'title must be a string', 400)
  }
  const rawTitle = body.title ?? body.path.split('/').pop() ?? ''
  const title = rawTitle.trim()
  if (!title) return bad(c, 'title must be a non-empty string', 400)
  if (title.length > 200) return bad(c, 'title must be at most 200 characters', 400)
  let abs: string
  try { abs = filePathFor(body.path) } catch (e: any) { return bad(c, e.message) }
  if (await exists(abs)) return bad(c, 'file exists', 409)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const body_text = `# ${title}\n`
  deleteDocumentMetadata(metadataDb(), body.path)
  await fs.writeFile(abs, body_text, 'utf8')
  try {
    saveDocumentMetadata(metadataDb(), { path: body.path, title, createdAt: now, updatedAt: now })
  } catch (error) {
    await fs.rm(abs, { force: true })
    throw error
  }
  // Update the link index AFTER the disk write succeeds. Best-effort:
  // a failure here just leaves a stale entry; the next rebuild fixes it.
  try {
    const idx = await getLinkIndex()
    idx.applyWrite(body.path, body_text)
    idx.setTitle(body.path, title)
  } catch { /* ignore */ }
  const st = await fs.stat(abs)
  return c.json({
    path: body.path,
    title,
    created: today,
    updated: today,
    tags: [],
    // Newly created files have no summary until metadata editing is added.
    summary: '',
    size: st.size,
    mtime: st.mtimeMs,
  } satisfies PostSummary, 201)
})

// PUT saves body bytes verbatim. Metadata timestamps live in SQLite;
// legacy Frontmatter is preserved but no longer mutated.
app.put('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  let abs: string
  try { abs = filePathFor(splat) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const body = await c.req.json().catch(() => null) as { raw?: string } | null
  if (!body || typeof body.raw !== 'string') return bad(c, 'raw required')
  const previousRaw = await fs.readFile(abs, 'utf8')
  const previousStat = await fs.stat(abs)
  // Import legacy metadata before the editor can remove its Frontmatter.
  ensureMetadata(splat, previousRaw, previousStat.mtimeMs)
  await fs.writeFile(abs, body.raw, 'utf8')
  try {
    const stat = await fs.stat(abs)
    ensureMetadata(splat, body.raw, stat.mtimeMs, Date.now())
    trackCleanedDocumentWrite(metadataDb(), splat, body.raw)
  } catch (error) {
    await fs.writeFile(abs, previousRaw, 'utf8')
    throw error
  }
  try {
    const idx = await getLinkIndex()
    idx.applyWrite(splat, body.raw)
  } catch { /* ignore */ }
  return c.json({ ok: true, raw: body.raw })
})

// PATCH a file: rename within folder (name) or move (targetPath). Exactly one.
app.patch('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  const srcPath = splat
  let src: string
  try { src = filePathFor(srcPath) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(src)) return bad(c, 'not found', 404)

  const body = await c.req.json().catch(() => null) as { name?: string; targetPath?: string; updateReferences?: boolean } | null
  if (!body || (body.name === undefined && body.targetPath === undefined)) {
    return bad(c, 'name or targetPath required')
  }
  if (body.name !== undefined && body.targetPath !== undefined) {
    return bad(c, 'pass exactly one of name / targetPath')
  }

  let dest: string
  let destPath: string
  if (body.name !== undefined) {
    if (!isValidSegment(body.name)) return bad(c, 'invalid name')
    // In-place rename within the same parent. The protocol forbids
    // renaming zettel items, so block this branch server-side too —
    // the client already hides the menu item via canModify, but the
    // API is the backstop for any non-UI caller.
    if (isInZettel(srcPath)) {
      return bad(c, 'zettel notes cannot be renamed', 422)
    }
    const parent = path.dirname(src)
    dest = path.join(parent, body.name + '.md')
    const parentRel = path.dirname(srcPath)
    destPath = parentRel && parentRel !== '.' ? `${parentRel}/${body.name}` : body.name
  } else {
    try { dest = filePathFor(body.targetPath!) } catch (e: any) { return bad(c, e.message) }
    destPath = body.targetPath!
    // Cycle check: cannot move into own descendant.
    if (dest !== src && body.targetPath!.startsWith(srcPath + '/')) {
      return bad(c, 'cannot move into descendant', 422)
    }
    // Zettel movement policy:
    //   - inbox/ and literature/ notes may be archived into zettel/.
    //   - existing zettel notes may move within zettel/ for reclassification.
    //   - zettel notes may not be moved out of zettel/.
    // This mirrors the file-tree UX while keeping the API as the backstop.
    const targetInZettel = isInZettel(destPath)
    const sourceInZettel = isInZettel(srcPath)
    if (sourceInZettel && !targetInZettel) {
      return bad(c, 'zettel notes can only be moved within zettel', 422)
    }
    if (targetInZettel) {
      const sourceArchiveable =
        srcPath === 'inbox' || srcPath.startsWith('inbox/') ||
        srcPath === 'literature' || srcPath.startsWith('literature/') ||
        sourceInZettel
      if (!sourceArchiveable) {
        return bad(c, 'only inbox/ and literature/ notes can be archived to zettel', 422)
      }
    }
  }
  if (await exists(dest)) {
    if (body.targetPath !== undefined && isInZettel(destPath)) {
      const unique = await uniqueMoveTarget(dest, destPath)
      dest = unique.abs
      destPath = unique.rel
    } else {
      return bad(c, 'destination exists', 409)
    }
  }
  const sourceRaw = await fs.readFile(src, 'utf8')
  const sourceStat = await fs.stat(src)
  ensureMetadata(srcPath, sourceRaw, sourceStat.mtimeMs)
  const referenceSnapshots: Array<{
    sourcePath: string
    writePath: string
    abs: string
    raw: string
    updated: string
    metadata: ReturnType<typeof getDocumentMetadata>
  }> = []
  if (body.updateReferences) {
    const idx = await getLinkIndex()
    const allPaths = idx.snapshot().paths
    for (const backlink of idx.getBacklinks(srcPath)) {
      const raw = backlink.source === srcPath ? sourceRaw : await fs.readFile(filePathFor(backlink.source), 'utf8')
      const updated = rewriteDocumentReferences(raw, backlink.source, srcPath, destPath, allPaths)
      if (updated === raw) continue
      const writePath = backlink.source === srcPath ? destPath : backlink.source
      referenceSnapshots.push({
        sourcePath: backlink.source,
        writePath,
        abs: backlink.source === srcPath ? dest : filePathFor(backlink.source),
        raw,
        updated,
        metadata: getDocumentMetadata(metadataDb(), backlink.source),
      })
    }
  }
  await renameDocumentWithMetadata({ db: metadataDb(), fromPath: srcPath, toPath: destPath, fromAbs: src, toAbs: dest })
  const written: typeof referenceSnapshots = []
  try {
    for (const snapshot of referenceSnapshots) {
      await fs.writeFile(snapshot.abs, snapshot.updated, 'utf8')
      const stat = await fs.stat(snapshot.abs)
      ensureMetadata(snapshot.writePath, snapshot.updated, stat.mtimeMs, Date.now())
      written.push(snapshot)
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const snapshot of written.reverse()) {
      try {
        await fs.writeFile(snapshot.abs, snapshot.raw, 'utf8')
        if (snapshot.metadata && snapshot.sourcePath !== srcPath) saveDocumentMetadata(metadataDb(), snapshot.metadata)
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    try {
      await renameDocumentWithMetadata({ db: metadataDb(), fromPath: destPath, toPath: srcPath, fromAbs: dest, toAbs: src })
    } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    const selfSnapshot = referenceSnapshots.find((snapshot) => snapshot.sourcePath === srcPath)
    if (selfSnapshot?.metadata) {
      try { saveDocumentMetadata(metadataDb(), selfSnapshot.metadata) }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'reference update failed and rollback was incomplete')
    throw error
  }
  // Update the link index AFTER the rename succeeds. Read the new
  // content so the new path's outbound links are extracted against
  // the post-rename state of the world.
  const st = await fs.stat(dest)
  const fm = readFrontmatter(dest)
  const movedMetadata = getDocumentMetadata(metadataDb(), destPath)
  try {
    const idx = await getLinkIndex()
    const newRaw = await fs.readFile(dest, 'utf8')
    idx.applyRename(srcPath, destPath, newRaw)
    for (const snapshot of referenceSnapshots) {
      if (snapshot.writePath !== destPath) idx.applyWrite(snapshot.writePath, snapshot.updated)
    }
    if (movedMetadata) idx.setTitle(destPath, movedMetadata.title)
  } catch { /* ignore */ }
  return c.json({
    path: destPath,
    title: movedMetadata?.title ?? destPath.split('/').pop()!,
    created: movedMetadata ? new Date(movedMetadata.createdAt).toISOString().slice(0, 10) : fm.created ?? '',
    // Rename doesn't touch content, so the frontmatter `updated` is
    // unchanged. Fall back to mtime for files that haven't been
    // saved through the API yet (and so don't have the field).
    updated: movedMetadata ? new Date(movedMetadata.updatedAt).toISOString().slice(0, 10) : fm.updated ?? new Date(st.mtimeMs).toISOString().slice(0, 10),
    tags: movedMetadata?.tags ?? fm.tags,
    // Rename/move preserves frontmatter verbatim, so the dest file's
    // summary (if any) is the same as the src's.
    summary: movedMetadata?.summary ?? fm.summary ?? '',
    size: st.size,
    mtime: st.mtimeMs,
    updatedReferences: referenceSnapshots.map((snapshot) => ({
      path: snapshot.writePath,
      raw: snapshot.updated,
    })),
  } satisfies PostSummary)
})

// Delete a file. Zettel items cannot be deleted per protocol; the client
// hides the menu item via canModify but the API is the backstop.
app.delete('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  if (isInZettel(splat)) {
    return bad(c, 'zettel notes cannot be deleted', 422)
  }
  let abs: string
  try { abs = filePathFor(splat) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const staged = `${abs}.docus-delete-${Date.now()}`
  const previousMetadata = getDocumentMetadata(metadataDb(), splat)
  await fs.rename(abs, staged)
  try {
    deleteDocumentMetadata(metadataDb(), splat)
    await fs.unlink(staged)
  } catch (error) {
    if (await exists(staged) && !await exists(abs)) await fs.rename(staged, abs)
    if (previousMetadata && !getDocumentMetadata(metadataDb(), splat)) {
      saveDocumentMetadata(metadataDb(), previousMetadata)
    }
    throw error
  }
  try {
    const idx = await getLinkIndex()
    idx.applyDelete(splat)
  } catch { /* ignore */ }
  return c.json({ ok: true })
})

// Read a single post (raw + frontmatter)
app.get('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  let abs: string
  try { abs = filePathFor(splat) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const raw = await fs.readFile(abs, 'utf8')
  const parsed = matter(raw)
  const st = await fs.stat(abs)
  const metadata = getDocumentMetadata(metadataDb(), splat)
  const compatibleFrontmatter = metadata
    ? {
        ...parsed.data,
        title: metadata.title,
        summary: metadata.summary,
        tags: metadata.tags,
        aliases: metadata.aliases,
        created: new Date(metadata.createdAt).toISOString().slice(0, 10),
        updated: new Date(metadata.updatedAt).toISOString().slice(0, 10),
      }
    : parsed.data
  return c.json({
    path: splat,
    raw,
    content: parsed.content,
    frontmatter: compatibleFrontmatter,
    metadata: metadata ?? undefined,
    size: st.size,
    mtime: st.mtimeMs,
  } satisfies PostDetail)
})

// Create an empty folder. Body: { path: string }
app.post('/api/folders', async (c) => {
  const body = await c.req.json().catch(() => null) as { path?: string } | null
  if (!body || typeof body.path !== 'string') return bad(c, 'path required')
  if (!isValidPathSyntax(body.path)) {
    return bad(c, 'invalid path syntax')
  }
  let abs: string
  try { abs = folderPathFor(body.path) } catch (e: any) { return bad(c, e.message) }
  if (await exists(abs)) return bad(c, 'folder exists', 409)
  await fs.mkdir(abs, { recursive: true })
  return c.json({ path: body.path }, 201)
})

// Rename a folder (single-segment rename, cascades on disk).
app.patch('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const srcPath = splat
  let src: string
  try { src = folderPathFor(srcPath) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(src)) return bad(c, 'not found', 404)

  const body = await c.req.json().catch(() => null) as { newPath?: string } | null
  if (!body || typeof body.newPath !== 'string') return bad(c, 'newPath required')
  const newPath = body.newPath
  // Validate: newPath parent must match srcPath parent, only last segment differs.
  const srcParent = path.dirname(srcPath)
  const newParent = path.dirname(body.newPath)
  if (srcParent !== newParent) return bad(c, 'only single-segment rename allowed', 422)
  let dest: string
  try { dest = folderPathFor(body.newPath) } catch (e: any) { return bad(c, e.message) }
  if (await exists(dest)) return bad(c, 'destination exists', 409)
  const oldPaths = await listSubtreePaths(CONTENT_DIR, srcPath)
  for (const oldPath of oldPaths) {
    const oldAbs = filePathFor(oldPath)
    const [raw, stat] = await Promise.all([fs.readFile(oldAbs, 'utf8'), fs.stat(oldAbs)])
    ensureMetadata(oldPath, raw, stat.mtimeMs)
  }
  deleteDocumentMetadataPrefix(metadataDb(), newPath)
  await fs.rename(src, dest)
  try {
    moveDocumentMetadataPrefix(metadataDb(), srcPath, newPath)
  } catch (error) {
    await fs.rename(dest, src)
    throw error
  }
  // Collect affected file paths for client cache refresh.
  const moved = await listSubtreePaths(CONTENT_DIR, newPath)
  // Update the link index. We need the OLD subtree paths (to apply
  // delete) and the NEW subtree paths + raws (to apply write with
  // the new source-dir for resolution).
  try {
    const idx = await getLinkIndex()
    const pairs = await Promise.all(moved.map(async (movedPath) => {
      const oldPath = srcPath + movedPath.slice(newPath.length)
      const newRaw = await fs.readFile(filePathFor(movedPath), 'utf8')
      return { oldPath, newPath: movedPath, newRaw }
    }))
    // Only cascade files that actually existed in the old subtree.
    const oldSet = new Set(oldPaths)
    idx.applyFolderRename(pairs.filter((p) => oldSet.has(p.oldPath)))
  } catch { /* ignore */ }
  return c.json({ path: body.newPath, moved })
})

// Delete a folder recursively. Requires ?recursive=true if non-empty.
app.delete('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const folderP = splat
  let abs: string
  try { abs = folderPathFor(folderP) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const recursive = c.req.query('recursive') === 'true'
  const all = await listSubtreePaths(CONTENT_DIR, folderP)
  if (all.length > 0 && !recursive) {
    return bad(c, 'folder is not empty; pass ?recursive=true to delete', 400)
  }
  const staged = `${abs}.docus-delete-${Date.now()}`
  const previousMetadata = listDocumentMetadata(metadataDb()).filter(
    (metadata) => metadata.path === folderP || metadata.path.startsWith(`${folderP}/`),
  )
  await fs.rename(abs, staged)
  try {
    deleteDocumentMetadataPrefix(metadataDb(), folderP)
    await fs.rm(staged, { recursive: true, force: true })
  } catch (error) {
    if (await exists(staged) && !await exists(abs)) await fs.rename(staged, abs)
    for (const metadata of previousMetadata) {
      if (!getDocumentMetadata(metadataDb(), metadata.path)) saveDocumentMetadata(metadataDb(), metadata)
    }
    throw error
  }
  try {
    const idx = await getLinkIndex()
    idx.applyFolderDelete(all)
  } catch { /* ignore */ }
  return c.json({ deleted: all })
})

// Link index endpoints. The full snapshot is what the client uses to
// render wiki links (for existence checks) and to power the Links
// panel's outgoing column. Backlinks are computed on demand from the
// forward map.
app.get('/api/links/index', async (c) => {
  const idx = await getLinkIndex()
  return c.json(idx.snapshot())
})

app.get('/api/backlinks', async (c) => {
  const target = c.req.query('path')
  if (!target) return bad(c, 'path required')
  const idx = await getLinkIndex()
  return c.json(idx.getBacklinks(target))
})

app.get('/api/links/rename-impact', async (c) => {
  const target = c.req.query('path')
  if (!target || !isValidPathSyntax(target)) return bad(c, 'valid path required')
  const sources = (await getLinkIndex()).getBacklinks(target).map((record) => record.source)
  return c.json({ path: target, count: sources.length, sources })
})

app.route('/api/ai', aiRoutes)
app.route('/api/history', historyRoutes)
app.route('/api/drafts', draftsRoutes)
app.route('/api/zettel', zettelRoutes)

export default app
