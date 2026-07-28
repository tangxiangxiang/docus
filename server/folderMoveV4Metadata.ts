import { promises as fs } from 'node:fs'
import type { Database as DatabaseT } from 'better-sqlite3'

import {
  removeDurableJournal,
  rewriteDurableJournal,
  verifyDirectoryGeneration,
} from './atomicTextWrite.js'
import {
  type DocumentMetadataMutationSnapshot,
  listDocumentMetadata,
  moveDocumentMetadataPrefix,
  restoreDocumentMetadataMutationCAS,
  snapshotDocumentMetadataOwnership,
  validateSnapshotOwnership,
} from './documentMetadata.js'
import { verifyFolderMoveDestinationV4 } from './documentFileLifecycle.js'
import {
  isValidDeleteRollbackSnapshot,
  reviveMetadataSnapshot,
  validateSnapshotPhysicalEntries,
  type FolderMoveJournalEntry,
  type FolderMoveJournalV4,
} from './folderMoveTransaction.js'

export type FolderMoveV4FinalizationResult = {
  completed: boolean
  action: 'completed-rename' | 'quarantined' | 'failed'
  detail: string
  journal: FolderMoveJournalV4
}

type FinalizationHooks = {
  metadataAction?: () => void
  verifyMetadataGraph?: () => boolean
  afterMetadataMutationBeforeJournalRewrite?: () => void | Promise<void>
  afterMetadataJournalRewriteBeforeFinalVerify?: () => void | Promise<void>
  beforeJournalRemove?: () => void | Promise<void>
}

function result(
  journal: FolderMoveJournalV4,
  action: FolderMoveV4FinalizationResult['action'],
  detail: string,
): FolderMoveV4FinalizationResult {
  return { completed: action === 'completed-rename', action, detail, journal }
}

function verifyPrefixMetadataCommitted(
  db: DatabaseT,
  journal: FolderMoveJournalV4,
): string | null {
  const rows = listDocumentMetadata(db).filter((row) =>
    row.path === journal.destRel || row.path.startsWith(`${journal.destRel}/`)
      || row.path === journal.srcRel || row.path.startsWith(`${journal.srcRel}/`),
  )
  const expected = new Map<string, string>()
  for (const entry of journal.entries) {
    if (entry.documentId === undefined || entry.documentPath === undefined) continue
    const suffix = entry.documentPath === journal.srcRel
      ? ''
      : entry.documentPath.slice(`${journal.srcRel}/`.length)
    expected.set(`${journal.destRel}${suffix ? `/${suffix}` : ''}`, entry.documentId)
  }
  const destinationRows = rows.filter((row) =>
    row.path === journal.destRel || row.path.startsWith(`${journal.destRel}/`),
  )
  const sourceRows = rows.filter((row) =>
    row.path === journal.srcRel || row.path.startsWith(`${journal.srcRel}/`),
  )
  if (sourceRows.length > 0) return 'source prefix metadata remains after commit'
  if (destinationRows.length !== expected.size) {
    return `destination prefix metadata count mismatch: expected ${expected.size}, found ${destinationRows.length}`
  }
  for (const row of destinationRows) {
    if (expected.get(row.path) !== row.id) return `destination prefix identity mismatch: ${row.path}`
  }
  return null
}

function canonicalRow(row: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {}
  for (const key of Object.keys(row).sort()) ordered[key] = row[key]
  return JSON.stringify(ordered)
}

function rowsExactlyEqualSnapshot(
  live: readonly Record<string, unknown>[],
  expected: readonly Record<string, unknown>[],
): boolean {
  return live.length === expected.length
    && live.every((row, index) =>
      canonicalRow(row) === canonicalRow(expected[index] as Record<string, unknown>),
    )
}

function rowsAreExpectedSubset(
  live: readonly Record<string, unknown>[],
  expected: readonly Record<string, unknown>[],
): boolean {
  const expectedRows = new Set(expected.map(canonicalRow))
  return live.every((row) => expectedRows.has(canonicalRow(row)))
}

export function verifyMetadataSnapshotGraphExact(
  db: DatabaseT,
  snapshot: DocumentMetadataMutationSnapshot,
): boolean {
  const live = snapshotDocumentMetadataOwnership(
    db,
    snapshot.paths,
    snapshot.documentIds,
    snapshot.tagIds,
  )
  return rowsExactlyEqualSnapshot(live.documents, snapshot.documents)
    && rowsExactlyEqualSnapshot(live.tags, snapshot.tags)
    && rowsExactlyEqualSnapshot(live.documentTags, snapshot.documentTags)
    && rowsExactlyEqualSnapshot(live.embeddings, snapshot.embeddings)
    && rowsExactlyEqualSnapshot(live.migrations, snapshot.migrations)
}

