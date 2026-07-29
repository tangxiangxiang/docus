import { promises as fs } from 'node:fs'

import {
  isSerializedMetadataSnapshot,
  validateFolderMoveGateProof,
  type FolderMoveJournalV4,
  type SerializedMetadataSnapshot,
} from './folderMoveTransaction.js'

/**
 * The parser's closed-graph check (`isSerializedMetadataSnapshot`)
 * requires stable-sorted top-level arrays. Production snapshots are
 * written sorted by `serializeMetadataSnapshot`, but a well-formed
 * snapshot whose rows arrive unsorted must still reach the trust
 * boundary so the actual reason (missing provenance, cross-row
 * mismatch, etc.) can be reported. Sort a shallow copy here — the
 * durable on-disk journal is unchanged.
 */
function sortSerializedSnapshotArrays(
  snapshot: SerializedMetadataSnapshot,
): SerializedMetadataSnapshot {
  return {
    ...snapshot,
    paths: [...snapshot.paths].sort(),
    documentIds: [...snapshot.documentIds].sort(),
    tagIds: [...snapshot.tagIds].sort((a, b) => a - b),
    preexistingTagIds: [...snapshot.preexistingTagIds].sort((a, b) => a - b),
  }
}

function normalizeGenerationDecimal(
  value: unknown,
  options: { positive: boolean },
): string | null {
  const pattern = options.positive ? /^[1-9]\d*$/ : /^\d+$/
  if (typeof value === 'string') {
    return pattern.test(value) ? value : null
  }
  // Compatibility with v4 journals written before exact decimal
  // strings. Unsafe numbers have already lost precision and cannot
  // prove a directory generation, so they fail closed.
  if (typeof value === 'number'
    && Number.isSafeInteger(value)
    && (options.positive ? value > 0 : value >= 0)) {
    return String(value)
  }
  return null
}

