// The durable folder-move transaction shared by every directory move
// the program performs — the folder rename route (forward AND its
// rollback), the rename-reference recovery rollback, and the folder
// delete rollback. ONE persisted schema, imported by the routes, the
// recovery parser, and the crash fixtures:
//
//   * `strategy` is the runtime DirectoryMoveStrategy itself — the
//     route persists exactly what the mover runs and the parser
//     accepts (round-7 P0: the route wrote 'replayable-move' while the
//     parser only accepted 'replayable', orphaning every real journal);
//   * `entries` cover EVERY physical regular file the mover touches —
//     not just markdown (round-7 P1: the mover moved images/attachments
//     the journal never recorded, so a crash mid-move stranded them
//     with no reconciliation proof); empty trees carry `emptyTree`;
//   * every replayable reverse move (rename rollback, reference
//     rollback, delete rollback) gets its own durable journal BEFORE
//     the first file moves — a crash mid-rollback completes forward
//     from the journal instead of leaving a split tree nothing
//     describes (round-7 P1).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { sha256HexBuffer } from './atomicTextWrite.js'
import type { DocumentMetadataMutationSnapshot } from './documentMetadata.js'
import { UnsupportedDirectoryMoveError } from './documentFileLifecycle.js'

/** One physically moved file in a folder-move journal (schema v2).
 * `relativeFilePath` keeps the real extension — recovery never appends
 * '.md'. `documentId`/`documentPath` exist ONLY for markdown documents
 * bound to metadata; attachments move without an identity. The pair is
 * all-or-nothing per entry. */
export type FolderMoveJournalEntry = {
  relativeFilePath: string
  sourceHash: string
  documentId?: string
  documentPath?: string
}

/** The metadata outcome a completed move must produce. Rename moves
 * (forward and rollback) shift the live prefix; a delete rollback
 * re-installs the exact snapshot the delete detached (embeddings
 * included — base64-marked so the JSON journal round-trips Buffers). */
export type FolderMoveMetadataDisposition =
  | { kind: 'prefix-move' }
  | { kind: 'snapshot-restore'; snapshot: SerializedMetadataSnapshot }

export type SerializedMetadataSnapshot = {
  paths: string[]
  documentIds: string[]
  tagIds: number[]
  preexistingTagIds: number[]
  documents: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  documentTags: Record<string, unknown>[]
  embeddings: Record<string, unknown>[]
  migrations: Record<string, unknown>[]
}

const BUFFER_MARKER = '__docusBuffer'

function encodeBufferValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { [BUFFER_MARKER]: value.toString('base64') }
  if (value instanceof Uint8Array) return { [BUFFER_MARKER]: Buffer.from(value).toString('base64') }
  return value
}

function decodeBufferValue(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)[BUFFER_MARKER] === 'string') {
    return Buffer.from((value as Record<string, string>)[BUFFER_MARKER], 'base64')
  }
  return value
}

function mapRow(row: Record<string, unknown>, convert: (value: unknown) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[key] = convert(value)
  return out
}

/** Serialize a metadata mutation snapshot for a durable journal. Only
 * binary columns (embedding vectors) need marking — metadata, never
 * draft bodies, travels through the journal. */
export function serializeMetadataSnapshot(snapshot: DocumentMetadataMutationSnapshot): SerializedMetadataSnapshot {
  return {
    paths: [...snapshot.paths],
    documentIds: [...snapshot.documentIds],
    tagIds: [...snapshot.tagIds],
    preexistingTagIds: [...snapshot.preexistingTagIds],
    documents: snapshot.documents.map((row) => mapRow(row, encodeBufferValue)),
    tags: snapshot.tags.map((row) => mapRow(row, encodeBufferValue)),
    documentTags: snapshot.documentTags.map((row) => mapRow(row, encodeBufferValue)),
    embeddings: snapshot.embeddings.map((row) => mapRow(row, encodeBufferValue)),
    migrations: snapshot.migrations.map((row) => mapRow(row, encodeBufferValue)),
  }
}

export function reviveMetadataSnapshot(serialized: SerializedMetadataSnapshot): DocumentMetadataMutationSnapshot {
  return {
    paths: [...serialized.paths],
    documentIds: [...serialized.documentIds],
    tagIds: [...serialized.tagIds],
    preexistingTagIds: [...serialized.preexistingTagIds],
    documents: serialized.documents.map((row) => mapRow(row, decodeBufferValue)),
    tags: serialized.tags.map((row) => mapRow(row, decodeBufferValue)),
    documentTags: serialized.documentTags.map((row) => mapRow(row, decodeBufferValue)),
    embeddings: serialized.embeddings.map((row) => mapRow(row, decodeBufferValue)),
    migrations: serialized.migrations.map((row) => mapRow(row, decodeBufferValue)),
  }
}

/** Enumerate EVERY regular file under dirAbs with its content hash —
 * the journal must cover exactly what the mover will move: markdown,
 * images, PDFs, any attachment. A symlink/junction or special entry
 * cannot move create-only (link(2) would FOLLOW it outside the tree):
 * fail closed before anything is journaled or moved. */
export async function listPhysicalMoveEntries(
  dirAbs: string,
  identityFor?: (relativeFilePath: string) => { documentId: string; documentPath: string } | null,
): Promise<FolderMoveJournalEntry[]> {
  const entries: FolderMoveJournalEntry[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of dirents) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), entryRel)
      } else if (entry.isFile()) {
        const raw = await fs.readFile(path.join(dir, entry.name))
        const item: FolderMoveJournalEntry = { relativeFilePath: entryRel, sourceHash: sha256HexBuffer(raw) }
        const identity = identityFor?.(entryRel)
        if (identity) {
          item.documentId = identity.documentId
          item.documentPath = identity.documentPath
        }
        entries.push(item)
      } else {
        throw new UnsupportedDirectoryMoveError(`unsupported entry inside the moved folder: ${entryRel}`)
      }
    }
  }
  await walk(dirAbs, '')
  entries.sort((a, b) => a.relativeFilePath.localeCompare(b.relativeFilePath))
  return entries
}