function snapshotRestoreOwnershipMatches(
  current: ReturnType<typeof snapshotDocumentMetadataOwnership>,
  expected: ReturnType<typeof reviveMetadataSnapshot>,
  journal: FolderMoveJournalV4,
): boolean {
  if (validateSnapshotOwnership(current, expected)) return true

  const expectedDocumentById = new Map(
    expected.documents.map((row) => [String(row.id), row]),
  )
  const expectedPaths = new Set(expected.paths)
  for (const live of current.documents) {
    const expectedRow = expectedDocumentById.get(String(live.id))
    if (!expectedRow) {
      if (expectedPaths.has(String(live.path))) return false
      continue
    }
    const expectedPath = String(expectedRow.path)
    const ownedForwardPath = `${journal.srcRel}${expectedPath.slice(journal.destRel.length)}`
    if (live.path !== expectedPath && live.path !== ownedForwardPath) return false
    const normalized = {
      ...live,
      path: expectedRow.path,
      updated_at: expectedRow.updated_at,
    }
    if (canonicalRow(normalized) !== canonicalRow(expectedRow)) return false
  }

  if (!rowsAreExpectedSubset(current.tags, expected.tags)
    || !rowsAreExpectedSubset(current.documentTags, expected.documentTags)
    || !rowsAreExpectedSubset(current.embeddings, expected.embeddings)) {
    return false
  }

  const expectedMigrations = new Map(
    expected.migrations.map((row) => [
      `${String(row.document_id ?? '')}\0${String(row.original_path ?? '')}`,
      row,
    ]),
  )
  for (const live of current.migrations) {
    const expectedRow = expectedMigrations.get(
      `${String(live.document_id ?? '')}\0${String(live.original_path ?? '')}`,
    )
    if (!expectedRow) {
      const tombstonedId = typeof live.path === 'string' && live.path.startsWith('@deleted/')
        ? live.path.slice('@deleted/'.length)
        : null
      if (tombstonedId
        && expectedDocumentById.has(tombstonedId)
        && live.document_id == null
        && typeof live.original_path === 'string'
        && expectedPaths.has(live.original_path)) {
        continue
      }
      return false
    }
    const expectedPath = String(expectedRow.path)
    const ownedForwardPath = expectedPath.startsWith(`${journal.destRel}/`)
      ? `${journal.srcRel}${expectedPath.slice(journal.destRel.length)}`
      : expectedPath
    if (live.path !== expectedPath && live.path !== ownedForwardPath) return false
    const normalized = {
      ...live,
      path: expectedRow.path,
      updated_at: expectedRow.updated_at,
    }
    if (canonicalRow(normalized) !== canonicalRow(expectedRow)) return false
  }
  return true
}

