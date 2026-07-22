import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import { getDocumentMetadata, moveDocumentMetadataReplacingDestination } from './documentMetadata.js'
import {
  renameWithTransientWindowsRetry,
  restoreStagedGeneration,
  syncParentDirectoryBestEffort,
  sha256Hex,
  removeDurableJournal,
  writeDurableJournal,
} from './atomicTextWrite.js'

/** Test-only hooks for the create-only move race/crash windows. Null
 * in production; tests reset in finally. `afterMkdirGate` fires right
 * after the destination gate directory is created (the window in which
 * external content can land inside it); `afterRenameLinked` fires after
 * the destination link lands but before the staging name is removed
 * (the window a kill -9 leaves two names on one inode). */
export type CreateOnlyMoveHooks = {
  afterMkdirGate?: (toDirAbs: string) => void | Promise<void>
  afterRenameTakenOver?: (stagingPath: string) => void | Promise<void>
  afterRenameLinked?: () => void | Promise<void>
  /** Fires after the staging name is gone but before metadata moves. */
  afterFileMoveFinalized?: () => void | Promise<void>
}
let __createOnlyMoveHooks: CreateOnlyMoveHooks | null = null
export function __setCreateOnlyMoveHooksForTesting(hooks: CreateOnlyMoveHooks | null): void {
  __createOnlyMoveHooks = hooks
}

/** The move destination was claimed by an external writer. The source
 * was restored (or quarantined if it too was re-used); nothing was
 * overwritten. Callers map this to a retryable conflict. */
export class RenameDestinationOccupiedError extends Error {
  constructor(destinationPath: string) {
    super(`rename destination already exists: ${destinationPath}`)
    this.name = 'RenameDestinationOccupiedError'
  }
}

/** A rolled-back rename could not return to its original path because
 * an external writer re-used it. The bytes were NOT overwritten — they
 * stayed at the rename destination (or, pathologically, quarantined
 * under a staging name). Callers must keep the identity with the bytes
 * instead of restoring it onto the external file. */
export class RenameSourceReusedError extends Error {
  readonly stagingPath?: string
  readonly survivingPath: 'staging' | 'destination'
  readonly sourceReused = true
  readonly destinationOccupied: boolean
  readonly journalPath?: string
  constructor(sourcePath: string, disposition: {
    stagingPath?: string
    survivingPath?: 'staging' | 'destination'
    destinationOccupied?: boolean
    journalPath?: string
  } = {}) {
    super(`rename rollback: source path re-used externally: ${sourcePath}`)
    this.name = 'RenameSourceReusedError'
    this.stagingPath = disposition.stagingPath
    this.survivingPath = disposition.survivingPath ?? 'destination'
    this.destinationOccupied = disposition.destinationOccupied ?? false
    this.journalPath = disposition.journalPath
  }
}

/**
 * Move a file WITHOUT ever replacing a generation we do not own:
 *
 *   1. take the source aside to a private staging path (ownership of
 *      the source bytes is now ours alone);
 *   2. link(2) the staging into the destination — create-only: if an
 *      external writer claimed the destination, EEXIST fails the move
 *      closed and the source is restored (itself create-only, so a
 *      re-used source quarantines the bytes instead of clobbering);
 *   3. unlink the staging name; the inode now has exactly one name.
 *
 * POSIX rename(2) atomically REPLACES an existing target, so a plain
 * "does the destination exist?" check at the route layer can never
 * protect external editors (Obsidian/vim/sync software ignore our
 * in-process locks). link(2) is its create-only counterpart. Both
 * paths are inside the vault, i.e. on one filesystem; on the rare
 * link-incapable filesystem (EPERM/EOPNOTSUPP/ENOTSUP) the move
 * degrades to a re-checked plain rename — a small check-to-rename
 * window exists only there.
 */