export function parseFolderMoveJournalV4Object(value: unknown): FolderMoveJournalV4 | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (entry.version !== 4) return null
  if (entry.op !== 'folder-rename' && entry.op !== 'folder-move') return null
  if (typeof entry.srcRel !== 'string' || typeof entry.destRel !== 'string') return null
  const sourceDev = normalizeGenerationDecimal(entry.sourceDev, { positive: false })
  const sourceIno = normalizeGenerationDecimal(entry.sourceIno, { positive: true })
  if (sourceDev === null || sourceIno === null) return null
  if (entry.phase !== 'prepared' && entry.phase !== 'gate-created'
    && entry.phase !== 'files-landed' && entry.phase !== 'metadata-committed') return null
  if (entry.strategy !== 'atomic-rename' && entry.strategy !== 'replayable-move') return null
  if (!Array.isArray(entry.entries) || !Array.isArray(entry.directories)) return null
  // directoryGenerations is optional for backwards compat but MUST have
  // every declared directory covered when present (sparse coverage is
  // not allowed — P1-3 weak legacy classification flags such journals).
  let directoryGenerations:
    import('./folderMoveDirectoryOwnership.js').FolderMoveDirectoryEntry[] | undefined
  if (entry.directoryGenerations !== undefined) {
    if (!Array.isArray(entry.directoryGenerations)) return null
    directoryGenerations = []
    const seenPath = new Set<string>()
    for (const raw of entry.directoryGenerations as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') return null
      const rel = raw.relativeDirectoryPath
      const dev = raw.sourceDev
      const ino = raw.sourceIno
      if (typeof rel !== 'string'
        || typeof dev !== 'string'
        || typeof ino !== 'string'
        || seenPath.has(rel)) return null
      seenPath.add(rel)
      directoryGenerations.push({
        relativeDirectoryPath: rel,
        sourceDev: dev,
        sourceIno: ino,
      })
    }
    if (directoryGenerations.length !== new Set(entry.directories as string[]).size) {
      return null
    }
  }
  if (entry.gateProof !== undefined && !validateFolderMoveGateProof(entry.gateProof)) return null
  if (typeof entry.metadataDisposition !== 'object' || entry.metadataDisposition === null) return null
  const disposition = entry.metadataDisposition as Record<string, unknown>
  if (disposition.kind === 'prefix-move') {
    if (disposition.transactionTimestamp !== undefined
      && (typeof disposition.transactionTimestamp !== 'number'
        || !Number.isSafeInteger(disposition.transactionTimestamp)
        || disposition.transactionTimestamp < 0)) return null
    if (disposition.preparedSnapshot !== undefined
      && !isSerializedMetadataSnapshot(disposition.preparedSnapshot)) return null
    if (disposition.committedSnapshot !== undefined
      && !isSerializedMetadataSnapshot(disposition.committedSnapshot)) return null
    if (entry.phase !== 'metadata-committed'
      && disposition.committedSnapshot !== undefined) return null
  } else if (disposition.kind === 'snapshot-restore') {
    // P1-2: durable snapshot sites require the closed-graph check —
    // top-level ID set equality, row set equality, duplicate detection,
    // cross-table references. The weaker row-schema check is no longer
    // acceptable for v4 durable snapshot persistence.
    //
    // Stable-sort is enforced by the trust boundary
    // (validateRound17SnapshotRestoreDisposition checks the sorted
    // footprint / physicalDocumentIds), not by the parser: production
    // snapshots are written sorted by serializeMetadataSnapshot, but a
    // snapshot whose rows are well-formed but arrived in a different
    // on-disk order must still reach the trust boundary so the actual
    // reason (e.g. metadata-only document lacks provenance) can be
    // reported. Sorting in the parser is a no-op for production data
    // and lets the trust boundary see the same shape it would have
    // seen for a sorted-on-disk journal.
    const sortedSnapshot = sortSerializedSnapshotArrays(disposition.snapshot as SerializedMetadataSnapshot)
    if (!isSerializedMetadataSnapshot(sortedSnapshot)) return null
    if (disposition.expectedCurrentSnapshot !== undefined
      && !isSerializedMetadataSnapshot(
        sortSerializedSnapshotArrays(
          disposition.expectedCurrentSnapshot as SerializedMetadataSnapshot))) return null
    if (disposition.physicalDocumentIds !== undefined
      && (!Array.isArray(disposition.physicalDocumentIds)
        || !disposition.physicalDocumentIds.every((id) =>
          typeof id === 'string' && id.length > 0)
        || new Set(disposition.physicalDocumentIds).size
          !== disposition.physicalDocumentIds.length)) return null
    const hasExpected = disposition.expectedCurrentSnapshot !== undefined
    const hasPhysicalIds = disposition.physicalDocumentIds !== undefined
    if (hasExpected !== hasPhysicalIds) return null
    const hasMetadataOnlyProofs =
      disposition.metadataOnlyDocumentProofs !== undefined
    const hasOwnershipFootprint =
      disposition.ownershipFootprint !== undefined
    if (hasMetadataOnlyProofs !== hasOwnershipFootprint) return null
    if (hasMetadataOnlyProofs) {
      if (!Array.isArray(disposition.metadataOnlyDocumentProofs)
        || !disposition.metadataOnlyDocumentProofs.every((proof) =>
          proof && typeof proof === 'object'
          && typeof (proof as Record<string, unknown>).documentId === 'string'
          && typeof (proof as Record<string, unknown>).path === 'string'
          && (
            (proof as Record<string, unknown>).reason === 'source-prefix'
            || (proof as Record<string, unknown>).reason === 'destination-prefix'
            || (proof as Record<string, unknown>).reason === 'reference-journal'
          ))) return null
      const footprint =
        disposition.ownershipFootprint as Record<string, unknown>
      if (!footprint || typeof footprint !== 'object'
        || !Array.isArray(footprint.paths)
        || !Array.isArray(footprint.documentIds)
        || !Array.isArray(footprint.tagIds)
        || !Array.isArray(footprint.migrationPaths)
        || !Array.isArray(footprint.migrationOriginalPaths)) return null
      if (disposition.referenceJournal !== undefined
        && (!disposition.referenceJournal
          || typeof disposition.referenceJournal !== 'object')) return null
      if (disposition.createdMetadataIds !== undefined) {
        const created = disposition.createdMetadataIds as Record<string, unknown>
        if (!created || typeof created !== 'object'
          || !Array.isArray(created.documentIds)
          || !Array.isArray(created.tagIds)) return null
      }
    }
  } else {
    return null
  }
  return {
    ...(entry as unknown as FolderMoveJournalV4),
    sourceDev,
    sourceIno,
    ...(directoryGenerations ? { directoryGenerations } : {}),
  }
}

export function parseDurableFolderMoveJournalV4(raw: string): FolderMoveJournalV4 | null {
  try {
    return parseFolderMoveJournalV4Object(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Read the journal that recovery will actually observe. Executor errors
 * carry their latest attempted in-memory phase, but an interrupted
 * rewrite may have left an older durable phase on disk. */
export async function readDurableFolderMoveJournalV4(
  journalAbs: string,
): Promise<FolderMoveJournalV4 | null> {
  try {
    return parseDurableFolderMoveJournalV4(await fs.readFile(journalAbs, 'utf8'))
  } catch {
    return null
  }
}
