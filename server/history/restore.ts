import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Database as DatabaseT } from 'better-sqlite3'

import {
  AtomicTextWriteConflictError,
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
import { resolveSafeRelativePath } from '../paths.js'
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
  afterCommit?: () => void | Promise<void>
}): Promise<HistoryRestoreResult> {
  const logicalPath = input.path.slice(0, -'.md'.length)
  let target: string
  try {
    target = await resolveSafeRelativePath(input.repoRoot, input.path, { allowMissingFinal: true })
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

  return withVaultMutation(input.repoRoot, async () => {
    await ensureRepoWithinVaultMutation(input.repoRoot)
    return withVaultStructureLock(() => withDocumentWriteLock(logicalPath, async () => {
      await assertPathNotOwnedByFolderMove(input.repoRoot, input.path)

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
          const parent = path.dirname(target)
          const parentStat = await fs.lstat(parent).catch(() => null)
          if (!parentStat
            || !parentStat.isDirectory()
            || parentStat.isSymbolicLink()
            || !await isPhysicallyContained(input.repoRoot, parent)) {
            throw new HistoryRestoreConflictError(
              `document path moved before restore: ${logicalPath}`,
              'HISTORY_PATH_MOVED',
            )
          }
          const prepared = await prepareAtomicTextCreate(target, historicalRaw)
          try {
            await input.beforeCommit?.()
            await prepared.commit()
            committed = true
            created = true
            await input.afterCommit?.()
          } catch (error) {
            await prepared.rollback().catch(() => {})
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
              throw new HistoryRestoreConflictError(
                `document content changed before restore: ${logicalPath}`,
                'HISTORY_CONTENT_CHANGED',
                { cause: error },
              )
            }
            throw error
          }
        }

        await resolveSafeRelativePath(input.repoRoot, input.path)
        const observed = await readStableTextSnapshot(target)
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
            if (created) await atomicRemoveTextIfUnchanged(target, historicalRaw)
            else if (before) {
              await atomicReplaceTextIfUnchanged(
                target,
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
        throw error
      }
    }))
  })
}
