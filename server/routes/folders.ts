import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { canModify } from '../../src/composables/archiveProtocol.js'
import { AtomicTextWriteConflictError, atomicReplaceTextIfUnchanged, createDestinationGate, removeDurableJournal, rewriteDurableJournal, sha256Hex, syncParentDirectoryBestEffort, writeDurableJournal } from '../atomicTextWrite.js'
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
  getCreateOnlyMoveHooksForTesting,
  moveFolderEntriesIntoExistingGate,
  resolveDirectoryMoveStrategy,
  RenameDestinationOccupiedError,
  RenameSourceReusedError,
  UnsupportedDirectoryMoveError,
  verifyFolderMoveDestinationV4,
  type FolderMoveJournalStrategy,
} from '../documentFileLifecycle.js'
import {
  FOLDER_MOVE_JOURNAL_VERSION,
  listPhysicalMoveEntries,
  serializeMetadataSnapshot,
  type FolderMoveJournalEntry,
  type FolderMoveJournalV4,
  type FolderMovePhase,
} from '../folderMoveTransaction.js'
import { withDocumentWriteLock, withDocumentWriteLocks, withVaultStructureLock } from '../documentWriteLock.js'
import { getIndex as getLinkIndex } from '../linkIndex.js'
import { prepareRenameReferenceJournal, type PreparedRenameReferenceJournal } from '../renameReferenceJournal.js'
import { CONTENT_DIR, filePathFor, folderPathFor, isValidPathSyntax } from '../paths.js'
import { rewriteDocumentReferences } from '../renameReferences.js'
import { listSubtreePaths } from '../tree.js'
import { bad, ensureMetadata, exists, metadataDb } from './shared.js'

const folderRoutes = new Hono()

/** A directory rename this platform cannot perform (Windows: EPERM
 * on any existing directory; a link-incapable filesystem: the same
 * codes createOnlyMoveFile reports). Used by the v4 atomic-rename
 * path inside the forward phase machine. */
