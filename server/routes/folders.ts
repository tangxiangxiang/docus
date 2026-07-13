import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import {
  deleteDocumentMetadataPrefix,
  getDocumentMetadata,
  listDocumentMetadata,
  moveDocumentMetadataPrefix,
  saveDocumentMetadata,
} from '../documentMetadata.js'
import { getIndex as getLinkIndex } from '../linkIndex.js'
import { CONTENT_DIR, filePathFor, folderPathFor, isValidPathSyntax } from '../paths.js'
import { rewriteDocumentReferences } from '../renameReferences.js'
import { listSubtreePaths } from '../tree.js'
import { bad, ensureMetadata, exists, metadataDb } from './shared.js'

const folderRoutes = new Hono()

// Create an empty folder. Body: { path: string }
folderRoutes.post('/api/folders', async (c) => {
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
folderRoutes.patch('/api/folders/*', async (c) => {
  const splat = c.req.path.replace(/^\/api\/folders\//, '')
  const srcPath = splat
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
  let dest: string
  try { dest = folderPathFor(body.newPath) } catch (e: any) { return bad(c, e.message) }
  if (await exists(dest)) return bad(c, 'destination exists', 409)
  const oldPaths = await listSubtreePaths(CONTENT_DIR, srcPath)
  for (const oldPath of oldPaths) {
    const oldAbs = filePathFor(oldPath)
    const [raw, stat] = await Promise.all([fs.readFile(oldAbs, 'utf8'), fs.stat(oldAbs)])
    ensureMetadata(oldPath, raw, stat.mtimeMs)
  }
  const folderReferenceSnapshots: Array<{
    sourcePath: string; writePath: string; raw: string; updated: string
    metadata: ReturnType<typeof getDocumentMetadata>
  }> = []
  if (body.updateReferences) {
    const idx = await getLinkIndex()
    const indexSnapshot = idx.snapshot()
    const moves = oldPaths.map((oldPath) => ({ oldPath, newPath: newPath + oldPath.slice(srcPath.length) }))
    for (const [source, links] of Object.entries(indexSnapshot.outgoing)) {
      if (!links.some((link) => oldPaths.includes(link.target))) continue
      const raw = await fs.readFile(filePathFor(source), 'utf8')
      const sourceStat = await fs.stat(filePathFor(source))
      ensureMetadata(source, raw, sourceStat.mtimeMs)
      const updated = moves.reduce(
        (text, move) => rewriteDocumentReferences(text, source, move.oldPath, move.newPath, indexSnapshot.paths), raw,
      )
      if (updated !== raw) folderReferenceSnapshots.push({
        sourcePath: source,
        writePath: source === srcPath || source.startsWith(srcPath + '/') ? newPath + source.slice(srcPath.length) : source,
        raw,
        updated,
        metadata: getDocumentMetadata(metadataDb(), source),
      })
    }
  }
  deleteDocumentMetadataPrefix(metadataDb(), newPath)
  await fs.rename(src, dest)
  try {
    moveDocumentMetadataPrefix(metadataDb(), srcPath, newPath)
    for (const snapshot of folderReferenceSnapshots) {
      const target = filePathFor(snapshot.writePath)
      await fs.writeFile(target, snapshot.updated, 'utf8')
      const stat = await fs.stat(target)
      ensureMetadata(snapshot.writePath, snapshot.updated, stat.mtimeMs, Date.now())
    }
  } catch (error) {
    const rollbackErrors: unknown[] = []
    for (const snapshot of folderReferenceSnapshots) {
      const target = filePathFor(snapshot.writePath)
      if (await exists(target)) {
        try { await fs.writeFile(target, snapshot.raw, 'utf8') }
        catch (rollbackError) { rollbackErrors.push(rollbackError) }
      }
    }
    try { await fs.rename(dest, src) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    try { moveDocumentMetadataPrefix(metadataDb(), newPath, srcPath) } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    for (const snapshot of folderReferenceSnapshots) {
      if (!snapshot.metadata) continue
      try { saveDocumentMetadata(metadataDb(), snapshot.metadata) }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
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
    updatedReferences: folderReferenceSnapshots.map((snapshot) => ({ path: snapshot.writePath, raw: snapshot.updated })),
  })
})

// Delete a folder recursively. Requires ?recursive=true if non-empty.
folderRoutes.delete('/api/folders/*', async (c) => {
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

export default folderRoutes
