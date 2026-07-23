import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { canModify } from '../../src/composables/archiveProtocol.js'
import { AtomicTextWriteConflictError, atomicReplaceTextIfUnchanged, removeDurableJournal, rewriteDurableJournal, sha256Hex, syncParentDirectoryBestEffort, writeDurableJournal } from '../atomicTextWrite.js'
import {
  deleteDocumentMetadata,
  deleteDocumentMetadataPrefix,
  getDocumentMetadata,
  moveDocumentMetadataPrefix,
  restoreDocumentMetadataMutation,
  snapshotDocumentMetadataPrefixMutation,
} from '../documentMetadata.js'
import {
  executeFolderMove,
  resolveDirectoryMoveStrategy,
  RenameDestinationOccupiedError,
  RenameSourceReusedError,
  UnsupportedDirectoryMoveError,
  type FolderMoveJournalStrategy,
} from '../documentFileLifecycle.js'
import { generateGateTokenSecret, listPhysicalMoveEntries, serializeMetadataSnapshot, type FolderMoveJournalEntry } from '../folderMoveTransaction.js'
import { withDocumentWriteLock, withDocumentWriteLocks, withVaultStructureLock } from '../documentWriteLock.js'
import { getIndex as getLinkIndex } from '../linkIndex.js'
import { prepareRenameReferenceJournal, type PreparedRenameReferenceJournal } from '../renameReferenceJournal.js'
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
 * to be absorbed. `afterRenamePlanBuilt` fires after the reference
 * snapshots and every footprint check are complete, immediately
 * before the reference write loop — the exact window in which an
 * EXTERNAL editor's save to a reference file must be detected by the
 * ownership-verified reference writes. Null in production (never set
 * outside tests).
 */
