import { promises as fs } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { Hono } from 'hono'
import { isInArchive } from '../../src/composables/archiveProtocol.js'
import type { PostDetail, PostSummary, SavePostResult } from '../../src/lib/api.js'
import {
  deleteDocumentMetadata,
  getDocumentMetadata,
  saveDocumentMetadata,
} from '../documentMetadata.js'
import { renameDocumentWithMetadata } from '../documentFileLifecycle.js'
import {
  atomicReplaceTextIfUnchanged,
  atomicRemoveTextIfUnchanged,
  prepareAtomicTextWrite,
  readStableTextSnapshot,
  UnstableTextSnapshotError,
  type StableTextSnapshot,
} from '../atomicTextWrite.js'
import { withDocumentWriteLock } from '../documentWriteLock.js'
import { getIndex as getLinkIndex } from '../linkIndex.js'
import { trackCleanedDocumentWrite } from '../metadataMigration.js'
import { CONTENT_DIR, filePathFor, isValidPathSyntax, isValidSegment } from '../paths.js'
import { rewriteDocumentReferences } from '../renameReferences.js'
import { listPostsFlat, readFrontmatter } from '../tree.js'
import { bad, ensureMetadata, exists, metadataDb } from './shared.js'

const postRoutes = new Hono()

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

postRoutes.get('/api/posts', async (c) => {
  const posts = await listPostsFlat(CONTENT_DIR, metadataDb())
  return c.json(posts)
})