export async function finalizeFolderMoveV4Cleanup(
  db: DatabaseT,
  journalAbs: string,
  journal: FolderMoveJournalV4 & { phase: 'metadata-committed' },
  srcAbs: string,
  destAbs: string,
  hooks: Pick<FinalizationHooks, 'beforeJournalRemove' | 'verifyMetadataGraph'> = {},
): Promise<FolderMoveV4FinalizationResult> {
  if (!journal.destDev || !journal.destIno) {
    return result(journal, 'quarantined', 'metadata-committed journal is missing final destination generation')
  }
  if (!await verifyDirectoryGeneration(destAbs, {
    dev: journal.destDev,
    ino: journal.destIno,
  })) {
    return result(journal, 'quarantined', 'metadata-committed destination generation does not match journal')
  }
  if (await verifyFolderMoveDestinationV4(destAbs, journal)) {
    return result(journal, 'quarantined', 'metadata-committed destination exact parity failed')
  }

  if (!hooks.verifyMetadataGraph && journal.metadataDisposition.kind === 'snapshot-restore') {
    if (!isValidDeleteRollbackSnapshot(journal.metadataDisposition.snapshot, journal.destRel)) {
      return result(journal, 'quarantined', 'metadata-committed snapshot is invalid')
    }
    const revived = reviveMetadataSnapshot(journal.metadataDisposition.snapshot)
    const liveTagIds = (db.prepare('SELECT id FROM tags').all() as Array<{ id: number }>)
      .map((row) => row.id)
    revived.preexistingTagIds = [...new Set([...liveTagIds, ...revived.preexistingTagIds])]
    const live = snapshotDocumentMetadataOwnership(
      db,
      revived.paths,
      revived.documentIds,
      revived.tagIds,
    )
    if (!rowsExactlyEqualSnapshot(live.documents, revived.documents)
      || !rowsExactlyEqualSnapshot(live.tags, revived.tags)
      || !rowsExactlyEqualSnapshot(live.documentTags, revived.documentTags)
      || !rowsExactlyEqualSnapshot(live.embeddings, revived.embeddings)
      || !rowsExactlyEqualSnapshot(live.migrations, revived.migrations)) {
      return result(
        journal,
        'quarantined',
        'metadata-committed snapshot graph verification failed: live graph differs from snapshot',
      )
    }
  } else if (!hooks.verifyMetadataGraph) {
    const metadataError = verifyPrefixMetadataCommitted(db, journal)
    if (metadataError !== null) {
      return result(
        journal,
        'quarantined',
        `metadata-committed prefix verification failed: ${metadataError}`,
      )
    }
  }
  if (hooks.verifyMetadataGraph && !hooks.verifyMetadataGraph()) {
    return result(journal, 'quarantined', 'metadata-committed custom graph verification failed')
  }

  try {
    const sourceStat = await fs.lstat(srcAbs).catch(() => null)
    if (sourceStat !== null) {
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
        return result(journal, 'quarantined', 'metadata-committed source path is not a real directory')
      }
      if ((await fs.readdir(srcAbs)).length > 0) {
        return result(journal, 'quarantined', 'metadata-committed source directory still contains undeclared entries')
      }
      await fs.rmdir(srcAbs)
    }
    await hooks.beforeJournalRemove?.()
    await removeDurableJournal(journalAbs)
  } catch (error) {
    return result(journal, 'failed', `v4 final cleanup failed: ${(error as Error).message}`)
  }
  return result(journal, 'completed-rename', 'v4 metadata-committed transaction verified and cleaned')
}

export async function completeFolderMoveV4Metadata(
  db: DatabaseT,
  journalAbs: string,
  journal: FolderMoveJournalV4 & { phase: 'files-landed' },
  srcAbs: string,
  destAbs: string,
  hooks: FinalizationHooks = {},
): Promise<FolderMoveV4FinalizationResult> {
  if (await verifyFolderMoveDestinationV4(destAbs, journal)) {
    return result(journal, 'quarantined', 'files-landed physical parity failed before metadata commit')
  }

  if (hooks.metadataAction) {
    try {
      hooks.metadataAction()
    } catch (error) {
      return result(journal, 'failed', `custom metadata action failed: ${(error as Error).message}`)
    }
  } else if (journal.metadataDisposition.kind === 'snapshot-restore') {
    const snapshot = journal.metadataDisposition.snapshot
    if (!isValidDeleteRollbackSnapshot(snapshot, journal.destRel)) {
      return result(journal, 'quarantined', 'snapshot-restore metadata disposition is invalid')
    }
    const entryError = validateSnapshotPhysicalEntries(
      snapshot,
      journal.entries as unknown as FolderMoveJournalEntry[],
      journal.destRel,
    )
    if (entryError !== null) {
      return result(journal, 'quarantined', `snapshot physical entries are invalid: ${entryError}`)
    }
    const revived = reviveMetadataSnapshot(snapshot)
    const liveTagIds = (db.prepare('SELECT id FROM tags').all() as Array<{ id: number }>)
      .map((row) => row.id)
    revived.preexistingTagIds = [...new Set([...liveTagIds, ...revived.preexistingTagIds])]
    try {
      restoreDocumentMetadataMutationCAS(
        db,
        revived,
        current => snapshotRestoreOwnershipMatches(current, revived, journal),
      )
    } catch (error) {
      return result(journal, 'quarantined', `snapshot metadata CAS failed: ${(error as Error).message}`)
    }
  } else {
    try {
      moveDocumentMetadataPrefix(db, journal.srcRel, journal.destRel)
    } catch (error) {
      return result(journal, 'failed', `metadata prefix move failed: ${(error as Error).message}`)
    }
  }

  await hooks.afterMetadataMutationBeforeJournalRewrite?.()
  const metadataCommitted = {
    ...journal,
    phase: 'metadata-committed' as const,
  }
  try {
    await rewriteDurableJournal(journalAbs, metadataCommitted)
  } catch (error) {
    return result(metadataCommitted, 'failed', `metadata-committed journal rewrite failed: ${(error as Error).message}`)
  }
  await hooks.afterMetadataJournalRewriteBeforeFinalVerify?.()
  return finalizeFolderMoveV4Cleanup(
    db,
    journalAbs,
    metadataCommitted,
    srcAbs,
    destAbs,
    hooks,
  )
}