export async function createOnlyMoveFile(fromAbs: string, toAbs: string, preparedStagingPath?: string): Promise<void> {
  const stagedPath = preparedStagingPath ?? path.join(
    path.dirname(fromAbs),
    `.${path.basename(fromAbs)}.docus-rename-${randomUUID()}`,
  )
  await renameWithTransientWindowsRetry(fromAbs, stagedPath)
  if (__createOnlyMoveHooks?.afterRenameTakenOver) await __createOnlyMoveHooks.afterRenameTakenOver(stagedPath)
  try {
    await fs.link(stagedPath, toAbs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EOPNOTSUPP' || code === 'ENOTSUP') {
      // link(2) unsupported on this filesystem: degrade to a guarded
      // plain move (see the function comment).
      const targetStillFree = await fs.stat(toAbs).then(() => false, () => true)
      if (targetStillFree) {
        try {
          await renameWithTransientWindowsRetry(stagedPath, toAbs)
          await syncParentDirectoryBestEffort(toAbs)
          return
        } catch (fallbackError) {
          const { quarantined } = await restoreStagedGeneration(stagedPath, fromAbs)
          if (quarantined) {
            throw new RenameSourceReusedError(fromAbs, {
              stagingPath: stagedPath,
              survivingPath: 'staging',
              destinationOccupied: false,
            })
          }
          throw fallbackError
        }
      }
      const { quarantined } = await restoreStagedGeneration(stagedPath, fromAbs)
      throw quarantined ? new RenameSourceReusedError(fromAbs, { stagingPath: stagedPath, survivingPath: 'staging', destinationOccupied: true }) : new RenameDestinationOccupiedError(toAbs)
    }
    if (code === 'EEXIST') {
      // An external writer won the destination: restore the source
      // create-only and fail closed. If the source was re-used too,
      // the bytes stay quarantined rather than overwriting either
      // external file.
      const { quarantined } = await restoreStagedGeneration(stagedPath, fromAbs)
      throw quarantined ? new RenameSourceReusedError(fromAbs, { stagingPath: stagedPath, survivingPath: 'staging', destinationOccupied: true }) : new RenameDestinationOccupiedError(toAbs)
    }
    const { quarantined } = await restoreStagedGeneration(stagedPath, fromAbs)
    if (quarantined) {
      throw new RenameSourceReusedError(fromAbs, {
        stagingPath: stagedPath,
        survivingPath: 'staging',
        destinationOccupied: false,
      })
    }
    throw error
  }
  if (__createOnlyMoveHooks?.afterRenameLinked) await __createOnlyMoveHooks.afterRenameLinked()
  await fs.rm(stagedPath, { force: true })
  await syncParentDirectoryBestEffort(toAbs)
}

/**
 * Move a directory WITHOUT ever replacing external content. mkdir is
 * the create-only gate: EEXIST means an external writer claimed the
 * destination after any earlier check. rename(2) then atomically
 * replaces OUR OWN empty gate directory — a single syscall, so a crash
 * leaves the whole tree at exactly one of the two paths, never split.
 * If external content lands inside the gate directory between mkdir
 * and rename, the rename fails (ENOTEMPTY) and the directory is no
 * longer ours: `restored: false` reports the reuse with the source
 * tree left intact.
 */
export async function createOnlyMoveDirectory(
  fromDirAbs: string,
  toDirAbs: string,
): Promise<{ restored: boolean }> {
  try {
    await fs.mkdir(toDirAbs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'ENOTDIR') return { restored: false }
    throw error
  }
  if (__createOnlyMoveHooks?.afterMkdirGate) await __createOnlyMoveHooks.afterMkdirGate(toDirAbs)
  try {
    await renameWithTransientWindowsRetry(fromDirAbs, toDirAbs)
    return { restored: true }
  } catch (error) {
    try {
      // Only removable while still OUR empty gate directory.
      await fs.rmdir(toDirAbs)
    } catch {
      // External content inside: the destination is re-used.
      return { restored: false }
    }
    throw error
  }
}

