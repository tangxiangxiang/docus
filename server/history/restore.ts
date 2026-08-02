import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Database as DatabaseT } from 'better-sqlite3'

import {
  AtomicTextWriteConflictError,
  AtomicTextWriteOwnershipError,
  AtomicTextWriteTargetMissingError,
  atomicRemoveTextIfUnchanged,
  atomicReplaceTextIfUnchanged,
  prepareAtomicTextCreate,
  readStableTextSnapshot,
  type StableTextSnapshot,
} from '../atomicTextWrite.js'
import {
  ensureDocumentMetadata,
  restoreDocumentMetadataMutation,
  snapshotDocumentMetadataMutation,
} from '../documentMetadata.js'
import { withDocumentWriteLock, withVaultStructureLock } from '../documentWriteLock.js'
import { isPhysicallyContained } from '../documentFileLifecycle.js'
import { assertPathNotOwnedByFolderMove, FolderMovePathOwnedError } from '../folderMoveJournalOwnership.js'
import { withVaultMutation } from '../vaultMutation.js'
import {
  resolveSafeRelativePathDetailed,
  verifySafePathResolution,
  type SafePathResolution,
} from '../paths.js'
import * as git from './git.js'
import { ensureRepoWithinVaultMutation } from './repo.js'

export class HistoryRestoreNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HistoryRestoreNotFoundError'
  }
}

export class HistoryRestoreConflictError extends Error {
  readonly code: 'HISTORY_CONTENT_CHANGED' | 'HISTORY_PATH_MOVED'

  constructor(
    message: string,
    code: HistoryRestoreConflictError['code'],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'HistoryRestoreConflictError'
    this.code = code
  }
}

export type HistoryRestoreResult = {
  path: string
  ref: string
  resolvedRef: string
  raw: string
  mtime: number
}