export type FolderRaceHooks = {
  afterRenameRecheck?: () => void | Promise<void>
  afterRenamePlanBuilt?: () => void | Promise<void>
  afterDeleteRecheck?: () => void | Promise<void>
  /** Fires after a folder rename's rollback move restored the tree,
   * BEFORE the metadata snapshot is re-installed — the kill point
   * "all files back, metadata pending". */
  afterRollbackMove?: () => void | Promise<void>
  /** Fault injection for crash children (no vi.spyOn in a spawned
   * child): fail the staged-tree removal so the delete route takes
   * its rollback path. */
  failDeleteRemoval?: boolean
  /** Fault injection: fail the rollback journal direction flip, to
   * prove the replayable reverse move refuses to start without its
   * durable journal (round-8 P1). */
  failJournalFlip?: boolean
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
  let journalPath: string | null = null
  // The persisted folder-move journal payload — kept in scope for the
  // rollback, which durably flips its direction before reversing the
  // tree (and flips it back if the source was re-used).
  let folderMoveJournal: {
    version: 3
    op: 'folder-rename'
    srcRel: string
    destRel: string
    sourceDev: number
    sourceIno: number
    strategy: FolderMoveJournalStrategy
    emptyTree?: boolean
    entries: FolderMoveJournalEntry[]
    directories: string[]
    gateToken: string
    metadataDisposition: { kind: 'prefix-move' }
  } | null = null
  let physicalEntryRels: string[] = []
  let physicalDirectories: string[] = []
  let journalUuid = ''
  let referenceJournal: PreparedRenameReferenceJournal | null = null
  // Replayable moves (the Windows protocol) can crash mid-flight with
  // the tree split between source and destination: a thrown move may
  // have left journaled entries at the destination, so the journal
  // must survive for startup recovery even though `renamed` is false.
  let moveThrew = false
  const moveStrategy = resolveDirectoryMoveStrategy()
  try {
    const sourceHashes = new Map<string, string>()
    for (const oldPath of oldPaths) {
      const oldAbs = filePathFor(oldPath)
      const [raw, stat] = await Promise.all([fs.readFile(oldAbs, 'utf8'), fs.stat(oldAbs)])
      ensureMetadata(oldPath, raw, stat.mtimeMs)
      sourceHashes.set(oldPath, sha256Hex(raw))
    }
    for (const snapshot of folderReferenceSnapshots) {
      if (!oldPaths.includes(snapshot.sourcePath)) {
        const sourceStat = await fs.stat(filePathFor(snapshot.sourcePath))
        ensureMetadata(snapshot.sourcePath, snapshot.raw, sourceStat.mtimeMs)
      }
    }
    referenceJournal = await prepareRenameReferenceJournal({
      sourceAbs: src,
      op: 'folder-rename-references',
      srcRel: srcPath,
      destRel: newPath,
      identities: oldPaths.map((oldPath) => {
        const identity = getDocumentMetadata(metadataDb(), oldPath)
        if (!identity) throw new Error(`source document identity was not created: ${oldPath}`)
        const sourceHash = sourceHashes.get(oldPath)
        if (!sourceHash) throw new Error(`source document hash was not captured: ${oldPath}`)
        return { path: oldPath, id: identity.id, sourceHash }
      }),
      references: folderReferenceSnapshots.map((snapshot) => ({
        path: snapshot.writePath,
        beforeRaw: snapshot.raw,
        afterRaw: snapshot.updated,
      })),
    })
    // Physical entries: the journal must describe EVERY file the move
    // touches — markdown AND attachments — or a crash mid-move would
    // strand unjournaled files with no reconciliation proof (the mover
    // moves all regular files; the journal is the authority recovery
    // replays). Identities ride along for the markdown documents only.
    // Directories (including empty ones) are journaled too so the move
    // recreates the full visible tree shape (round-8 P1).
    const physical = await listPhysicalMoveEntries(src, (relativeFilePath) => {
      if (!relativeFilePath.endsWith('.md')) return null
      const documentPath = `${srcPath}/${relativeFilePath.slice(0, -'.md'.length)}`
      const identity = getDocumentMetadata(metadataDb(), documentPath)
      return identity ? { documentId: identity.id, documentPath } : null
    })
    const physicalEntries: FolderMoveJournalEntry[] = physical.entries
    physicalDirectories = physical.directories
    // DURABLE JOURNAL before the move: if the process dies between the
    // directory move and the metadata move, startup crash recovery
    // (server/crashRecovery.ts) reads it and completes the metadata
    // move before the HTTP server accepts requests. Removed LAST.
    const sourceDirectoryStat = await fs.stat(src)
    journalUuid = randomUUID()
    const gateTokenSecret = generateGateTokenSecret()
    folderMoveJournal = {
      version: 3,
      op: 'folder-rename',
      srcRel: srcPath,
      destRel: newPath,
      sourceDev: sourceDirectoryStat.dev,
      sourceIno: sourceDirectoryStat.ino,
      strategy: moveStrategy,
      ...(physicalEntries.length === 0 ? { emptyTree: true } : {}),
      entries: physicalEntries,
      directories: physicalDirectories,
      gateToken: gateTokenSecret,
      metadataDisposition: { kind: 'prefix-move' },
    }
    journalPath = path.join(path.dirname(src), `.${path.basename(src)}.docus-journal-${journalUuid}`)
    await writeDurableJournal(journalPath, folderMoveJournal)
    deleteDocumentMetadataPrefix(metadataDb(), newPath)
    // Create-only: mkdir is the gate — an external writer claiming the
    // destination after the earlier exists() check fails the move
    // closed (restored: false) instead of being replaced by rename(2).
    // On Windows (rename(2) cannot replace a directory there) the
    // replayable per-file protocol runs under this same journal. The
    // gate token (= the journal uuid) lets recovery tell its own gate
    // from an externally-created empty directory.
    physicalEntryRels = physicalEntries.map((entry) => entry.relativeFilePath)
    let moved: { restored: boolean }
    try {
      moved = await executeFolderMove(moveStrategy, src, dest, physicalEntryRels, {
        directories: physicalDirectories,
        gateToken: journalUuid,
        gateTokenContent: gateTokenSecret,
        entries: physicalEntries,
        vaultRoot: CONTENT_DIR,
      })
    } catch (moveError) {
      moveThrew = true
      throw moveError
    }
    if (!moved.restored) {
      await removeDurableJournal(journalPath).catch(() => {})
      return bad(c, 'destination was claimed by an external writer during the move; retry', 409)
    }
    renamed = true
    moveDocumentMetadataPrefix(metadataDb(), srcPath, newPath)
    await removeDurableJournal(journalPath).catch(() => {})
    if (__folderRaceHooks?.afterRenamePlanBuilt) await __folderRaceHooks.afterRenamePlanBuilt()
    for (const snapshot of folderReferenceSnapshots) {
      const target = filePathFor(snapshot.writePath)
      // External-writer-safe: the bytes on disk must still be exactly
      // what the in-lock plan read. In-process locks do not stop
      // Obsidian/vim/sync software; the ownership-verified commit
      // detects their saves and fails the rename closed instead of
      // silently overwriting them.
      await atomicReplaceTextIfUnchanged(target, snapshot.raw, snapshot.updated)
      written.push(snapshot)
      const stat = await fs.stat(target)
      snapshot.mtime = stat.mtimeMs
      ensureMetadata(snapshot.writePath, snapshot.updated, stat.mtimeMs, Date.now())
    }
    await referenceJournal?.cleanup()
    referenceJournal = null
  } catch (error) {
    const rollbackErrors: unknown[] = []
    let rollbackSourceReused = false
    let rolledTreeBack = !renamed
    if (referenceJournal) {
      try { await referenceJournal.setDirection('roll-back') }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    for (const snapshot of written.reverse()) {
      const target = filePathFor(snapshot.writePath)
      if (await exists(target)) {
        try {
          // Undo ONLY our rewrite: an external save on top of it wins
          // and the undo leaves those bytes untouched.
          await atomicReplaceTextIfUnchanged(target, snapshot.updated, snapshot.raw)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
    }
    if (renamed) {
      // DURABLE direction flip BEFORE the first reverse file moves:
      // the journal now describes the rollback (newPath → srcPath), so
      // a crash at ANY point mid-rollback replays forward to the
      // source from the journal — no split tree is ever left without
      // a journal that describes it (round-7 P1: the reverse move was
      // journal-less, and a mid-rollback crash stranded a split tree
      // neither journal direction could reconcile). Same-parent
      // renames share a directory, so the journal's physical name
      // stays provenance-valid for both directions.
      //
      // For the REPLAYABLE protocol the flip is a HARD precondition
      // (round-8 P1): a per-file reverse move without a durable journal
      // re-opens the split-tree-without-transaction hole if it crashes
      // mid-move. If the flip cannot be persisted (ENOSPC/EIO/perm),
      // NOT ONE file moves — the tree + metadata stay at the
      // destination (forward-consistent) and the forward journal +
      // reference journal are preserved so recovery completes forward.
      // The ATOMIC move is a single rename — never split — so it may
      // proceed even if the flip cannot be persisted.
      const flipIsRequired = moveStrategy === 'replayable-move'
      let flipSucceeded = false
      if (journalPath && folderMoveJournal) {
        try {
          if (__folderRaceHooks?.failJournalFlip) throw new Error('injected journal flip failure')
          await rewriteDurableJournal(journalPath, { ...folderMoveJournal, srcRel: newPath, destRel: srcPath })
          flipSucceeded = true
        } catch (rollbackError) { rollbackErrors.push(rollbackError) }
      }
      if (flipSucceeded || !flipIsRequired) {
        try {
          // Create-only: if an external writer re-used the source folder
          // while the reference writes were failing, the rollback fails
          // closed (restored: false) and the tree stays at the
          // destination — never replacing the external folder.
          const rolledBack = await executeFolderMove(moveStrategy, dest, src, physicalEntryRels, {
            directories: physicalDirectories,
            gateToken: journalUuid,
            gateTokenContent: folderMoveJournal!.gateToken,
            entries: folderMoveJournal!.entries,
            vaultRoot: CONTENT_DIR,
          })
          if (rolledBack.restored) {
            rolledTreeBack = true
            if (__folderRaceHooks?.afterRollbackMove) await __folderRaceHooks.afterRollbackMove()
          } else {
            rollbackSourceReused = true
          }
        } catch (rollbackError) { rollbackErrors.push(rollbackError) }
      } else {
        // Replayable reverse move without a durable journal: refuse to
        // move a single file (see above).
        rollbackSourceReused = true
      }
    }
    if (!rollbackSourceReused) {
      try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
    } else if (journalPath && folderMoveJournal) {
      // The tree stays at newPath: flip the journal back to the
      // forward direction FIRST, so a crash right here leaves a
      // journal whose recovery completes the metadata move to newPath
      // — never one that would bind identities to the externally
      // re-used source. The rows are already at newPath from the
      // forward move (the snapshot restore was skipped above).
      try { await rewriteDurableJournal(journalPath, folderMoveJournal) }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    // Journal cleanup: removable once the tree is known to be back at
    // src (or was never moved) — the journal is then unambiguously
    // stale. If the tree stayed at dest (rollback failed, or the
    // source was re-used), KEEP it: should a crash interrupt this
    // rollback, startup recovery reads it and completes the metadata
    // move to dest instead of binding identities to a missing tree.
    // A thrown replayable move may have left journaled entries at the
    // destination: keep the journal so startup recovery replays them
    // (it removes the journal itself when the tree is provably at the
    // source).
    if (rolledTreeBack && journalPath && !moveThrew) await removeDurableJournal(journalPath).catch(() => {})
    if (rollbackSourceReused) {
      // Identity follows the bytes: the tree is at newPath. Move every
      // restored row under srcPath back under newPath (or drop them if
      // the destination vanished too, so no identity ever binds to a
      // missing tree).
      try {
        if (await exists(dest)) moveDocumentMetadataPrefix(metadataDb(), srcPath, newPath)
        else deleteDocumentMetadataPrefix(metadataDb(), srcPath)
        const idx = await getLinkIndex()
        const pairs = await Promise.all(oldPaths.map(async (oldPath) => {
          const movedPath = newPath + oldPath.slice(srcPath.length)
          const newRaw = await fs.readFile(filePathFor(movedPath), 'utf8')
          return { oldPath, newPath: movedPath, newRaw }
        }))
        idx.applyFolderRename(pairs)
      } catch { /* best effort: the next index rebuild re-derives paths */ }
    }
    if (referenceJournal) {
      try {
        if (rollbackSourceReused) await referenceJournal.setDirection('roll-forward')
        else if (rolledTreeBack && !rollbackErrors.length) { await referenceJournal.cleanup(); referenceJournal = null }
      } catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'folder rename failed and rollback was incomplete')
    if (error instanceof UnsupportedDirectoryMoveError) {
      return bad(c, 'this filesystem does not support the create-only folder move (hard links); the folder was not renamed', 501)
    }
    const moveErrorCode = (error as NodeJS.ErrnoException).code
    if (moveErrorCode === 'EPERM' || moveErrorCode === 'EOPNOTSUPP' || moveErrorCode === 'ENOTSUP') {
      return bad(c, 'this filesystem does not support the create-only folder move (hard links); the folder was not renamed', 501)
    }
    if (error instanceof RenameDestinationOccupiedError) {
      return bad(c, 'destination was claimed by an external writer during the move; retry', 409)
    }
    if (error instanceof RenameSourceReusedError) {
      return bad(c, 'the folder move conflicted with an external writer on both paths; nothing was overwritten; retry', 409)
    }
    if (rollbackSourceReused) {
      return bad(c, 'the source folder was re-used externally during rollback; the folder was kept at the new path without overwriting the external folder; reference updates were not applied', 409)
    }
    if (error instanceof AtomicTextWriteConflictError) {
      return bad(c, 'a referenced document changed on disk during rename; retry', 409)
    }
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
  const staged = `${abs}.docus-delete-inflight-${randomUUID()}`
  const quarantine = `${abs}.docus-quarantine-reuse-${randomUUID()}`
  const databaseSnapshot = snapshotDocumentMetadataPrefixMutation(metadataDb(), [folderP], all)
  const reuseManifest = path.join(path.dirname(abs), `.${path.basename(abs)}.docus-delete-manifest-${randomUUID()}`)
  const persistReuseQuarantine = async (): Promise<void> => {
    const identities = databaseSnapshot.documents.map((row) => ({ path: String(row.path), id: String(row.id) }))
    if (identities.length) {
      await writeDurableJournal(reuseManifest, {
        version: 1, op: 'delete-path-reuse', kind: 'folder', path: folderP,
        inflight: path.basename(staged), quarantine: path.basename(quarantine), identities,
      })
    }
    await fs.rename(staged, quarantine)
    await syncParentDirectoryBestEffort(quarantine)
  }
  const detachOldIdentities = (): void => {
    for (const row of databaseSnapshot.documents) {
      const oldPath = String(row.path)
      if (getDocumentMetadata(metadataDb(), oldPath)?.id === String(row.id)) {
        deleteDocumentMetadata(metadataDb(), oldPath)
      }
    }
  }
  await fs.rename(abs, staged)
  await syncParentDirectoryBestEffort(staged)
  try {
    deleteDocumentMetadataPrefix(metadataDb(), folderP)
    if (__folderRaceHooks?.failDeleteRemoval) throw new Error('injected recursive removal failure')
    await fs.rm(staged, { recursive: true, force: true })
  } catch (error) {
    const rollbackErrors: unknown[] = []
    // The failed delete never ran applyDelete; on path reuse the index
    // still carries the old subtree's links/titles. Drop the old paths
    // and re-derive the new subtree's entries from disk.
    const reindexReusedSubtree = async (): Promise<void> => {
      const idx = await getLinkIndex()
      idx.applyFolderDelete(all)
      for (const p of await listSubtreePaths(CONTENT_DIR, folderP)) {
        idx.applyWrite(p, await fs.readFile(filePathFor(p), 'utf8'))
      }
    }
    if (await exists(staged)) {
      if (!await exists(abs)) {
        // The path is still empty: put the old tree back WITH its
        // identity — the path again holds exactly the staged
        // generation. The create-only protocol (atomic rename over its
        // own mkdir gate on POSIX; replayable per-file links on
        // Windows) makes the restore create-only: if an external
        // writer claimed the path between the exists() check above and
        // the restore, restored: false reports it and the metadata is
        // NEVER restored onto foreign bytes.
        //
        // DURABLE rollback journal BEFORE the reverse move (round-7
        // P1): the replayable restore can crash mid-flight with the
        // tree split between the staging name and the public path.
        // Recovery completes the restore — files AND the persisted
        // metadata snapshot — forward from this journal; its presence
        // also tells the delete-inflight orphan rule to stand down.
        const rollbackStrategy = resolveDirectoryMoveStrategy()
        const stagedRel = path.dirname(folderP) === '.' ? path.basename(staged) : `${path.dirname(folderP)}/${path.basename(staged)}`
        const rollbackUuid = randomUUID()
        const rollbackJournalPath = path.join(path.dirname(staged), `.${path.basename(staged)}.docus-journal-${rollbackUuid}`)
        let restored = false
        let rollbackMoveThrew = false
        try {
          const rollbackPhysical = await listPhysicalMoveEntries(staged, (relativeFilePath) => {
            if (!relativeFilePath.endsWith('.md')) return null
            const docPath = `${folderP}/${relativeFilePath.slice(0, -'.md'.length)}`
            const doc = databaseSnapshot.documents.find((d) => String(d.path) === docPath)
            return doc ? { documentId: String(doc.id), documentPath: docPath } : null
          })
          const stagedStat = await fs.stat(staged)
          const rollbackGateSecret = generateGateTokenSecret()
          await writeDurableJournal(rollbackJournalPath, {
            version: 3,
            op: 'folder-move',
            srcRel: stagedRel,
            destRel: folderP,
            sourceDev: stagedStat.dev,
            sourceIno: stagedStat.ino,
            strategy: rollbackStrategy,
            ...(rollbackPhysical.entries.length === 0 ? { emptyTree: true } : {}),
            entries: rollbackPhysical.entries,
            directories: rollbackPhysical.directories,
            gateToken: rollbackGateSecret,
            metadataDisposition: { kind: 'snapshot-restore', snapshot: serializeMetadataSnapshot(databaseSnapshot) },
          })
          restored = (await executeFolderMove(rollbackStrategy, staged, abs, rollbackPhysical.entries.map((entry) => entry.relativeFilePath), {
            directories: rollbackPhysical.directories,
            gateToken: rollbackUuid,
            gateTokenContent: rollbackGateSecret,
            entries: rollbackPhysical.entries,
            vaultRoot: CONTENT_DIR,
          })).restored
        } catch (rollbackError) {
          rollbackMoveThrew = true
          rollbackErrors.push(rollbackError)
        }
        if (restored) {
          try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
          catch (rollbackError) { rollbackErrors.push(rollbackError) }
          await removeDurableJournal(rollbackJournalPath).catch(() => {})
        } else if (rollbackMoveThrew) {
          // A thrown move may have left the tree SPLIT between the
          // staging name and the public path: the rollback journal
          // stays (the next startup completes the restore from it)
          // and the staged tree must NOT be quarantined out from
          // under the journal. The AggregateError below surfaces the
          // failure.
        } else {
          // Clean contention (the path was claimed externally and the
          // move rolled itself fully back): the move journal can never
          // complete — drop it; the quarantine path below keeps the
          // bytes and detaches the stale identities.
          await removeDurableJournal(rollbackJournalPath).catch(() => {})
          // Path reuse (or restore failure): the old identities must
          // never bind to whatever now occupies the path. Drop every
          // stale row, leave the old tree quarantined under its
          // staging name, and refresh the link index against the new
          // subtree.
          let quarantined = false
          try {
            await persistReuseQuarantine()
            quarantined = true
          } catch (rollbackError) { rollbackErrors.push(rollbackError) }
          if (quarantined) {
            try { detachOldIdentities() }
            catch (rollbackError) { rollbackErrors.push(rollbackError) }
            try { await reindexReusedSubtree() } catch { /* next rebuild repairs */ }
            try { await removeDurableJournal(reuseManifest) }
            catch (rollbackError) { rollbackErrors.push(rollbackError) }
          }
        }
      } else {
        // Path reuse: an external writer recreated the folder while the
        // delete was failing. The old identities must never bind to the
        // new generation's files — drop every stale row under the path
        // (the new files get fresh identities on their next API touch)
        // and leave the old tree quarantined under its staging name.
        let quarantined = false
        try {
          await persistReuseQuarantine()
          quarantined = true
        } catch (rollbackError) { rollbackErrors.push(rollbackError) }
        if (quarantined) {
          try { detachOldIdentities() }
          catch (rollbackError) { rollbackErrors.push(rollbackError) }
          try { await reindexReusedSubtree() } catch { /* next rebuild repairs */ }
          try { await removeDurableJournal(reuseManifest) }
          catch (rollbackError) { rollbackErrors.push(rollbackError) }
        }
      }
    } else {
      try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
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
