import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { canModify } from '../../src/composables/archiveProtocol.js'
import {
  deleteDocumentMetadataPrefix,
  moveDocumentMetadataPrefix,
  restoreDocumentMetadataMutation,
  snapshotDocumentMetadataPrefixMutation,
} from '../documentMetadata.js'
import { withDocumentWriteLock, withDocumentWriteLocks, withVaultStructureLock } from '../documentWriteLock.js'
import { getIndex as getLinkIndex } from '../linkIndex.js'
import { CONTENT_DIR, filePathFor, folderPathFor, isValidPathSyntax } from '../paths.js'
import { rewriteDocumentReferences } from '../renameReferences.js'
import { listSubtreePaths } from '../tree.js'
import { bad, ensureMetadata, exists, metadataDb } from './shared.js'

const folderRoutes = new Hono()

/**
 * Test-only seam for the folder lifecycle race regressions: fires
 * inside the structure + document locks, immediately after the
 * in-lock subtree re-validation and before any side effect — the
 * exact window in which a concurrent membership operation would have
 * to be absorbed. Null in production (never set outside tests).
 */
export type FolderRaceHooks = {
  afterRenameRecheck?: () => void | Promise<void>
  afterDeleteRecheck?: () => void | Promise<void>
}
let __folderRaceHooks: FolderRaceHooks | null = null
export function __setFolderRaceHooksForTesting(hooks: FolderRaceHooks | null): void {
  __folderRaceHooks = hooks
}

// Create an empty folder. Body: { path: string }
folderRoutes.post('/api/folders', async (c) => {
  const body = await c.req.json().catch(() => null) as { path?: string } | null
  if (!body || typeof body.path !== 'string') return bad(c, 'path required')
  if (!isValidPathSyntax(body.path)) {
    return bad(c, 'invalid path syntax')
  }
  let abs: string
  try { abs = folderPathFor(body.path) } catch (e: any) { return bad(c, e.message) }
  // Creating a folder changes tree membership: structure lock first.
  const createdPath = body.path
  return withVaultStructureLock(() => withDocumentWriteLock(createdPath, async () => {
    if (await exists(abs)) return bad(c, 'folder exists', 409)
    await fs.mkdir(abs, { recursive: true })
    return c.json({ path: createdPath }, 201)
  }))
})