export async function renameDocumentWithMetadata(input: {
  db: DatabaseT
  fromPath: string
  toPath: string
  fromAbs: string
  toAbs: string
  renameFile?: (from: string, to: string) => Promise<void>
  moveMetadata?: (db: DatabaseT, fromPath: string, toPath: string) => boolean
}): Promise<void> {
  const { db, fromPath, toPath, fromAbs, toAbs } = input
  // Default is create-only: an external file at the destination fails
  // the move closed instead of being replaced (POSIX rename would
  // atomically overwrite it).
  const renameFile = input.renameFile ?? createOnlyMoveFile
  const moveMetadata = input.moveMetadata ?? moveDocumentMetadataReplacingDestination
  // Custom rename functions are test/fault-injection seams and may not
  // operate on real paths. The production create-only mover always gets
  // a durable journal spanning file move through metadata commit.
  let journalPath: string | null = null
  let journalStagingPath: string | null = null
  if (input.renameFile === undefined) {
    const sourceRaw = await fs.readFile(fromAbs, 'utf8')
    journalPath = path.join(path.dirname(fromAbs), `.${path.basename(fromAbs)}.docus-journal-${randomUUID()}`)
    journalStagingPath = path.join(path.dirname(fromAbs), `.${path.basename(fromAbs)}.docus-rename-${randomUUID()}`)
    await writeDurableJournal(journalPath, {
      version: 1,
      op: 'file-rename',
      srcRel: fromPath,
      destRel: toPath,
      staging: path.basename(journalStagingPath),
      documentId: getDocumentMetadata(db, fromPath)?.id,
      sourceHash: sha256Hex(sourceRaw),
    })
  }
  const forwardRename = input.renameFile ?? ((from: string, to: string) => createOnlyMoveFile(from, to, journalStagingPath ?? undefined))
  try {
    await forwardRename(fromAbs, toAbs)
  } catch (error) {
    // A double reuse leaves the owned generation in staging. Preserve
    // the journal so startup/manual recovery can associate its identity;
    // ordinary destination contention restored the source completely.
    if (journalPath && !(error instanceof RenameSourceReusedError)) await removeDurableJournal(journalPath).catch(() => {})
    if (journalPath && error instanceof RenameSourceReusedError) {
      throw new RenameSourceReusedError(fromPath, {
        stagingPath: error.stagingPath,
        survivingPath: error.survivingPath,
        destinationOccupied: error.destinationOccupied,
        journalPath,
      })
    }
    throw error
  }
  if (__createOnlyMoveHooks?.afterFileMoveFinalized) await __createOnlyMoveHooks.afterFileMoveFinalized()
  try {
    if (!moveMetadata(db, fromPath, toPath)) {
      throw new Error(`source metadata missing: ${fromPath}`)
    }
    if (journalPath) await removeDurableJournal(journalPath).catch(() => {})
  } catch (metadataError) {
    try {
      await renameFile(toAbs, fromAbs)
    } catch (rollbackError) {
      if (rollbackError instanceof RenameDestinationOccupiedError) {
        // The original path was re-used externally: the create-only
        // rollback left the bytes at the destination rather than
        // overwriting the external file. The caller must keep the
        // identity with the bytes.
        throw new RenameSourceReusedError(fromPath, { survivingPath: 'destination', journalPath: journalPath ?? undefined })
      }
      if (rollbackError instanceof RenameSourceReusedError) {
        throw new RenameSourceReusedError(fromPath, {
          stagingPath: rollbackError.stagingPath,
          survivingPath: rollbackError.survivingPath,
          destinationOccupied: rollbackError.destinationOccupied,
          journalPath: journalPath ?? undefined,
        })
      }
      throw new AggregateError(
        [metadataError, rollbackError],
        'metadata move failed and filesystem rollback also failed',
      )
    }
    if (journalPath) await removeDurableJournal(journalPath).catch(() => {})
    throw metadataError
  }
}
