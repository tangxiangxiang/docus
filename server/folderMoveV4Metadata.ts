import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Database as DatabaseT } from 'better-sqlite3'

import {
  removeDurableJournal,
  rewriteDurableJournal,
  verifyDirectoryGeneration,
} from './atomicTextWrite.js'
import {
  type DocumentMetadataMutationSnapshot,
  metadataSnapshotsExactlyEqual,
  moveDocumentMetadataPrefix,
  restoreDocumentMetadataMutationCAS,
  snapshotDocumentMetadataMutationCurrentOwnership,
  snapshotDocumentMetadataPrefixMutation,
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
  isSerializedMetadataSnapshot,
  reviveMetadataSnapshot,
  serializeMetadataSnapshot,
  validateRound17SnapshotRestoreDisposition,
  validateSnapshotPhysicalEntries,
  type FolderMoveJournalEntry,
  type FolderMoveJournalV4,
  type ParsedFolderRenameReferenceJournal,
} from './folderMoveTransaction.js'
import { readRenameReferenceJournal } from './renameReferenceJournal.js'

export type FolderMoveV4FinalizationResult = {
  completed: boolean
  action: 'completed-rename' | 'quarantined' | 'failed'
  detail: string
  journal: FolderMoveJournalV4
}

type FinalizationHooks = {
  beforeMetadataMutation?: () => void | Promise<void>
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

export async function validateDurableSnapshotRestoreDisposition(
  journalAbs: string,
  journal: FolderMoveJournalV4,
): Promise<string | null> {
  const disposition = journal.metadataDisposition
  if (disposition.kind !== 'snapshot-restore') return null
  const hasExpected = disposition.expectedCurrentSnapshot !== undefined
  const hasPhysical = disposition.physicalDocumentIds !== undefined
  const hasProofs = disposition.metadataOnlyDocumentProofs !== undefined
  const hasFootprint = disposition.ownershipFootprint !== undefined
  if (!hasExpected && !hasPhysical && !hasProofs && !hasFootprint) {
    return null
  }
  if (hasExpected && hasPhysical && !hasProofs && !hasFootprint) {
    return 'round17 snapshot-restore journal lacks durable metadata provenance'
  }
  let referenceJournal: ParsedFolderRenameReferenceJournal | undefined
  if (disposition.referenceJournal) {
    const candidate = await readRenameReferenceJournal(path.join(
      path.dirname(journalAbs),
      disposition.referenceJournal.relativePath,
    ))
    if (candidate?.op === 'folder-rename-references') {
      referenceJournal = {
        ...candidate,
        op: 'folder-rename-references',
        identities: candidate.identities ?? [],
      }
    }
  }
  return validateRound17SnapshotRestoreDisposition(
    journal,
    disposition,
    { referenceJournal },
  )
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
  const disposition = journal.metadataDisposition
  if (disposition.kind !== 'prefix-move') {
    return 'prefix metadata verifier received non-prefix disposition'
  }
  if (!disposition.committedSnapshot) {
    return 'metadata-committed prefix journal lacks exact committed snapshot'
  }
  const expected = reviveMetadataSnapshot(disposition.committedSnapshot)
  const current = snapshotDocumentMetadataMutationCurrentOwnership(db, expected)
  return metadataSnapshotsExactlyEqual(current, expected)
    ? null
    : 'live prefix metadata graph differs from committed snapshot'
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

function verifyRound17BCreatedMetadataCleanup(
  db: DatabaseT,
  disposition: Extract<
    FolderMoveJournalV4['metadataDisposition'],
    { kind: 'snapshot-restore' }
  >,
  live: DocumentMetadataMutationSnapshot,
  expected: DocumentMetadataMutationSnapshot,
): string | null {
  const created = disposition.createdMetadataIds
  if (!created) return null
  const createdDocumentIds = new Set(created.documentIds)
  if (live.documents.some(row => createdDocumentIds.has(String(row.id)))) {
    return 'metadata-committed snapshot graph verification failed: created document remains live'
  }
  if (live.documentTags.some(row =>
    createdDocumentIds.has(String(row.document_id)))) {
    return 'metadata-committed snapshot graph verification failed: created document_tag remains live'
  }
  if (live.embeddings.some(row =>
    createdDocumentIds.has(String(row.document_id)))) {
    return 'metadata-committed snapshot graph verification failed: created embedding remains live'
  }
  if (live.migrations.some(row =>
    createdDocumentIds.has(String(row.document_id))
    || (typeof row.path === 'string'
      && row.path.startsWith('@deleted/')
      && createdDocumentIds.has(row.path.slice('@deleted/'.length))))) {
    return 'metadata-committed snapshot graph verification failed: created migration ownership remains live'
  }

  const expectedTagIds = new Set(expected.tags.map(row => Number(row.id)))
  for (const tagId of created.tagIds) {
    if (expectedTagIds.has(tagId)) continue
    const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(tagId)
    if (!tag) continue
    const liveReference = db.prepare(
      'SELECT 1 FROM document_tags WHERE tag_id = ? LIMIT 1',
    ).get(tagId)
    if (!liveReference) {
      return 'metadata-committed snapshot graph verification failed: unreferenced created tag remains live'
    }
  }
  return null
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
  const live = snapshotDocumentMetadataMutationCurrentOwnership(db, snapshot)
  return metadataSnapshotsExactlyEqual(live, snapshot)
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
  hooks: Pick<FinalizationHooks, 'beforeJournalRemove'> = {},
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

  if (durableJournal.metadataDisposition.kind === 'snapshot-restore') {
    const disposition = durableJournal.metadataDisposition
    const provenanceError = await validateDurableSnapshotRestoreDisposition(
      journalAbs,
      durableJournal,
    )
    if (provenanceError) {
      return result(durableJournal, 'quarantined', provenanceError)
    }
    const isRound17B = disposition.ownershipFootprint !== undefined
      && disposition.metadataOnlyDocumentProofs !== undefined
    if (isRound17B
      ? !isSerializedMetadataSnapshot(disposition.snapshot)
      : !isValidDeleteRollbackSnapshot(disposition.snapshot, durableJournal.destRel)) {
      return result(durableJournal, 'quarantined', 'metadata-committed snapshot is invalid')
    }
    const revived = reviveMetadataSnapshot(disposition.snapshot)
    const liveTagIds = (db.prepare('SELECT id FROM tags').all() as Array<{ id: number }>)
      .map((row) => row.id)
    revived.preexistingTagIds = [...new Set([...liveTagIds, ...revived.preexistingTagIds])]
    const live = snapshotDocumentMetadataOwnership(
      db,
      disposition.ownershipFootprint?.paths ?? revived.paths,
      disposition.ownershipFootprint?.documentIds ?? revived.documentIds,
      disposition.ownershipFootprint?.tagIds ?? revived.tagIds,
      disposition.ownershipFootprint,
    )
    const createdCleanupError = verifyRound17BCreatedMetadataCleanup(
      db,
      disposition,
      live,
      revived,
    )
    if (createdCleanupError) {
      return result(durableJournal, 'quarantined', createdCleanupError)
    }
    const externallyReferencedCreatedTagIds = new Set(
      (disposition.createdMetadataIds?.tagIds ?? []).filter((tagId) =>
        !revived.tagIds.includes(tagId)
        && db.prepare(
          'SELECT 1 FROM document_tags WHERE tag_id = ? LIMIT 1',
        ).get(tagId) !== undefined),
    )
    const comparableLiveTags = live.tags.filter(row =>
      !externallyReferencedCreatedTagIds.has(Number(row.id)))
    if (!rowsExactlyEqualSnapshot(live.documents, revived.documents)
      || !rowsExactlyEqualSnapshot(comparableLiveTags, revived.tags)
      || !rowsExactlyEqualSnapshot(live.documentTags, revived.documentTags)
      || !rowsExactlyEqualSnapshot(live.embeddings, revived.embeddings)
      || !rowsExactlyEqualSnapshot(live.migrations, revived.migrations)) {
      return result(
        durableJournal,
        'quarantined',
        'metadata-committed snapshot graph verification failed: live graph differs from snapshot',
      )
    }
  } else {
    const metadataError = verifyPrefixMetadataCommitted(db, durableJournal)
    if (metadataError !== null) {
      return result(
        durableJournal,
        'quarantined',
        metadataError,
      )
    }
  }

  try {
    const sourceStat = await fs.lstat(srcAbs).catch(() => null)
    if (sourceStat !== null) {
      if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
        return result(durableJournal, 'quarantined', 'metadata-committed source path is not a real directory')
      }
      if ((await fs.readdir(srcAbs)).length > 0) {
        if (durableJournal.metadataDisposition.kind === 'prefix-move') {
          return result(
            durableJournal,
            'quarantined',
            'forward transaction committed but original source path was externally reused',
          )
        }
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

  await hooks.beforeMetadataMutation?.()
  if (durableJournal.metadataDisposition.kind === 'snapshot-restore') {
    const disposition = durableJournal.metadataDisposition
    const snapshot = disposition.snapshot
    const provenanceError = await validateDurableSnapshotRestoreDisposition(
      journalAbs,
      durableJournal,
    )
    if (provenanceError) {
      return result(durableJournal, 'quarantined', provenanceError)
    }
    const isRound17B = disposition.ownershipFootprint !== undefined
      && disposition.metadataOnlyDocumentProofs !== undefined
    if (isRound17B
      ? !isSerializedMetadataSnapshot(snapshot)
      : !isValidDeleteRollbackSnapshot(snapshot, durableJournal.destRel)) {
      return result(durableJournal, 'quarantined', 'snapshot-restore metadata disposition is invalid')
    }
    const entryError = validateSnapshotPhysicalEntries(
      snapshot,
      durableJournal.entries as unknown as FolderMoveJournalEntry[],
      durableJournal.destRel,
      {
        physicalDocumentIds: disposition.physicalDocumentIds,
      },
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
        current => disposition.expectedCurrentSnapshot
          ? metadataSnapshotsExactlyEqual(
              current,
              reviveMetadataSnapshot(disposition.expectedCurrentSnapshot),
            )
          : snapshotRestoreOwnershipMatches(current, revived, durableJournal),
        disposition.ownershipFootprint
          ? {
              ownershipFootprint: disposition.ownershipFootprint,
              createdMetadataIds: disposition.createdMetadataIds,
            }
          : undefined,
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
  let metadataCommitted: FolderMoveJournalV4 & {
    phase: 'metadata-committed'
  }
  if (durableJournal.metadataDisposition.kind === 'prefix-move') {
    let committedSnapshot: DocumentMetadataMutationSnapshot
    try {
      committedSnapshot = snapshotDocumentMetadataPrefixMutation(
        db,
        [durableJournal.srcRel, durableJournal.destRel],
        durableJournal.metadataDisposition.preparedSnapshot?.paths ?? [],
      )
    } catch (error) {
      return result(
        durableJournal,
        'failed',
        `committed metadata snapshot capture failed: ${(error as Error).message}`,
      )
    }
    metadataCommitted = {
      ...durableJournal,
      phase: 'metadata-committed',
      metadataDisposition: {
        ...durableJournal.metadataDisposition,
        committedSnapshot: serializeMetadataSnapshot(committedSnapshot),
      },
    }
  } else {
    metadataCommitted = {
      ...durableJournal,
      phase: 'metadata-committed',
    }
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
