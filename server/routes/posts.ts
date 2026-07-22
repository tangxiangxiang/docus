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
  restoreDocumentMetadataMutation,
  snapshotDocumentMetadataMutation,
} from '../documentMetadata.js'
import { renameDocumentWithMetadata } from '../documentFileLifecycle.js'
import {
  atomicReplaceTextIfUnchanged,
  atomicRemoveTextIfUnchanged,
  prepareAtomicTextCreate,
  prepareAtomicTextWrite,
  readStableTextSnapshot,
  UnstableTextSnapshotError,
  type StableTextSnapshot,
} from '../atomicTextWrite.js'
import { withDocumentWriteLock, withDocumentWriteLocks, withVaultStructureLock } from '../documentWriteLock.js'
import { getIndex as getLinkIndex } from '../linkIndex.js'
import { trackCleanedDocumentWrite } from '../metadataMigration.js'
import { CONTENT_DIR, filePathFor, isValidPathSyntax, isValidSegment } from '../paths.js'
import { rewriteDocumentReferences } from '../renameReferences.js'
import { validateDocumentMutation } from '../documentMutationPolicy.js'
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
  const documentPath = body.path
  if (!isValidPathSyntax(body.path)) {
    return bad(c, 'invalid path syntax')
  }
  try { validateDocumentMutation({ operation: 'create', destinationPath: body.path }) }
  catch (error) { return bad(c, (error as Error).message, 422) }
  if (body.title !== undefined && typeof body.title !== 'string') {
    return bad(c, 'title must be a string', 400)
  }
  const rawTitle = body.title ?? body.path.split('/').pop() ?? ''
  const title = rawTitle.trim()
  if (!title) return bad(c, 'title must be a non-empty string', 400)
  if (title.length > 200) return bad(c, 'title must be at most 200 characters', 400)
  let abs: string
  try { abs = filePathFor(body.path) } catch (e: any) { return bad(c, e.message) }
  // Creating a file changes tree membership: structure lock first, so
  // a concurrent folder rename/delete can never swallow the new file.
  return withVaultStructureLock(() => withDocumentWriteLock(documentPath, async () => {
  if (await exists(abs)) return bad(c, 'file exists', 409)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const body_text = `# ${title}\n`
  const databaseSnapshot = snapshotDocumentMetadataMutation(metadataDb(), [documentPath])
  // Create-only: link(2) atomically fails with EEXIST, so a file an
  // external writer lands between the check and the commit is reported
  // as a conflict, never overwritten.
  const prepared = await prepareAtomicTextCreate(abs, body_text)
  let committed = false
  try {
    deleteDocumentMetadata(metadataDb(), documentPath)
    await prepared.commit()
    committed = true
    saveDocumentMetadata(metadataDb(), { path: documentPath, title, createdAt: now, updatedAt: now })
  } catch (error) {
    const failures: unknown[] = [error]
    try {
      if (committed) {
        if (await exists(abs)) await atomicRemoveTextIfUnchanged(abs, body_text)
      } else {
        await prepared.rollback()
      }
    } catch (rollbackError) { failures.push(rollbackError) }
    try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) } catch (rollbackError) { failures.push(rollbackError) }
    if (failures.length > 1) throw new AggregateError(failures, 'post creation failed and rollback was incomplete')
    if (!committed && (error as NodeJS.ErrnoException).code === 'EEXIST') return bad(c, 'file exists', 409)
    throw error
  }
  // Update the link index AFTER the disk write succeeds. Best-effort:
  // a failure here just leaves a stale entry; the next rebuild fixes it.
  try {
    const idx = await getLinkIndex()
    idx.applyWrite(documentPath, body_text)
    idx.setTitle(documentPath, title)
  } catch { /* ignore */ }
  const st = await fs.stat(abs)
  return c.json({
    path: documentPath,
    title,
    created: today,
    updated: today,
    tags: [],
    // Newly created files have no summary until metadata editing is added.
    summary: '',
    size: st.size,
    mtime: st.mtimeMs,
  } satisfies PostSummary, 201)
  }))
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

    const databaseSnapshot = snapshotDocumentMetadataMutation(metadataDb(), [splat])
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
      restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot)
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
      const failures: unknown[] = [error]
      try {
        await atomicReplaceTextIfUnchanged(
          abs,
          requestedRaw,
          currentRaw,
          { mode: currentStat.mode },
        )
      } catch (rollbackError) {
        failures.push(rollbackError)
      }
      try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
      catch (rollbackError) { failures.push(rollbackError) }
      if (failures.length > 1) throw new AggregateError(failures, 'metadata update failed and document rollback was incomplete')
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
  // Recovery creates the file: membership change, structure lock first.
  return withVaultStructureLock(() => withDocumentWriteLock(documentPath, async () => {
    const abs = filePathFor(documentPath)
    if (await exists(abs)) return bad(c, 'file already exists', 409)
    const databaseSnapshot = snapshotDocumentMetadataMutation(metadataDb(), [documentPath])
    const previousMetadata = getDocumentMetadata(metadataDb(), documentPath)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    const prepared = await prepareAtomicTextCreate(abs, requestedRaw)
    let committed = false
    let stat: Awaited<ReturnType<typeof fs.stat>>
    let metadata: ReturnType<typeof ensureMetadata>
    try {
      await prepared.commit()
      committed = true
      stat = await fs.stat(abs)
      metadata = previousMetadata
        ? { ...previousMetadata, updatedAt: Date.now() }
        : ensureMetadata(documentPath, requestedRaw, stat.mtimeMs, Date.now())
      if (previousMetadata) saveDocumentMetadata(metadataDb(), metadata)
      trackCleanedDocumentWrite(metadataDb(), documentPath, requestedRaw)
    } catch (error) {
      const failures: unknown[] = [error]
      try {
        if (committed) {
          // Our commit landed but the metadata step failed: remove our
          // own write, and ONLY our write — the raw match is proof of
          // ownership because we hold the create-only commit.
          if (await exists(abs)) await atomicRemoveTextIfUnchanged(abs, requestedRaw)
        } else {
          // The commit itself failed (e.g. EEXIST: an external writer
          // landed the same path after our exists-check). We never
          // created the target, so it must not be touched — even when
          // its bytes happen to equal requestedRaw.
          await prepared.rollback()
        }
      } catch (rollbackError) {
        failures.push(rollbackError)
      }
      try {
        restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot)
      } catch (metadataRollbackError) {
        failures.push(metadataRollbackError)
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          'metadata recovery failed and document rollback was incomplete',
        )
      }
      if (!committed && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        return bad(c, 'file already exists', 409)
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
  }))
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
  try {
    validateDocumentMutation({ operation: 'rename', sourcePath: srcPath, destinationPath: destPath })
  } catch (error) {
    return bad(c, (error as Error).message, 422)
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
  // Rename/move changes tree membership: structure lock first, with
  // the backlink plan computed under it (see folders PATCH note).
  return withVaultStructureLock(async () => {
  const plannedReferencePaths = body.updateReferences
    ? (await getLinkIndex()).getBacklinks(srcPath).map((backlink) => backlink.source)
    : []
  return withDocumentWriteLocks([srcPath, destPath, ...plannedReferencePaths], async () => {
  if (!await exists(src)) return bad(c, 'not found', 404)
  if (await exists(dest)) return bad(c, 'destination exists', 409)
  if (body.updateReferences) {
    const candidatePaths = (await getLinkIndex()).getBacklinks(srcPath).map((backlink) => backlink.source)
    const planned = [...new Set(plannedReferencePaths)].sort()
    const candidate = [...new Set(candidatePaths)].sort()
    if (planned.length !== candidate.length || planned.some((item, index) => item !== candidate[index])) {
      return bad(c, 'backlinks changed while rename was being prepared; retry', 409)
    }
  }
  const sourceRaw = await fs.readFile(src, 'utf8')
  const sourceStat = await fs.stat(src)
  const referenceSnapshots: Array<{
    sourcePath: string
    writePath: string
    abs: string
    raw: string
    updated: string
    mtime: number
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
        mtime: 0,
      })
    }
  }
  const databaseSnapshot = snapshotDocumentMetadataMutation(metadataDb(), [srcPath, destPath, ...referenceSnapshots.map((item) => item.writePath)])
  const written: typeof referenceSnapshots = []
  let renamed = false
  try {
    ensureMetadata(srcPath, sourceRaw, sourceStat.mtimeMs)
    for (const reference of referenceSnapshots) {
      if (reference.sourcePath !== srcPath) {
        const stat = await fs.stat(filePathFor(reference.sourcePath))
        ensureMetadata(reference.sourcePath, reference.raw, stat.mtimeMs)
      }
    }
    await renameDocumentWithMetadata({ db: metadataDb(), fromPath: srcPath, toPath: destPath, fromAbs: src, toAbs: dest })
    renamed = true
    for (const snapshot of referenceSnapshots) {
      written.push(snapshot)
      await fs.writeFile(snapshot.abs, snapshot.updated, 'utf8')
      const stat = await fs.stat(snapshot.abs)
      snapshot.mtime = stat.mtimeMs
      ensureMetadata(snapshot.writePath, snapshot.updated, stat.mtimeMs, Date.now())
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const snapshot of written.reverse()) {
      try {
        await fs.writeFile(snapshot.abs, snapshot.raw, 'utf8')
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    if (renamed) {
      try {
        await renameDocumentWithMetadata({ db: metadataDb(), fromPath: destPath, toPath: srcPath, fromAbs: dest, toAbs: src })
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
    catch (rollbackError) { rollbackErrors.push(rollbackError) }
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
  })
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
  // Deleting a file changes tree membership: structure lock first.
  return withVaultStructureLock(() => withDocumentWriteLock(splat, async () => {
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const staged = `${abs}.docus-delete-${Date.now()}`
  const databaseSnapshot = snapshotDocumentMetadataMutation(metadataDb(), [splat])
  await fs.rename(abs, staged)
  try {
    deleteDocumentMetadata(metadataDb(), splat)
    await fs.unlink(staged)
  } catch (error) {
    const failures: unknown[] = [error]
    try {
      if (await exists(staged) && !await exists(abs)) await fs.rename(staged, abs)
    } catch (rollbackError) { failures.push(rollbackError) }
    try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
    catch (rollbackError) { failures.push(rollbackError) }
    if (failures.length > 1) throw new AggregateError(failures, 'post deletion failed and rollback was incomplete')
    throw error
  }
  try {
    const idx = await getLinkIndex()
    idx.applyDelete(splat)
  } catch { /* ignore */ }
  return c.json({ ok: true })
  }))
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