// Rename a folder (single-segment rename, cascades on disk).
folderRoutes.patch('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const srcPath = splat
  if (!canModify(srcPath)) return bad(c, 'protected folders cannot be renamed', 422)
  let src: string
  try { src = folderPathFor(srcPath) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(src)) return bad(c, 'not found', 404)

  const body = await c.req.json().catch(() => null) as { newPath?: string; updateReferences?: boolean } | null
  if (!body || typeof body.newPath !== 'string') return bad(c, 'newPath required')
  const newPath = body.newPath
  // Validate: newPath parent must match srcPath parent, only last segment differs.
  const srcParent = path.dirname(srcPath)
  const newParent = path.dirname(body.newPath)
  if (srcParent !== newParent) return bad(c, 'only single-segment rename allowed', 422)
  if (!canModify(newPath)) return bad(c, 'cannot rename a folder to a protected path', 422)
  let dest: string
  try { dest = folderPathFor(body.newPath) } catch (e: any) { return bad(c, e.message) }
  // Tree membership changes serialize behind the vault structure lock.
  // The subtree/backlink/database planning happens UNDER it, so the
  // document lock footprint is acquired against a membership-stable
  // world — a concurrent create/delete/rename on any path waits for
  // the whole transaction instead of slipping a new child in between
  // the enumeration and the lock acquisition.
  return withVaultStructureLock(async () => {
  const plannedOldPaths = await listSubtreePaths(CONTENT_DIR, srcPath)
  const plannedReferencePaths = body.updateReferences
    ? Object.entries((await getLinkIndex()).snapshot().outgoing)
      .filter(([, links]) => links.some((link) => plannedOldPaths.includes(link.target)))
      .map(([source]) => source)
    : []
  const plannedNewPaths = plannedOldPaths.map((oldPath) => newPath + oldPath.slice(srcPath.length))
  const plannedReferenceWritePaths = plannedReferencePaths.map((source) =>
    source === srcPath || source.startsWith(`${srcPath}/`) ? newPath + source.slice(srcPath.length) : source,
  )
  const plannedDatabasePaths = snapshotDocumentMetadataPrefixMutation(
    metadataDb(), [srcPath, newPath], [
      ...plannedOldPaths, ...plannedNewPaths, ...plannedReferencePaths, ...plannedReferenceWritePaths,
    ],
  ).paths
  return withDocumentWriteLocks([
    srcPath, newPath, ...plannedOldPaths, ...plannedNewPaths,
    ...plannedReferencePaths, ...plannedDatabasePaths,
  ], async () => {
  if (!await exists(src)) return bad(c, 'not found', 404)
  if (await exists(dest)) return bad(c, 'destination exists', 409)
  const oldPaths = await listSubtreePaths(CONTENT_DIR, srcPath)
  if (oldPaths.join('\0') !== plannedOldPaths.join('\0')) {
    return bad(c, 'folder contents changed while rename was being prepared; retry', 409)
  }
  if (__folderRaceHooks?.afterRenameRecheck) await __folderRaceHooks.afterRenameRecheck()
  const folderReferenceSnapshots: Array<{
    sourcePath: string; writePath: string; raw: string; updated: string
    mtime: number
  }> = []
  if (body.updateReferences) {
    const idx = await getLinkIndex()
    const indexSnapshot = idx.snapshot()
    const moves = oldPaths.map((oldPath) => ({ oldPath, newPath: newPath + oldPath.slice(srcPath.length) }))
    for (const [source, links] of Object.entries(indexSnapshot.outgoing)) {
      if (!links.some((link) => oldPaths.includes(link.target))) continue
      const raw = await fs.readFile(filePathFor(source), 'utf8')
      const updated = moves.reduce(
        (text, move) => rewriteDocumentReferences(text, source, move.oldPath, move.newPath, indexSnapshot.paths), raw,
      )
      if (updated !== raw) folderReferenceSnapshots.push({
        sourcePath: source,
        writePath: source === srcPath || source.startsWith(srcPath + '/') ? newPath + source.slice(srcPath.length) : source,
        raw,
        updated,
        mtime: 0,
      })
    }
    const actualReferences = folderReferenceSnapshots.map((item) => item.sourcePath).sort()
    const plannedReferences = [...new Set(plannedReferencePaths)].sort()
    if (actualReferences.join('\0') !== plannedReferences.join('\0')) {
      return bad(c, 'backlinks changed while rename was being prepared; retry', 409)
    }
  }
  const databaseSnapshot = snapshotDocumentMetadataPrefixMutation(
    metadataDb(), [srcPath, newPath], [
      ...oldPaths,
      ...oldPaths.map((oldPath) => newPath + oldPath.slice(srcPath.length)),
      ...folderReferenceSnapshots.flatMap((item) => [item.sourcePath, item.writePath]),
    ],
  )
  const currentDatabasePaths = [...databaseSnapshot.paths].sort()
  const lockedDatabasePaths = [...new Set(plannedDatabasePaths)].sort()
  if (currentDatabasePaths.join('\0') !== lockedDatabasePaths.join('\0')) {
    return bad(c, 'folder metadata changed while rename was being prepared; retry', 409)
  }
  const written: typeof folderReferenceSnapshots = []
  let renamed = false
  try {
    for (const oldPath of oldPaths) {
      const oldAbs = filePathFor(oldPath)
      const [raw, stat] = await Promise.all([fs.readFile(oldAbs, 'utf8'), fs.stat(oldAbs)])
      ensureMetadata(oldPath, raw, stat.mtimeMs)
    }
    for (const snapshot of folderReferenceSnapshots) {
      if (!oldPaths.includes(snapshot.sourcePath)) {
        const sourceStat = await fs.stat(filePathFor(snapshot.sourcePath))
        ensureMetadata(snapshot.sourcePath, snapshot.raw, sourceStat.mtimeMs)
      }
    }
    deleteDocumentMetadataPrefix(metadataDb(), newPath)
    await fs.rename(src, dest)
    renamed = true
    moveDocumentMetadataPrefix(metadataDb(), srcPath, newPath)
    for (const snapshot of folderReferenceSnapshots) {
      const target = filePathFor(snapshot.writePath)
      written.push(snapshot)
      await fs.writeFile(target, snapshot.updated, 'utf8')
      const stat = await fs.stat(target)
      snapshot.mtime = stat.mtimeMs
      ensureMetadata(snapshot.writePath, snapshot.updated, stat.mtimeMs, Date.now())
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const snapshot of written.reverse()) {
      const target = filePathFor(snapshot.writePath)
      if (await exists(target)) {
        try { await fs.writeFile(target, snapshot.raw, 'utf8') }
        catch (rollbackError) { rollbackErrors.push(rollbackError) }
      }
    }
    if (renamed) try { await fs.rename(dest, src) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
    catch (rollbackError) { rollbackErrors.push(rollbackError) }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'folder rename failed and rollback was incomplete')
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
    for (const snapshot of folderReferenceSnapshots) {
      if (!snapshot.writePath.startsWith(newPath + '/')) idx.applyWrite(snapshot.writePath, snapshot.updated)
    }
  } catch { /* ignore */ }
  return c.json({
    path: body.newPath,
    moved,
    updatedReferences: folderReferenceSnapshots.map((snapshot) => ({
      path: snapshot.writePath,
      raw: snapshot.updated,
      mtime: snapshot.mtime,
    })),
  })
  })
  })
})