const LINK_INCAPABLE_CODES = new Set(['EPERM', 'EOPNOTSUPP', 'ENOTSUP'])

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
  let folderMoveJournal: FolderMoveJournalV4 | null = null
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
  // Local alias so per-phase crash seams (round-11 v4) read the current
  // hook bag without each call going through the module getter.
  const moveHooks = getCreateOnlyMoveHooksForTesting()
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
    // v4 entry shape: mandatory (sourceDev, sourceIno, sourceHash).
    const physicalEntriesV4: import('../folderMoveTransaction.js').FolderMoveJournalEntryV4[] = physical.entries.map((e) => ({
      relativeFilePath: e.relativeFilePath,
      sourceDev: e.sourceDev ?? '',
      sourceIno: e.sourceIno ?? '',
      sourceHash: e.sourceHash,
      ...(e.documentId !== undefined ? { documentId: e.documentId } : {}),
      ...(e.documentPath !== undefined ? { documentPath: e.documentPath } : {}),
    }))
    const physicalDirectoriesV4 = physical.directories
    // DURABLE JOURNAL (phase=prepared) before any filesystem change:
    // if the process dies between now and gate creation, recovery
    // sees phase=prepared with no dest generation → quarantines or
    // cleans up safely. Removed LAST after metadata-committed.
    const sourceDirectoryStat = await fs.stat(src)
    journalUuid = randomUUID()
    folderMoveJournal = {
      version: FOLDER_MOVE_JOURNAL_VERSION,
      op: 'folder-rename',
      phase: 'prepared',
      srcRel: srcPath,
      destRel: newPath,
      strategy: moveStrategy,
      sourceDev: Number(sourceDirectoryStat.dev),
      sourceIno: Number(sourceDirectoryStat.ino),
      ...(physicalEntriesV4.length === 0 ? { emptyTree: true } : {}),
      entries: physicalEntriesV4,
      directories: physicalDirectoriesV4,
      metadataDisposition: { kind: 'prefix-move' },
    }
    journalPath = path.join(path.dirname(src), `.${path.basename(src)}.docus-journal-${journalUuid}`)
    await writeDurableJournal(journalPath, folderMoveJournal)
    deleteDocumentMetadataPrefix(metadataDb(), newPath)
    // Create the destination gate and capture its (dev, ino). v4
    // ownership proof: this is the ONLY proof recovery uses. An
    // external writer who claimed the destination before us fails
    // this mkdir → 409.
    const destGate = await createDestinationGate(dest)
    if (!destGate) {
      await removeDurableJournal(journalPath).catch(() => {})
      return bad(c, 'destination was claimed by an external writer during the move; retry', 409)
    }
    // phase prepared → gate-created. For the atomic-rename strategy on
    // POSIX, the mkdir + rename(2) means the final destination directory
    // will have the SOURCE's inode (rename replaces the gate), not the
    // empty gate's inode. We still record the gate generation to prove
    // the gate was ours (not externally planted), but the actual ownership
    // proof after rename will be captured post-syscall.
    folderMoveJournal = { ...folderMoveJournal, phase: 'gate-created', destDev: destGate.dev, destIno: destGate.ino }
    await rewriteDurableJournal(journalPath, folderMoveJournal)
    if (moveHooks?.afterGateCreated) {
      await moveHooks.afterGateCreated(dest, destGate)
    }
    // Move entries into the pre-created gate. No token file is
    // written inside the destination. The atomic-rename strategy is
    // also handled inside this single syscall — no per-file replay.
    if (moveStrategy === 'atomic-rename') {
      try {
        await fs.rename(src, dest)
      } catch (atomicError) {
        // Atomic rename can fail when the destination has been claimed
        // by external content (ENOTEMPTY). Quarantine; the journal
        // remains for inspection.
        await fs.rmdir(dest).catch(() => {})
        await removeDurableJournal(journalPath).catch(() => {})
        if (atomicError instanceof Error && (atomicError as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
          return bad(c, 'destination was claimed by an external writer during the move; retry', 409)
        }
        if (atomicError instanceof Error && LINK_INCAPABLE_CODES.has((atomicError as NodeJS.ErrnoException).code ?? '')) {
          throw new UnsupportedDirectoryMoveError(
            `atomic directory rename failed; the platform needs the replayable strategy`,
            { cause: atomicError },
          )
        }
        throw atomicError
      }
      // After a successful POSIX atomic rename, stat the destination to
      // capture its REAL generation (the source directory became dest).
      // Rewrite the journal with the correct generation before parity.
      try {
        const finalDestStat = await fs.stat(dest)
        folderMoveJournal = { ...folderMoveJournal, phase: 'files-landed', destDev: String(finalDestStat.dev), destIno: String(finalDestStat.ino) }
        await rewriteDurableJournal(journalPath, folderMoveJournal)
      } catch (statError) {
        // Destination vanished between rename and stat — impossible,
        // but defensively quarantine.
        await removeDurableJournal(journalPath).catch(() => {})
        throw statError
      }
    } else {
      try {
        await moveFolderEntriesIntoExistingGate(src, dest, {
          vaultRoot: CONTENT_DIR,
          entries: physicalEntriesV4,
          directories: physicalDirectoriesV4,
        })
      } catch (moveError) {
        moveThrew = true
        throw moveError
      }
    }
    // Exact parity on the destination: dest directory (dev,ino) +
    // per-entry (dev,ino,hash) all match the journal. NO token check.
    const parityFailed = await verifyFolderMoveDestinationV4(dest, {
      destDev: folderMoveJournal.destDev,
      destIno: folderMoveJournal.destIno,
      entries: physicalEntriesV4,
      directories: physicalDirectoriesV4,
    })
    if (parityFailed) {
      // round-12: NEVER remove the journal on parity failure — the journal
      // is the only recovery evidence. Leaving it lets startup recovery
      // decide the correct final state (forward completion or reverse move).
      return bad(c, 'destination ownership or exact parity could not be verified; retry', 409)
    }
    // Crash seam (round-11 v4): after parity passes, BEFORE metadata
    // commits and BEFORE the phase is rewritten to files-landed.
    if (moveHooks?.afterFilesLanded) {
      await moveHooks.afterFilesLanded(dest)
    }
    // phase gate-created → files-landed. Failure aborts before
    // metadata commit.
    folderMoveJournal = { ...folderMoveJournal, phase: 'files-landed' }
    await rewriteDurableJournal(journalPath, folderMoveJournal)
    renamed = true
    moveDocumentMetadataPrefix(metadataDb(), srcPath, newPath)
    // Crash seam (round-11 v4): after metadata commits, BEFORE the
    // phase is rewritten to metadata-committed and the journal is
    // removed.
    if (moveHooks?.afterMetadataCommitted) {
      await moveHooks.afterMetadataCommitted(dest)
    }
    // phase files-landed → metadata-committed. Failure aborts before
    // journal removal.
    folderMoveJournal = { ...folderMoveJournal, phase: 'metadata-committed' }
    await rewriteDurableJournal(journalPath, folderMoveJournal)
    // Final step: remove the journal. The destination (dev, ino) and
    // per-entry (dev, ino, hash) are now the durable proof, not a
    // token file.
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
      // v4 reverse-direction rewrite: phase=prepared, destDev/destIno
      // removed, srcRel/destRel flipped. The persistent journal at
      // every phase is the single source of truth.
      const flipIsRequired = moveStrategy === 'replayable-move'
      let flipSucceeded = false
      if (journalPath && folderMoveJournal) {
        try {
          if (__folderRaceHooks?.failJournalFlip) throw new Error('injected journal flip failure')
          const flipped: FolderMoveJournalV4 = {
            ...folderMoveJournal,
            srcRel: newPath,
            destRel: srcPath,
            phase: 'prepared',
            // destDev/destIno are removed in the prepared phase; they
            // are re-persisted when the reverse gate is created.
            destDev: undefined,
            destIno: undefined,
            // Flip each entry's documentPath to match the new srcRel.
            entries: folderMoveJournal.entries.map((e) => ({
              ...e,
              ...(typeof e.documentId === 'string' && typeof e.documentPath === 'string'
                ? { documentPath: newPath + '/' + e.relativeFilePath.slice(0, -'.md'.length) }
                : {}),
            })),
          }
          await rewriteDurableJournal(journalPath, flipped)
          flipSucceeded = true
          // Persist the flipped entries into the running variable so
          // subsequent rewrites (gate-created, etc.) carry the updated
          // documentPaths.
          folderMoveJournal = flipped
        } catch (rollbackError) { rollbackErrors.push(rollbackError) }
      }
      if (flipSucceeded || !flipIsRequired) {
        // Create the destination gate at the REVERSE destination
        // (= original src). v4: every reverse phase must capture the
        // destination (dev, ino) just like the forward path did.
        const reverseDest = src
        const reverseGate = flipSucceeded ? await createDestinationGate(reverseDest) : null
        if (reverseGate && flipSucceeded && journalPath && folderMoveJournal) {
          // Reverse phase: prepared → gate-created
          folderMoveJournal = { ...folderMoveJournal, srcRel: newPath, destRel: srcPath, phase: 'gate-created', destDev: reverseGate.dev, destIno: reverseGate.ino }
          await rewriteDurableJournal(journalPath, folderMoveJournal)
          if (moveHooks?.afterReverseGateCreated) await moveHooks.afterReverseGateCreated(reverseDest)
        }
        if (reverseGate && journalPath && folderMoveJournal) {
          try {
            if (moveStrategy === 'atomic-rename') {
              try {
                await fs.rename(dest, reverseDest)
                // round-12 P0: reverse atomic rename also replaces the gate
                // directory with the source's inode on POSIX.
                const reverseDestStat = await fs.stat(reverseDest)
                folderMoveJournal = { ...folderMoveJournal, destDev: String(reverseDestStat.dev), destIno: String(reverseDestStat.ino) } as FolderMoveJournalV4
                await rewriteDurableJournal(journalPath, folderMoveJournal)
              } catch (atomicError) {
                await fs.rmdir(reverseDest).catch(() => {})
                if (atomicError instanceof Error && (atomicError as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
                  rollbackSourceReused = true
                } else if (atomicError instanceof Error && LINK_INCAPABLE_CODES.has((atomicError as NodeJS.ErrnoException).code ?? '')) {
                  throw new UnsupportedDirectoryMoveError(
                    `atomic reverse directory rename failed; the platform needs the replayable strategy`,
                    { cause: atomicError },
                  )
                } else {
                  throw atomicError
                }
              }
            } else {
              // Replayable reverse move into the pre-created gate.
              // Same per-file generation-proof as forward.
              try {
                await moveFolderEntriesIntoExistingGate(dest, reverseDest, {
                  vaultRoot: CONTENT_DIR,
                  entries: folderMoveJournal!.entries,
                  directories: folderMoveJournal!.directories,
                })
              } catch (reverseMoveError) {
                if (reverseMoveError instanceof RenameDestinationOccupiedError
                  || reverseMoveError instanceof RenameSourceReusedError) {
                  rollbackSourceReused = true
                } else {
                  throw reverseMoveError
                }
              }
            }
          } catch (rollbackError) { rollbackErrors.push(rollbackError) }
          if (!rollbackSourceReused && folderMoveJournal) {
            // Reverse parity: same (dev, ino, hash) proof as forward.
            const reverseParityFailed = await verifyFolderMoveDestinationV4(reverseDest, {
              destDev: folderMoveJournal.destDev,
              destIno: folderMoveJournal.destIno,
              entries: folderMoveJournal!.entries,
              directories: folderMoveJournal!.directories,
            })
            if (reverseParityFailed) {
              rollbackSourceReused = true
            } else {
              if (moveHooks?.afterReverseParity) await moveHooks.afterReverseParity(reverseDest)
              // Reverse phase: gate-created → files-landed
              folderMoveJournal = { ...folderMoveJournal, phase: 'files-landed' }
              await rewriteDurableJournal(journalPath!, folderMoveJournal)
              rolledTreeBack = true
              if (__folderRaceHooks?.afterRollbackMove) await __folderRaceHooks.afterRollbackMove()
            }
          }
        } else {
          // Could not create the reverse gate (external writer
          // claimed src) OR the flip failed: the tree stays at newPath.
          rollbackSourceReused = true
        }
      } else {
        // Replayable reverse move without a durable journal: refuse
        // to move a single file.
        rollbackSourceReused = true
      }
    }
    if (!rollbackSourceReused) {
      try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
      let metadataRestoreOk = rollbackErrors.length === 0 && !rollbackSourceReused
      if (journalPath && folderMoveJournal && rolledTreeBack) {
        // Reverse phase: files-landed → metadata-committed
        folderMoveJournal = { ...folderMoveJournal, phase: 'metadata-committed' }
        try { await rewriteDurableJournal(journalPath, folderMoveJournal) }
        catch (rollbackError) { rollbackErrors.push(rollbackError) }
        metadataRestoreOk = rollbackErrors.length === 0 && !rollbackSourceReused
        if (moveHooks?.afterReverseMetadata) await moveHooks.afterReverseMetadata(src)
      }
      if (!metadataRestoreOk) {
        // Metadata restore or phase rewrite failed — keep journal for recovery.
        if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'folder rename failed and rollback was incomplete')
      }
    } else if (journalPath && folderMoveJournal) {
      // The tree stays at newPath: flip the journal back to the
      // forward direction (phase=metadata-committed) FIRST, so a
      // crash right here leaves a journal whose recovery completes
      // the metadata move to newPath — never one that would bind
      // identities to the externally re-used source. The rows are
      // already at newPath from the forward move.
      try { await rewriteDurableJournal(journalPath, folderMoveJournal) }
      catch (rollbackError) { rollbackErrors.push(rollbackError) }
    }
    // Journal cleanup: removable only when BOTH metadata restore AND
    // durable journal phase rewrite succeeded (round-12 P0/P1). Cannot
    // rely on memory-phase; must verify both mutations completed.
    if (rolledTreeBack && !rollbackSourceReused && journalPath && !moveThrew
      && folderMoveJournal?.phase === 'metadata-committed'
      && rollbackErrors.length === 0) {
      if (moveHooks?.beforeReverseJournalRemove) await moveHooks.beforeReverseJournalRemove(src)
      await removeDurableJournal(journalPath).catch(() => {})
    }
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
    // Round-10 F1/F2: parity saw foreign bytes on the destination AND
    // the rollback refused to carry those foreign bytes back. Surface
    // as a retryable 409 — the folder is provably unsafe to commit.
    if (error instanceof Error && /exact parity failed and the rollback was incomplete/.test(error.message)) {
      return bad(c, 'an external writer replaced landed bytes during the move; the journal stays for inspection; retry', 409)
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
        let rollbackPhysicalEntriesV4: import('../folderMoveTransaction.js').FolderMoveJournalEntryV4[] = []
        let rollbackPhysicalDirectoriesV4: string[] = []
        let rollbackJournal: FolderMoveJournalV4 | null = null
        try {
          const rollbackPhysical = await listPhysicalMoveEntries(staged, (relativeFilePath) => {
            if (!relativeFilePath.endsWith('.md')) return null
            const docPath = `${folderP}/${relativeFilePath.slice(0, -'.md'.length)}`
            const doc = databaseSnapshot.documents.find((d) => String(d.path) === docPath)
            return doc ? { documentId: String(doc.id), documentPath: docPath } : null
          })
          rollbackPhysicalEntriesV4 = rollbackPhysical.entries.map((e) => ({
            relativeFilePath: e.relativeFilePath,
            sourceDev: e.sourceDev ?? '',
            sourceIno: e.sourceIno ?? '',
            sourceHash: e.sourceHash,
            ...(e.documentId !== undefined ? { documentId: e.documentId } : {}),
            ...(e.documentPath !== undefined ? { documentPath: e.documentPath } : {}),
          }))
          rollbackPhysicalDirectoriesV4 = rollbackPhysical.directories
          const stagedStat = await fs.stat(staged)
          rollbackJournal = {
            version: FOLDER_MOVE_JOURNAL_VERSION,
            op: 'folder-move',
            phase: 'prepared',
            srcRel: stagedRel,
            destRel: folderP,
            strategy: rollbackStrategy,
            sourceDev: Number(stagedStat.dev),
            sourceIno: Number(stagedStat.ino),
            ...(rollbackPhysicalEntriesV4.length === 0 ? { emptyTree: true } : {}),
            entries: rollbackPhysicalEntriesV4,
            directories: rollbackPhysicalDirectoriesV4,
            metadataDisposition: { kind: 'snapshot-restore', snapshot: serializeMetadataSnapshot(databaseSnapshot) },
          }
          await writeDurableJournal(rollbackJournalPath, rollbackJournal)
          const rollbackGate = await createDestinationGate(abs)
          if (!rollbackGate) {
            // External writer claimed abs before the rollback started:
            // the staged tree must NOT be merged in. Quarantine the
            // rollback journal; let the caller fall through to the
            // persistReuseQuarantine branch.
            throw new RenameDestinationOccupiedError(abs)
          }
          rollbackJournal = { ...rollbackJournal, phase: 'gate-created', destDev: rollbackGate.dev, destIno: rollbackGate.ino }
          await rewriteDurableJournal(rollbackJournalPath, rollbackJournal)
          if (rollbackStrategy === 'atomic-rename') {
            try {
              await fs.rename(staged, abs)
              // round-12 P0: reverse atomic rename also replaces the gate
              // directory with the source's inode on POSIX.
              const absStat = await fs.stat(abs)
              rollbackJournal = { ...rollbackJournal, destDev: String(absStat.dev), destIno: String(absStat.ino) }
              await rewriteDurableJournal(rollbackJournalPath, rollbackJournal)
            } catch (atomicError) {
              await fs.rmdir(abs).catch(() => {})
              throw atomicError
            }
          } else {
            await moveFolderEntriesIntoExistingGate(staged, abs, {
              vaultRoot: CONTENT_DIR,
              entries: rollbackPhysicalEntriesV4,
              directories: rollbackPhysicalDirectoriesV4,
            })
          }
          const rollbackParityFailed = await verifyFolderMoveDestinationV4(abs, {
            destDev: rollbackJournal.destDev,
            destIno: rollbackJournal.destIno,
            entries: rollbackPhysicalEntriesV4,
            directories: rollbackPhysicalDirectoriesV4,
          })
          if (rollbackParityFailed) throw new Error('rollback parity failed')
          rollbackJournal = { ...rollbackJournal, phase: 'files-landed' }
          await rewriteDurableJournal(rollbackJournalPath, rollbackJournal)
          restored = true
        } catch (rollbackError) {
          rollbackMoveThrew = true
          rollbackErrors.push(rollbackError)
        }
        if (restored) {
          try { restoreDocumentMetadataMutation(metadataDb(), databaseSnapshot) }
          catch (rollbackError) { rollbackErrors.push(rollbackError) }
          if (rollbackErrors.length === 0 && rollbackJournal) {
            // round-12 P0/P1: only remove after BOTH metadata and phase rewrite succeed.
            rollbackJournal = { ...rollbackJournal, phase: 'metadata-committed' }
            try { await rewriteDurableJournal(rollbackJournalPath, rollbackJournal) }
            catch (rollbackError) { rollbackErrors.push(rollbackError) }
          }
          if (rollbackErrors.length === 0) {
            await removeDurableJournal(rollbackJournalPath).catch(() => {})
          }
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
