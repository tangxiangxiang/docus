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
  removeFolderMoveGateProof,
  verifyFolderMoveGateProof,
} from './folderMoveGateProof.js'
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

async function proveDestinationOwnership(
  journalAbs: string,
  journal: FolderMoveJournalV4,
  destAbs: string,
  phaseLabel: string,
): Promise<
  | { journal: FolderMoveJournalV4; error?: never }
  | { journal?: never; error: string }
> {
  if (!journal.destDev || !journal.destIno) {
    return { error: `${phaseLabel} journal is missing final destination generation` }
  }
  if (journal.strategy === 'replayable-move' && journal.gateProof) {
    if (!await verifyFolderMoveGateProof(destAbs, journal.gateProof)) {
      return { error: 'replayable destination gate proof is missing or mismatched' }
    }
    let stat: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stat = await fs.lstat(destAbs, { bigint: true })
    } catch {
      return { error: 'replayable destination gate proof is missing or mismatched' }
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { error: 'replayable destination gate proof is missing or mismatched' }
    }
    const currentGeneration = {
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
    }
    if (journal.destDev !== currentGeneration.dev
      || journal.destIno !== currentGeneration.ino) {
      const refreshed = {
        ...journal,
        destDev: currentGeneration.dev,
        destIno: currentGeneration.ino,
      }
      try {
        await rewriteDurableJournal(journalAbs, refreshed)
      } catch (error) {
        return { error: `${phaseLabel} generation refresh failed: ${(error as Error).message}` }
      }
      return { journal: refreshed }
    }
    return { journal }
  }
  if (!await verifyDirectoryGeneration(destAbs, {
    dev: journal.destDev,
    ino: journal.destIno,
  })) {
    return { error: `${phaseLabel} destination generation does not match journal` }
  }
  return { journal }
}

function parityOptions(journal: FolderMoveJournalV4): {
  ignoredRelativePaths?: readonly string[]
} {
  return journal.strategy === 'replayable-move' && journal.gateProof
    ? { ignoredRelativePaths: [journal.gateProof.markerName] }
    : {}
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
  const ownership = await proveDestinationOwnership(
    journalAbs,
    journal,
    destAbs,
    'metadata-committed',
  )
  if (ownership.error) {
    return result(journal, 'quarantined', ownership.error)
  }
  const durableJournal = ownership.journal as FolderMoveJournalV4 & {
    phase: 'metadata-committed'
  }
  if (await verifyFolderMoveDestinationV4(
    destAbs,
    durableJournal,
    parityOptions(durableJournal),
  )) {
    return result(durableJournal, 'quarantined', 'metadata-committed destination exact parity failed')
  }

  if (!hooks.verifyMetadataGraph && durableJournal.metadataDisposition.kind === 'snapshot-restore') {
    if (!isValidDeleteRollbackSnapshot(durableJournal.metadataDisposition.snapshot, durableJournal.destRel)) {
      return result(durableJournal, 'quarantined', 'metadata-committed snapshot is invalid')
    }
    const revived = reviveMetadataSnapshot(durableJournal.metadataDisposition.snapshot)
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
        durableJournal,
        'quarantined',
        'metadata-committed snapshot graph verification failed: live graph differs from snapshot',
      )
    }
  } else if (!hooks.verifyMetadataGraph) {
    const metadataError = verifyPrefixMetadataCommitted(db, durableJournal)
    if (metadataError !== null) {
      return result(
        durableJournal,
        'quarantined',
        `metadata-committed prefix verification failed: ${metadataError}`,
      )
    }
  }
  if (hooks.verifyMetadataGraph && !hooks.verifyMetadataGraph()) {
    return result(durableJournal, 'quarantined', 'metadata-committed custom graph verification failed')
  }

  try {
    const sourceStat = await fs.lstat(srcAbs).catch(() => null)
    if (sourceStat !== null) {
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
        return result(durableJournal, 'quarantined', 'metadata-committed source path is not a real directory')
      }
      if ((await fs.readdir(srcAbs)).length > 0) {
        return result(durableJournal, 'quarantined', 'metadata-committed source directory still contains undeclared entries')
      }
      await fs.rmdir(srcAbs)
    }
    await hooks.beforeJournalRemove?.()
    await removeDurableJournal(journalAbs)
    if (durableJournal.strategy === 'replayable-move' && durableJournal.gateProof) {
      await removeFolderMoveGateProof(destAbs, durableJournal.gateProof).catch(() => {
        // A journal-less marker is harmless and startup recovery
        // removes it once no v4 journal references its exact name.
      })
    }
  } catch (error) {
    return result(durableJournal, 'failed', `v4 final cleanup failed: ${(error as Error).message}`)
  }
  return result(durableJournal, 'completed-rename', 'v4 metadata-committed transaction verified and cleaned')
}

export async function completeFolderMoveV4Metadata(
  db: DatabaseT,
  journalAbs: string,
  journal: FolderMoveJournalV4 & { phase: 'files-landed' },
  srcAbs: string,
  destAbs: string,
  hooks: FinalizationHooks = {},
): Promise<FolderMoveV4FinalizationResult> {
  const ownership = await proveDestinationOwnership(
    journalAbs,
    journal,
    destAbs,
    'files-landed',
  )
  if (ownership.error) {
    return result(journal, 'quarantined', ownership.error)
  }
  const durableJournal = ownership.journal as FolderMoveJournalV4 & {
    phase: 'files-landed'
  }
  if (await verifyFolderMoveDestinationV4(
    destAbs,
    durableJournal,
    parityOptions(durableJournal),
  )) {
    return result(durableJournal, 'quarantined', 'files-landed physical parity failed before metadata commit')
  }

  if (hooks.metadataAction) {
    try {
      hooks.metadataAction()
    } catch (error) {
      return result(durableJournal, 'failed', `custom metadata action failed: ${(error as Error).message}`)
    }
  } else if (durableJournal.metadataDisposition.kind === 'snapshot-restore') {
    const snapshot = durableJournal.metadataDisposition.snapshot
    if (!isValidDeleteRollbackSnapshot(snapshot, durableJournal.destRel)) {
      return result(durableJournal, 'quarantined', 'snapshot-restore metadata disposition is invalid')
    }
    const entryError = validateSnapshotPhysicalEntries(
      snapshot,
      durableJournal.entries as unknown as FolderMoveJournalEntry[],
      durableJournal.destRel,
    )
    if (entryError !== null) {
      return result(durableJournal, 'quarantined', `snapshot physical entries are invalid: ${entryError}`)
    }
    const revived = reviveMetadataSnapshot(snapshot)
    const liveTagIds = (db.prepare('SELECT id FROM tags').all() as Array<{ id: number }>)
      .map((row) => row.id)
    revived.preexistingTagIds = [...new Set([...liveTagIds, ...revived.preexistingTagIds])]
    try {
      restoreDocumentMetadataMutationCAS(
        db,
        revived,
        current => snapshotRestoreOwnershipMatches(current, revived, durableJournal),
      )
    } catch (error) {
      return result(durableJournal, 'quarantined', `snapshot metadata CAS failed: ${(error as Error).message}`)
    }
  } else {
    try {
      moveDocumentMetadataPrefix(db, durableJournal.srcRel, durableJournal.destRel)
    } catch (error) {
      return result(durableJournal, 'failed', `metadata prefix move failed: ${(error as Error).message}`)
    }
  }

  await hooks.afterMetadataMutationBeforeJournalRewrite?.()
  const metadataCommitted = {
    ...durableJournal,
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