// Delete a folder recursively. Requires ?recursive=true if non-empty.
folderRoutes.delete('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const folderP = splat
  if (!canModify(folderP)) return bad(c, 'protected folders cannot be deleted', 422)
  let abs: string
  try { abs = folderPathFor(folderP) } catch (e: any) { return bad(c, e.message) }
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const recursive = c.req.query('recursive') === 'true'
  // Tree membership changes serialize behind the vault structure lock;
  // the subtree is planned under it so the lock footprint covers a
  // membership-stable world (see the rename route for the full note).
  return withVaultStructureLock(async () => {
  const planned = await listSubtreePaths(CONTENT_DIR, folderP)
  const plannedDatabasePaths = snapshotDocumentMetadataPrefixMutation(metadataDb(), [folderP], planned).paths
  return withDocumentWriteLocks([folderP, ...planned, ...plannedDatabasePaths], async () => {
  if (!await exists(abs)) return bad(c, 'not found', 404)
  const all = await listSubtreePaths(CONTENT_DIR, folderP)
  if (all.join('\0') !== planned.join('\0')) return bad(c, 'folder contents changed while delete was being prepared; retry', 409)
  if (__folderRaceHooks?.afterDeleteRecheck) await __folderRaceHooks.afterDeleteRecheck()
  if (all.length > 0 && !recursive) {
    return bad(c, 'folder is not empty; pass ?recursive=true to delete', 400)
  }
  const staged = `${abs}.docus-delete-${Date.now()}`
  const databaseSnapshot = snapshotDocumentMetadataPrefixMutation(metadataDb(), [folderP], all)
  await fs.rename(abs, staged)
  try {
    deleteDocumentMetadataPrefix(metadataDb(), folderP)
    await fs.rm(staged, { recursive: true, force: true })
  } catch (error) {
    const rollbackErrors: unknown[] = []
    if (await exists(staged) && !await exists(abs)) {
      try { await fs.rename(staged, abs) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
    catch (rollbackError) { rollbackErrors.push(rollbackError) }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'folder delete failed and rollback was incomplete')
    throw error
  }
  try {
    const idx = await getLinkIndex()
    idx.applyFolderDelete(all)
  } catch { /* ignore */ }
  return c.json({ deleted: all })
  })
  })
})

export default folderRoutes