// Create a new post. Body: { path: string, title?: string }
postRoutes.post('/api/posts', async (c) => {
  const body = await c.req.json().catch(() => null) as { path?: unknown; title?: unknown } | null
  if (!body || typeof body.path !== 'string') return bad(c, 'path required')
  if (!isValidPathSyntax(body.path)) {
    return bad(c, 'invalid path syntax')
  }
  if (isInArchive(body.path)) {
    return bad(c, 'archive notes must be created through archive flow', 422)
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
postRoutes.put('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  let abs: string
  try { abs = filePathFor(splat) } catch (e: any) { return bad(c, e.message) }
  const body = await c.req.json().catch(() => null) as {
    raw?: unknown
    baseRaw?: unknown
  } | null
  if (!body || typeof body.raw !== 'string' || typeof body.baseRaw !== 'string') {
    return bad(c, 'raw and baseRaw required')
  }
  const requestedRaw = body.raw
  const baseRaw = body.baseRaw

  return withDocumentWriteLock(splat, async () => {
    if (!await exists(abs)) return bad(c, 'not found', 404)

    const conflict = (snapshot: StableTextSnapshot) => c.json({
      error: 'document changed on disk',
      code: 'EDIT_CONFLICT' as const,
      current: {
        raw: snapshot.raw,
        mtime: Number(snapshot.stat.mtimeMs),
        size: Number(snapshot.stat.size),
      },
    }, 409)
    let current: StableTextSnapshot
    try {
      current = await readStableTextSnapshot(abs)
    } catch (error) {
      if (error instanceof UnstableTextSnapshotError) {
        return conflict(error.latest)
      }
      throw error
    }
    const currentRaw = current.raw
    const currentStat = current.stat
    const result = (
      raw: string,
      stat: { size: number | bigint; mtimeMs: number | bigint },
      metadata: ReturnType<typeof ensureMetadata>,
    ) => ({
      ok: true,
      raw,
      post: {
        path: splat,
        title: metadata.title,
        created: new Date(metadata.createdAt).toISOString().slice(0, 10),
        updated: new Date(metadata.updatedAt).toISOString().slice(0, 10),
        tags: [...metadata.tags],
        summary: metadata.summary,
        size: Number(stat.size),
        mtime: Number(stat.mtimeMs),
      },
    } satisfies SavePostResult)

    // A retry whose first response was lost is already durably complete.
    if (currentRaw === requestedRaw) {
      const metadata = ensureMetadata(splat, currentRaw, currentStat.mtimeMs)
      try {
        const idx = await getLinkIndex()
        idx.applyWrite(splat, currentRaw)
      } catch { /* ignore */ }
      return c.json(result(currentRaw, currentStat, metadata))
    }

    if (currentRaw !== baseRaw) {
      return conflict(current)
    }

    const prepared = await prepareAtomicTextWrite(abs, requestedRaw, { mode: currentStat.mode })
    try {
      // Re-check after preparing the complete temporary file so a change
      // observed in that window is never knowingly overwritten.
      const verified = await readStableTextSnapshot(abs)
      if (verified.raw !== currentRaw) {
        await prepared.rollback()
        return conflict(verified)
      }

      // Import legacy metadata before the editor can remove its Frontmatter.
      ensureMetadata(splat, currentRaw, currentStat.mtimeMs)
      await prepared.commit()
    } catch (error) {
      await prepared.rollback()
      if (error instanceof UnstableTextSnapshotError) {
        return conflict(error.latest)
      }
      throw error
    }

    let stat: Awaited<ReturnType<typeof fs.stat>>
    let metadata: ReturnType<typeof ensureMetadata>
    try {
      stat = await fs.stat(abs)
      metadata = ensureMetadata(splat, requestedRaw, stat.mtimeMs, Date.now())
      trackCleanedDocumentWrite(metadataDb(), splat, requestedRaw)
    } catch (error) {
      try {
        await atomicReplaceTextIfUnchanged(
          abs,
          requestedRaw,
          currentRaw,
          { mode: currentStat.mode },
        )
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'metadata update failed and document rollback was incomplete',
        )
      }
      throw error
    }
    try {
      const idx = await getLinkIndex()
      idx.applyWrite(splat, requestedRaw)
    } catch { /* ignore */ }
    return c.json(result(requestedRaw, stat, metadata))
  })
})

postRoutes.put('/api/recover/*', async (c) => {
  const documentPath = c.req.path.replace(/^\/api\/recover\//, '')
  if (!isValidPathSyntax(documentPath)) return bad(c, 'invalid path')
  const body = await c.req.json().catch(() => null) as { raw?: unknown } | null
  if (!body || typeof body.raw !== 'string') return bad(c, 'raw required')
  const requestedRaw = body.raw
  return withDocumentWriteLock(documentPath, async () => {
    const abs = filePathFor(documentPath)
    if (await exists(abs)) return bad(c, 'file already exists', 409)
    const previousMetadata = getDocumentMetadata(metadataDb(), documentPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, requestedRaw, { encoding: 'utf8', flag: 'wx' })
    let stat: Awaited<ReturnType<typeof fs.stat>>
    let metadata: ReturnType<typeof ensureMetadata>
    try {
      stat = await fs.stat(abs)
      metadata = previousMetadata
        ? { ...previousMetadata, updatedAt: Date.now() }
        : ensureMetadata(documentPath, requestedRaw, stat.mtimeMs, Date.now())
      if (previousMetadata) saveDocumentMetadata(metadataDb(), metadata)
      trackCleanedDocumentWrite(metadataDb(), documentPath, requestedRaw)
    } catch (error) {
      const failures: unknown[] = [error]
      try {
        await atomicRemoveTextIfUnchanged(abs, requestedRaw)
      } catch (rollbackError) {
        failures.push(rollbackError)
      }
      try {
        if (previousMetadata) saveDocumentMetadata(metadataDb(), previousMetadata)
        else deleteDocumentMetadata(metadataDb(), documentPath)
      } catch (metadataRollbackError) {
        failures.push(metadataRollbackError)
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          'metadata recovery failed and document rollback was incomplete',
        )
      }
      throw error
    }
    try { (await getLinkIndex()).applyWrite(documentPath, requestedRaw) } catch { /* next rebuild repairs it */ }
    const post: PostSummary = {
      path: documentPath,
      title: metadata.title,
      created: new Date(metadata.createdAt).toISOString().slice(0, 10),
      updated: new Date(metadata.updatedAt).toISOString().slice(0, 10),
      tags: [...metadata.tags],
      summary: metadata.summary,
      size: stat.size,
      mtime: stat.mtimeMs,
    }
    return c.json({ ok: true, raw: requestedRaw, mtime: stat.mtimeMs, post })
  })
})

// PATCH a file: rename within folder (name) or move (targetPath). Exactly one.
postRoutes.patch('/api/posts/*', async (c) => {
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
    // renaming archive items, so block this branch server-side too —
    // the client already hides the menu item via canModify, but the
    // API is the backstop for any non-UI caller.
    if (isInArchive(srcPath)) {
      return bad(c, 'archive notes cannot be renamed', 422)
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
    // Archive movement policy:
    //   - inbox/ and literature/ notes may be archived into archive/.
    //   - existing archive notes may move within archive/ for reclassification.
    //   - archive notes may not be moved out of archive/.
    // This mirrors the file-tree UX while keeping the API as the backstop.
    const targetInArchive = isInArchive(destPath)
    const sourceInArchive = isInArchive(srcPath)
    if (sourceInArchive && !targetInArchive) {
      return bad(c, 'archive notes can only be moved within archive', 422)
    }
    if (targetInArchive) {
      const sourceArchiveable =
        srcPath === 'inbox' || srcPath.startsWith('inbox/') ||
        srcPath === 'literature' || srcPath.startsWith('literature/') ||
        sourceInArchive
      if (!sourceArchiveable) {
        return bad(c, 'only inbox/ and literature/ notes can be archived to archive', 422)
      }
    }
  }
  if (await exists(dest)) {
    if (body.targetPath !== undefined && isInArchive(destPath)) {
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
    mtime: number
    metadata: ReturnType<typeof getDocumentMetadata>
  }> = []
  if (body.updateReferences) {
    const idx = await getLinkIndex()
    const allPaths = idx.snapshot().paths
    for (const backlink of idx.getBacklinks(srcPath)) {
      const raw = backlink.source === srcPath ? sourceRaw : await fs.readFile(filePathFor(backlink.source), 'utf8')
      if (backlink.source !== srcPath) {
        const stat = await fs.stat(filePathFor(backlink.source))
        ensureMetadata(backlink.source, raw, stat.mtimeMs)
      }
      const updated = rewriteDocumentReferences(raw, backlink.source, srcPath, destPath, allPaths)
      if (updated === raw) continue
      const writePath = backlink.source === srcPath ? destPath : backlink.source
      referenceSnapshots.push({
        sourcePath: backlink.source,
        writePath,
        abs: backlink.source === srcPath ? dest : filePathFor(backlink.source),
        raw,
        updated,
        mtime: 0,
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
      snapshot.mtime = stat.mtimeMs
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
      mtime: snapshot.mtime,
    })),
  } satisfies PostSummary)
})

// Delete a file. Archive items cannot be deleted per protocol; the client
// hides the menu item via canModify but the API is the backstop.
postRoutes.delete('/api/posts/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/posts\//, '')
  if (isInArchive(splat)) {
    return bad(c, 'archive notes cannot be deleted', 422)
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
postRoutes.get('/api/posts/*', async (c) => {
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

export default postRoutes