async function currentSnapshot(target: string): Promise<StableTextSnapshot | null> {
  try {
    return await readStableTextSnapshot(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function restoreHistoricalDocument(input: {
  repoRoot: string
  path: string
  ref: string
  db: DatabaseT
  beforeMutation?: () => void | Promise<void>
  beforeCommit?: () => void | Promise<void>
  afterPrepare?: () => void | Promise<void>
  afterCommit?: () => void | Promise<void>
}): Promise<HistoryRestoreResult> {
  const logicalPath = input.path.slice(0, -'.md'.length)
  return withVaultMutation(input.repoRoot, async () => {
    await ensureRepoWithinVaultMutation(input.repoRoot)
    return withVaultStructureLock(() => withDocumentWriteLock(logicalPath, async () => {
      await assertPathNotOwnedByFolderMove(input.repoRoot, input.path)

      let target: string
      let targetResolution: SafePathResolution
      try {
        targetResolution = await resolveSafeRelativePathDetailed(
          input.repoRoot,
          input.path,
          { allowMissingFinal: true },
        )
        target = targetResolution.absolute
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          throw new HistoryRestoreConflictError(
            `document path moved before restore: ${logicalPath}`,
            'HISTORY_PATH_MOVED',
            { cause: error },
          )
        }
        throw error
      }

      const resolvedRef = await git.resolveCommit(input.repoRoot, input.ref)
      if (!resolvedRef) {
        throw new HistoryRestoreNotFoundError(`invalid reference ${input.ref}`)
      }
      const historicalRaw = await git.rawAt(input.repoRoot, resolvedRef, input.path)
      if (historicalRaw === null) {
        throw new HistoryRestoreNotFoundError(
          `file does not exist at ref ${input.ref}`,
        )
      }

      await input.beforeMutation?.()
      try {
        targetResolution = await resolveSafeRelativePathDetailed(
          input.repoRoot,
          input.path,
          { allowMissingFinal: true },
        )
      } catch (error: any) {
        if (error?.code === 'ENOENT' || /symbolic links|path segment|path root/i.test(error?.message ?? '')) {
          throw new HistoryRestoreConflictError(
            `document path moved before restore: ${logicalPath}`,
            'HISTORY_PATH_MOVED',
            { cause: error },
          )
        }
        throw error
      }
      target = targetResolution.absolute
      await verifySafePathResolution(targetResolution)
      const leaf = await fs.lstat(target).catch(() => null)
      if (leaf && (!leaf.isFile() || leaf.isSymbolicLink())) {
        throw new HistoryRestoreConflictError(
          `document path moved before restore: ${logicalPath}`,
          'HISTORY_PATH_MOVED',
        )
      }
      const before = await currentSnapshot(target)
      const databaseSnapshot = snapshotDocumentMetadataMutation(input.db, [logicalPath])
      let committed = false
      let created = false
      try {
        if (before) {
          ensureDocumentMetadata(
            input.db,
            logicalPath,
            before.raw,
            before.stat.mtimeMs,
          )
          if (before.raw !== historicalRaw) {
            await input.beforeCommit?.()
            await verifySafePathResolution(targetResolution)
            await atomicReplaceTextIfUnchanged(
              target,
              before.raw,
              historicalRaw,
              { mode: before.stat.mode },
            )
            committed = true
            await input.afterCommit?.()
          }
        } else {
          // For a create-only Restore, the last caller-controlled hook must
          // run before Docus creates any hidden temporary file. Re-resolve
          // the parent after the hook so a moved/replaced directory cannot
          // cause cleanup to follow a later symlink.
          await input.beforeCommit?.()
          let createResolution: SafePathResolution
          try {
            createResolution = await resolveSafeRelativePathDetailed(
              input.repoRoot,
              input.path,
              { allowMissingFinal: true },
            )
            await verifySafePathResolution(createResolution)
          } catch (error: any) {
            if (error?.code === 'ENOENT' || /symbolic links|path segment|path root/i.test(error?.message ?? '')) {
              throw new HistoryRestoreConflictError(
                `document path moved before restore: ${logicalPath}`,
                'HISTORY_PATH_MOVED',
                { cause: error },
              )
            }
            throw error
          }
          targetResolution = createResolution
          target = createResolution.absolute
          const parent = path.dirname(target)
          const parentStat = await fs.lstat(parent).catch(() => null)
          const targetStat = await fs.lstat(target).catch((error: any) => {
            if (error?.code === 'ENOENT') return null
            throw error
          })
          if (!parentStat
            || !parentStat.isDirectory()
            || parentStat.isSymbolicLink()
            || !await isPhysicallyContained(input.repoRoot, parent)
            || targetStat !== null) {
            throw new HistoryRestoreConflictError(
              targetStat !== null
                ? `document content changed before restore: ${logicalPath}`
                : `document path moved before restore: ${logicalPath}`,
              targetStat !== null ? 'HISTORY_CONTENT_CHANGED' : 'HISTORY_PATH_MOVED',
            )
          }
          const prepared = await prepareAtomicTextCreate(target, historicalRaw)
          try {
            await input.afterPrepare?.()
            await verifySafePathResolution(targetResolution)
            await prepared.commit()
            committed = true
            created = true
            await input.afterCommit?.()
          } catch (error) {
            let cleanupError: unknown
            try {
              await prepared.rollback()
            } catch (rollbackError) {
              cleanupError = rollbackError
            }
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
              throw new HistoryRestoreConflictError(
                `document content changed before restore: ${logicalPath}`,
                'HISTORY_CONTENT_CHANGED',
                { cause: cleanupError ? new AggregateError([error, cleanupError]) : error },
              )
            }
            if (cleanupError) {
              throw new HistoryRestoreConflictError(
                `document path moved before restore: ${logicalPath}`,
                'HISTORY_PATH_MOVED',
                { cause: new AggregateError([error, cleanupError]) },
              )
            }
            throw error
          }
        }

        const postResolution = await resolveSafeRelativePathDetailed(input.repoRoot, input.path)
        await verifySafePathResolution(postResolution)
        const observed = await readStableTextSnapshot(postResolution.absolute)
        await verifySafePathResolution(postResolution)
        if (observed.raw !== historicalRaw) {
          throw new HistoryRestoreConflictError(
            `document content changed before restore completed: ${logicalPath}`,
            'HISTORY_CONTENT_CHANGED',
          )
        }
        ensureDocumentMetadata(
          input.db,
          logicalPath,
          observed.raw,
          observed.stat.mtimeMs,
          committed ? Date.now() : observed.stat.mtimeMs,
        )
        return {
          path: input.path,
          ref: input.ref,
          resolvedRef,
          raw: historicalRaw,
          mtime: observed.stat.mtimeMs,
        }
      } catch (error) {
        const rollbackFailures: unknown[] = []
        if (committed) {
          try {
            const rollbackResolution = await resolveSafeRelativePathDetailed(
              input.repoRoot,
              input.path,
            )
            await verifySafePathResolution(rollbackResolution)
            if (created) await atomicRemoveTextIfUnchanged(rollbackResolution.absolute, historicalRaw)
            else if (before) {
              await atomicReplaceTextIfUnchanged(
                rollbackResolution.absolute,
                historicalRaw,
                before.raw,
                { mode: before.stat.mode },
              )
            }
          } catch (rollbackError) {
            if (!(rollbackError instanceof AtomicTextWriteConflictError)) {
              rollbackFailures.push(rollbackError)
            }
          }
        }
        try {
          restoreDocumentMetadataMutation(input.db, databaseSnapshot)
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError)
        }
        if (rollbackFailures.length > 0) {
          throw new AggregateError(
            [error, ...rollbackFailures],
            'History Restore failed and rollback was incomplete',
          )
        }
        if (error instanceof FolderMovePathOwnedError) {
          throw new HistoryRestoreConflictError(
            error.message,
            'HISTORY_PATH_MOVED',
            { cause: error },
          )
        }
        if (error instanceof AtomicTextWriteConflictError
          || error instanceof AtomicTextWriteTargetMissingError) {
          throw new HistoryRestoreConflictError(
            `document content changed before restore: ${logicalPath}`,
            'HISTORY_CONTENT_CHANGED',
            { cause: error },
          )
        }
        if (error instanceof AtomicTextWriteOwnershipError) {
          throw new HistoryRestoreConflictError(
            `document path moved before restore completed: ${logicalPath}`,
            'HISTORY_PATH_MOVED',
            { cause: error },
          )
        }
        if (error instanceof Error && /symbolic links|path changed while accessing|path segment|path root/i.test(error.message)) {
          throw new HistoryRestoreConflictError(
            `document path moved before restore completed: ${logicalPath}`,
            'HISTORY_PATH_MOVED',
            { cause: error },
          )
        }
        throw error
      }
    }))
  })
}
