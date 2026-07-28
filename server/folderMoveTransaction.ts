// The durable folder-move transaction shared by every directory move
// the program performs — the folder rename route (forward AND its
// rollback), the rename-reference recovery rollback, and the folder
// delete rollback. ONE persisted schema, imported by the routes, the
// recovery parser, and the crash fixtures:
//
//   * `strategy` is the runtime DirectoryMoveStrategy itself — the
//     route persists exactly what the mover runs and the parser
//     accepts (round-7 P0);
//   * `entries` cover EVERY physical regular file the mover touches —
//     not just markdown (round-7 P1); empty trees carry `emptyTree`;
//   * `directories` cover EVERY subdirectory, including empty ones
//     (round-8 P1); v2 directories were optional → ambiguous; v3
//     enforces mandatory, sorted, ancestor-closed directories (round-9
//     F6);
//   * every replayable reverse move gets its own durable journal
//     BEFORE the first file moves (round-7 P1);
//   * v3 (round-9 F1–F6) promotes the gate token from a predictable
//     name to unpredictable content persisted in the journal so
//     recovery can verify the exact bytes, not just the filename;
//   * v3 entries persist source dev/ino so recovery can distinguish a
//     byte-identical external replacement from the original landed
//     generation — hash alone cannot tell them apart (round-9 F4).
//
// v4 (round-11) replaces the v3 gate-token-on-disk ownership proof
// with a destination-directory (dev, ino) plus a four-state phase
// machine (prepared → gate-created → files-landed → metadata-committed).
// State MUST be inferred from the persisted phase, never from the
// presence/absence of a token file. v1–v3 journals remain parseable
// for backwards-compat recovery but quarantine when their weak
// generation proof is insufficient.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { sha256HexBuffer } from './atomicTextWrite.js'
import type { DocumentMetadataMutationSnapshot } from './documentMetadata.js'
import { UnsupportedDirectoryMoveError } from './documentFileLifecycle.js'

/** One physically moved file in a folder-move journal (schema v2/v3).
 * `relativeFilePath` keeps the real extension — recovery never appends
 * '.md'. `documentId`/`documentPath` exist ONLY for markdown documents
 * bound to metadata; attachments move without an identity. The pair is
 * all-or-nothing per entry. v3 adds `sourceDev`/`sourceIno` (string)
 * for generation-proof verification on replay. */
export type FolderMoveJournalEntry = {
  relativeFilePath: string
  sourceHash: string
  documentId?: string
  documentPath?: string
  sourceDev?: string
  sourceIno?: string
}

/** The physical enumeration a journal persists: every regular file
 * (with content hash) AND every subdirectory (including empty ones). */
export type FolderMoveEnumeration = {
  entries: FolderMoveJournalEntry[]
  directories: string[]
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

/** Generate an unpredictable gate-token secret (32 random bytes → 64
 * hex chars). The journal persists it so recovery can verify the exact
 * bytes inside the gate marker file — an external writer who plants a
 * file with the correct name but wrong content is detected (round-9
 * F2). */
export function generateGateTokenSecret(): string {
  return randomBytes(32).toString('hex')
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

// Fixed table column allowlists (server/migrations). A persisted
// snapshot row may carry EXACTLY these keys — nothing else. An unknown
// column would either fail the INSERT or silently map to a column the
// schema gains later; a row is rejected unless every key is allowed.
const DOCUMENT_COLUMNS = new Set(['id', 'path', 'title', 'summary', 'created_at', 'updated_at'])
const TAG_COLUMNS = new Set(['id', 'name', 'normalized_name'])
const DOCUMENT_TAG_COLUMNS = new Set(['document_id', 'tag_id'])
const EMBEDDING_COLUMNS = new Set(['document_id', 'content_hash', 'model', 'embedding', 'indexed_at'])
const MIGRATION_COLUMNS = new Set([
  'path', 'document_id', 'original_path', 'status', 'source_hash', 'error', 'updated_at', 'frontmatter_backup', 'cleaned_hash',
])

function exactColumns(row: unknown, allowed: Set<string>): row is Record<string, unknown> {
  if (!row || typeof row !== 'object') return false
  const keys = Object.keys(row)
  return keys.length > 0 && keys.every((key) => allowed.has(key))
}

function setEquals(a: Set<unknown>, b: Set<unknown>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/**
 * Trust boundary for a persisted delete-rollback snapshot (round-8 P0).
 * `restoreDocumentMetadataMutation` deletes every row matching the
 * snapshot's paths/ids and re-inserts the snapshot rows verbatim — so a
 * forged journal could delete or replace metadata anywhere in the vault
 * unless the snapshot is proven to describe ONLY the folder being
 * restored (`destRel`). Every constraint below is required; any failure
 * makes the journal unparseable so recovery never touches the DB:
 *
 *   * paths all sit inside the destRel subtree;
 *   * documents[].path ∈ paths and documents[].id ∈ documentIds, and
 *     set(documentIds) === set(documents[].id) exactly (a deleted id
 *     always carries its row, and no foreign id is deletable);
 *   * document_tags / embeddings reference only those documentIds (and
 *     tag_ids only the declared tags);
 *   * set(tags[].id) === set(tagIds) exactly;
 *   * migrations reference only the same paths / ids;
 *   * every row carries exactly its table's columns.
 */
export function isValidDeleteRollbackSnapshot(snapshot: unknown, destRel: string): snapshot is SerializedMetadataSnapshot {
  if (!snapshot || typeof snapshot !== 'object') return false
  const item = snapshot as Partial<SerializedMetadataSnapshot>
  const isArrayOf = (value: unknown, check: (element: unknown) => boolean): boolean =>
    Array.isArray(value) && value.every(check)
  // Scalar arrays.
  if (!isArrayOf(item.paths, (e) => typeof e === 'string')) return false
  if (!isArrayOf(item.documentIds, (e) => typeof e === 'string' && (e as string).length > 0)) return false
  if (!isArrayOf(item.tagIds, (e) => typeof e === 'number' && Number.isInteger(e))) return false
  if (!isArrayOf(item.preexistingTagIds, (e) => typeof e === 'number' && Number.isInteger(e))) return false
  // Row arrays with exact column shapes.
  if (!isArrayOf(item.documents, (e) => exactColumns(e, DOCUMENT_COLUMNS))) return false
  if (!isArrayOf(item.tags, (e) => exactColumns(e, TAG_COLUMNS))) return false
  if (!isArrayOf(item.documentTags, (e) => exactColumns(e, DOCUMENT_TAG_COLUMNS))) return false
  if (!isArrayOf(item.embeddings, (e) => exactColumns(e, EMBEDDING_COLUMNS))) return false
  if (!isArrayOf(item.migrations, (e) => exactColumns(e, MIGRATION_COLUMNS))) return false

  const paths = item.paths as string[]
  const documentIds = item.documentIds as string[]
  const tagIds = item.tagIds as number[]
  const documents = item.documents as Record<string, unknown>[]
  const tags = item.tags as Record<string, unknown>[]
  const documentTags = item.documentTags as Record<string, unknown>[]
  const embeddings = item.embeddings as Record<string, unknown>[]
  const migrations = item.migrations as Record<string, unknown>[]

  // Every path is inside the restored folder's subtree — never a
  // sibling or an unrelated document.
  const inSubtree = (p: unknown): boolean => typeof p === 'string' && p.startsWith(`${destRel}/`)
  if (!paths.every(inSubtree)) return false

  // documentIds and documents[].id are the SAME set; every document
  // path is one of the declared (subtree) paths.
  const pathSet = new Set(paths)
  const idSet = new Set(documentIds)
  const documentIdSet = new Set(documents.map((row) => row.id))
  if (!setEquals(idSet, documentIdSet)) return false
  if (!documents.every((row) => typeof row.id === 'string' && typeof row.path === 'string' && pathSet.has(row.path) && inSubtree(row.path))) return false

  // tags[].id is exactly the declared tagIds.
  const tagIdSet = new Set(tagIds)
  if (!setEquals(new Set(tags.map((row) => row.id)), tagIdSet)) return false

  // document_tags / embeddings reference only declared ids.
  if (!documentTags.every((row) => typeof row.document_id === 'string' && idSet.has(row.document_id)
    && typeof row.tag_id === 'number' && tagIdSet.has(row.tag_id))) return false
  if (!embeddings.every((row) => typeof row.document_id === 'string' && idSet.has(row.document_id))) return false

  // migrations reference only this transaction's paths / ids. A
  // migration path is either a subtree path or the `@deleted/<id>`
  // tombstone of a declared id; document_id (when set) is declared;
  // original_path (when non-empty) is a subtree path.
  for (const row of migrations) {
    const mPath = row.path
    const okPath = inSubtree(mPath) || (typeof mPath === 'string' && mPath.startsWith('@deleted/') && idSet.has(mPath.slice('@deleted/'.length)))
    if (!okPath) return false
    if (row.document_id !== null && row.document_id !== undefined) {
      if (typeof row.document_id !== 'string' || !idSet.has(row.document_id)) return false
    }
    if (row.original_path !== '' && row.original_path !== undefined && !inSubtree(row.original_path)) return false
  }
  return true
}

/** Enumerate EVERY regular file (with content hash) AND every
 * subdirectory under dirAbs — the journal must cover exactly what the
 * mover will move and recreate: markdown, images, PDFs, any attachment,
 * and empty directories (visible vault state). A symlink/junction or
 * special entry cannot move create-only (link(2) would FOLLOW it
 * outside the tree): fail closed before anything is journaled or
 * moved. */
export async function listPhysicalMoveEntries(
  dirAbs: string,
  identityFor?: (relativeFilePath: string) => { documentId: string; documentPath: string } | null,
): Promise<FolderMoveEnumeration> {
  const entries: FolderMoveJournalEntry[] = []
  const directories: string[] = []
  const walk = async (dir: string, rel: string): Promise<void> => {
    const dirents = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of dirents) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        directories.push(entryRel)
        await walk(path.join(dir, entry.name), entryRel)
      } else if (entry.isFile()) {
        const raw = await fs.readFile(path.join(dir, entry.name))
        const stat = await fs.stat(path.join(dir, entry.name), { bigint: true })
        const item: FolderMoveJournalEntry = {
          relativeFilePath: entryRel,
          sourceHash: sha256HexBuffer(raw),
          sourceDev: stat.dev.toString(),
          sourceIno: stat.ino.toString(),
        }
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
  directories.sort((a, b) => a.localeCompare(b))
  return { entries, directories }
}

// ---- v3 markdown identity schema enforcement (round-10 F6) ----

/** Round-10 F6: every journal entry's identity pairing must be exact.
 *
 *   * Markdown entries (.md) MUST carry BOTH `documentId` and
 *     `documentPath`. The `documentPath` must equal the journaled
 *     subtree root + this entry's relative path without its `.md`
 *     extension — so an attacker cannot bind a foreign identity to a
 *     physical attachment (image.bin → documentPath="...") and get
 *     the rollback / recovery to move metadata that doesn't belong to
 *     the bytes on disk.
 *
 *   * Attachment entries (non-.md) MUST NOT carry either field —
 *     image.bin with a documentId would let a malicious journal claim
 *     metadata ownership of a non-markdown file.
 *
 * Returns null on success or a reason string on failure. */
export function validateJournalEntriesV3(
  entries: readonly FolderMoveJournalEntry[],
  srcRel: string,
): string | null {
  for (const entry of entries) {
    const rel = entry.relativeFilePath
    const isMarkdown = rel.endsWith('.md')
    const hasDocumentId = entry.documentId !== undefined && entry.documentId !== null && entry.documentId !== ''
    const hasDocumentPath = entry.documentPath !== undefined && entry.documentPath !== null && entry.documentPath !== ''
    if (isMarkdown) {
      if (!hasDocumentId || !hasDocumentPath) {
        return `markdown entry missing identity: ${rel}`
      }
      // documentPath must equal srcRel + "/" + rel without .md
      const expectedPath = `${srcRel}/${rel.slice(0, -'.md'.length)}`
      if (entry.documentPath !== expectedPath) {
        return `markdown entry documentPath mismatch: ${rel} declared ${entry.documentPath} expected ${expectedPath}`
      }
    } else {
      if (hasDocumentId || hasDocumentPath) {
        return `attachment carrying markdown identity: ${rel}`
      }
    }
  }
  return null
}

// ---- v3 directory-manifest validation (round-9 F6) ----

/** Reserved path segments that no journaled file or directory is
 * allowed to claim (round-10 F9). These names belong to vault internals
 * — moving them through a folder-move journal could let an attacker
 * bind a Docus identity to an internal artifact or shadow a real
 * document. */
export const RESERVED_PATH_SEGMENTS = [
  '.git',
  'node_modules',
  '.docus-journal-',
  '.docus-folder-gate-',
  '.docus-rename-',
  '.docus-staged-',
  '.docus-delete-inflight-',
  '.docus-quarantine-reuse-',
  '.docus-delete-manifest-',
  'metadata.sqlite',
]

/** Validate a v3 `directories` manifest: must be non-null, sorted, no
 * duplicates, every file's parent and every directory's ancestor must
 * be declared, and no path can be simultaneously a file and a
 * directory. Returns null on success or a reason string on failure. */
export function validateDirectoryManifest(
  directories: string[],
  entryRels: string[],
  reservedPrefixes: string[] = [],
): string | null {
  // Must be present (even if empty).
  if (!Array.isArray(directories)) return 'directories missing'
  // No duplicates; canonical sorted order.
  if (new Set(directories).size !== directories.length) return 'duplicate directory'
  const sorted = [...directories].sort((a, b) => a.localeCompare(b))
  for (let i = 0; i < directories.length; i++) {
    if (directories[i] !== sorted[i]) return 'directories not sorted'
  }
  const dirSet = new Set(directories)
  const allReserved = [...RESERVED_PATH_SEGMENTS, ...reservedPrefixes]
  // Every directory entry must be a valid relative path.
  for (const dir of directories) {
    if (!dir || dir.startsWith('/') || dir.endsWith('/') || dir.includes('\\') || dir.includes('\0')) return `invalid directory path: ${dir}`
    const segments = dir.split('/')
    if (segments.some((s) => s.length === 0 || s === '.' || s === '..')) return `invalid directory path: ${dir}`
    // Reserved names.
    for (const prefix of allReserved) {
      if (segments.some((s) => s === prefix || s.startsWith(prefix))) return `reserved directory segment: ${dir}`
    }
  }
  // No file path is also a directory path; and no file path is reserved.
  for (const fileRel of entryRels) {
    if (dirSet.has(fileRel)) return `file path also listed as directory: ${fileRel}`
    const segments = fileRel.split('/')
    if (segments.some((s) => s.length === 0 || s === '.' || s === '..')) return `invalid file path: ${fileRel}`
    for (const prefix of allReserved) {
      if (segments.some((s) => s === prefix || s.startsWith(prefix))) return `reserved file segment: ${fileRel}`
    }
  }
  // Every file's parent directories must be declared.
  for (const fileRel of entryRels) {
    const parts = fileRel.split('/')
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/')
      if (!dirSet.has(ancestor)) return `missing file parent directory: ${ancestor} (required by ${fileRel})`
    }
  }
  // Every directory's ancestor must be declared (ancestor closure).
  for (const dir of directories) {
    const parts = dir.split('/')
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join('/')
      if (!dirSet.has(ancestor)) return `missing directory ancestor: ${ancestor} (required by ${dir})`
    }
  }
  // No directory is listed under a file path.
  for (const dir of directories) {
    for (const fileRel of entryRels) {
      if (dir.startsWith(`${fileRel}/`)) return `directory ${dir} is underneath file ${fileRel}`
    }
  }
  return null
}

/** Verify a snapshot's Markdown document entries each have at least
 * one corresponding physical Markdown entry in the journal — and the
 * physical entry binds the EXACT documentId AND documentPath the
 * snapshot declares. Round-10 F7: a snapshot document claiming a path
 * without any journal entry backing it cannot be verified, AND a
 * physical entry whose identity does not match the snapshot row is a
 * forged journal. The journal must be quarantined. */
export function validateSnapshotPhysicalEntries(
  snapshot: SerializedMetadataSnapshot,
  entries: FolderMoveJournalEntry[],
  destRel: string,
): string | null {
  // Index physical entries by the documentPath they claim. Each md
  // physical entry is keyed by both documentId and documentPath so the
  // snapshot must match BOTH, not just one.
  const byDocId = new Map<string, FolderMoveJournalEntry>()
  const byDocPath = new Map<string, FolderMoveJournalEntry>()
  for (const entry of entries) {
    if (entry.documentId !== undefined && entry.documentPath !== undefined) {
      byDocId.set(entry.documentId, entry)
      byDocPath.set(entry.documentPath, entry)
    }
  }
  for (const doc of snapshot.documents) {
    const docPath = doc.path as string
    const docId = doc.id as string
    if (!docPath.startsWith(`${destRel}/`)) return `snapshot document path outside destRel: ${docPath}`
    // For each (id, path) the snapshot declares, BOTH lookups must
    // succeed AND they must resolve to the SAME physical entry —
    // the entry that binds this id to this path.
    const byId = byDocId.get(docId)
    const byPath = byDocPath.get(docPath)
    if (!byId && !byPath) {
      return `snapshot document has no physical entry: ${docPath} (${docId})`
    }
    if (!byId) return `snapshot document id has no physical entry: ${docId}`
    if (!byPath) return `snapshot document path has no physical entry: ${docPath}`
    if (byId !== byPath) return `snapshot document identity/path binding disagrees with journal: ${docPath} (${docId})`
    if (byId.documentId !== docId) return `snapshot document id disagrees with journal: ${docId} vs ${byId.documentId}`
    if (byId.documentPath !== docPath) return `snapshot document path disagrees with journal: ${docPath} vs ${byId.documentPath}`
  }
  return null
}

// =================== round-11 v4 phase-machine surface ===================

/** Schema version for the phase-machine folder-move journal. The route
 * persists exactly this number; the Recovery parser accepts 1, 2, 3
 * (legacy) and 4. v1–v3 quarantine when their weak generation proof
 * is insufficient — v4 is the only version that drives the full
 * prepared → gate-created → files-landed → metadata-committed
 * state machine. */
export const FOLDER_MOVE_JOURNAL_VERSION = 4 as const

/** Folder-move transaction phase. The journal is the ONLY source of
 * truth for the current phase; absence-of-marker, presence-of-marker,
 * source-doesn't-exist, etc. are NEVER used to infer phase. */
export type FolderMovePhase =
  | 'prepared'
  | 'gate-created'
  | 'files-landed'
  | 'metadata-committed'

/** Generation proof for a single physical file: (device, inode,
 * content-hash). All three must match before any link(2) /
 * restore-from-staging syscall. */
export type FileGeneration = {
  dev: string
  ino: string
  hash: string
}

/** Generation proof for a directory: (device, inode). The directory
 * must be empty AND carry this proof to be considered a "gate" the
 * route created. */
export type DirectoryGeneration = {
  dev: string
  ino: string
}

/** v4 per-file entry. Markdown entries MAY carry (documentId,
 * documentPath) — same as v3 — and v4 adds mandatory (sourceDev,
 * sourceIno, sourceHash) so byte-identical external replacements are
 * still detectable. */
export type FolderMoveJournalEntryV4 = {
  relativeFilePath: string
  sourceDev: string
  sourceIno: string
  sourceHash: string
  documentId?: string
  documentPath?: string
}

/** v4 journal — the durable, single-source-of-truth record of a
 * folder-move transaction. Ownership proof = destination directory
 * (dev, ino) + per-entry (sourceDev, sourceIno, sourceHash). */
export type FolderMoveJournalV4 = {
  version: typeof FOLDER_MOVE_JOURNAL_VERSION
  op: 'folder-rename' | 'folder-move'
  phase: FolderMovePhase
  srcRel: string
  destRel: string
  strategy: import('./documentFileLifecycle.js').FolderMoveJournalStrategy
  sourceDev: string
  sourceIno: string
  /**
   * phase=prepared: MUST be undefined.
   * phase=gate-created, files-landed, metadata-committed: REQUIRED
   * — the route persists the destination's (dev, ino) immediately
   * after `mkdir` so recovery can prove ownership without reading
   * any token file inside the destination.
   */
  destDev?: string
  destIno?: string
  emptyTree?: true
  entries: FolderMoveJournalEntryV4[]
  directories: string[]
  metadataDisposition: FolderMoveMetadataDisposition
}

/** Validate the v4 phase shape: prepared MUST NOT carry destination
 * generation; gate-created and onward MUST carry a well-formed
 * destDev/destIno. Returns null on success, a reason string on
 * failure. */
export function validateFolderMovePhaseShape(
  journal: FolderMoveJournalV4,
): string | null {
  const hasDestinationGeneration =
    typeof journal.destDev === 'string'
    && /^\d+$/.test(journal.destDev)
    && typeof journal.destIno === 'string'
    && /^[1-9]\d*$/.test(journal.destIno)

  if (journal.phase === 'prepared') {
    if (journal.destDev !== undefined || journal.destIno !== undefined) {
      return 'prepared journal must not carry destination generation'
    }
    return null
  }

  if (!hasDestinationGeneration) {
    return `${journal.phase} journal is missing destination generation`
  }
  return null
}

const SHA256_RE = /^[0-9a-f]{64}$/
const DECIMAL_RE = /^\d+$/
const POSITIVE_DECIMAL_RE = /^[1-9]\d*$/

export function validateSourceDirectoryGeneration(
  journal: FolderMoveJournalV4,
): string | null {
  if (!DECIMAL_RE.test(journal.sourceDev)) {
    return 'sourceDev must be a decimal string'
  }
  if (!POSITIVE_DECIMAL_RE.test(journal.sourceIno)) {
    return 'sourceIno must be a positive decimal string'
  }
  return null
}

function validRelativePath(value: string): boolean {
  if (!value
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('\0')) {
    return false
  }
  return value
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

/** Validate the per-entry shape of a v4 journal. Mandatory fields:
 *   * relativeFilePath: valid relative path, no duplicates within
 *     the journal
 *   * sourceHash: 64-char lowercase hex
 *   * sourceDev: non-negative decimal string
 *   * sourceIno: positive decimal string
 * Markdown entries MUST carry (documentId, documentPath) where
 * documentPath = srcRel + '/' + rel.slice(0, -'.md'.length).
 * Attachments MUST NOT carry either field.
 * When `skipDocumentPathValidation` is true, the documentPath
 * identity check against srcRel is skipped (used for snapshot-restore
 * journals where srcRel is a staging name, not a real folder path). */
export function validateJournalEntriesV4(
  entries: readonly FolderMoveJournalEntryV4[],
  srcRel: string,
  skipDocumentPathValidation = false,
): string | null {
  if (!Array.isArray(entries)) {
    return 'entries must be an array'
  }

  const paths = new Set<string>()
  const documentIds = new Set<string>()
  const documentPaths = new Set<string>()

  for (const entry of entries) {
    if (!validRelativePath(entry.relativeFilePath)) {
      return `invalid physical entry path: ${entry.relativeFilePath}`
    }
    if (paths.has(entry.relativeFilePath)) {
      return `duplicate physical entry path: ${entry.relativeFilePath}`
    }
    paths.add(entry.relativeFilePath)

    if (!SHA256_RE.test(entry.sourceHash)) {
      return `invalid sourceHash: ${entry.relativeFilePath}`
    }
    if (!DECIMAL_RE.test(entry.sourceDev)) {
      return `invalid sourceDev: ${entry.relativeFilePath}`
    }
    if (!POSITIVE_DECIMAL_RE.test(entry.sourceIno)) {
      return `invalid sourceIno: ${entry.relativeFilePath}`
    }

    const markdown = entry.relativeFilePath.endsWith('.md')
    const hasId = typeof entry.documentId === 'string' && entry.documentId.length > 0
    const hasPath = typeof entry.documentPath === 'string' && entry.documentPath.length > 0

    if (markdown) {
      if (!hasId || !hasPath) {
        return `markdown entry missing identity: ${entry.relativeFilePath}`
      }
      if (!skipDocumentPathValidation) {
        const expectedDocumentPath = `${srcRel}/${entry.relativeFilePath.slice(0, -'.md'.length)}`
        if (entry.documentPath !== expectedDocumentPath) {
          return `markdown entry documentPath mismatch: ${entry.relativeFilePath}; expected ${expectedDocumentPath}, received ${entry.documentPath}`
        }
      }
      if (documentIds.has(entry.documentId as string)) {
        return `duplicate documentId: ${entry.documentId}`
      }
      if (documentPaths.has(entry.documentPath as string)) {
        return `duplicate documentPath: ${entry.documentPath}`
      }
      documentIds.add(entry.documentId as string)
      documentPaths.add(entry.documentPath as string)
    } else if (entry.documentId !== undefined || entry.documentPath !== undefined) {
      return `attachment carrying markdown identity: ${entry.relativeFilePath}`
    }
  }
  return null
}

// ---- round-11 F10 reserved-path exact/prefix split ----

/** Exact reserved segment names. Matched with `===` only. `.gitignore`
 * and `.github` are NOT reserved; `metadata.sqlite.bak` is NOT
 * reserved. */
export const RESERVED_EXACT_SEGMENTS = new Set<string>([
  '.git',
  'node_modules',
  'metadata.sqlite',
])

/** Reserved segment prefixes. Matched with `startsWith`. A segment
 * `.docus-journal-anything` is reserved; `.docus-journal` without a
 * trailing dash is also caught (every reserved prefix has the dash). */
export const RESERVED_PREFIX_SEGMENTS: readonly string[] = [
  '.docus-journal-',
  '.docus-folder-gate-',
  '.docus-rename-',
  '.docus-staged-',
  '.docus-delete-inflight-',
  '.docus-quarantine-reuse-',
  '.docus-delete-manifest-',
]

/** A single path segment is reserved if it equals an exact reserved
 * name OR starts with a reserved prefix. */
export function isReservedPhysicalSegment(segment: string): boolean {
  if (RESERVED_EXACT_SEGMENTS.has(segment)) return true
  return RESERVED_PREFIX_SEGMENTS.some((prefix) => segment.startsWith(prefix))
}

// ---- round-12 v4 provenance validation (trust boundary) ---------------

/** Validate a v4 journal's structural invariants BEFORE any path
 * resolution or filesystem access. Returns null on success, a reason
 * string on failure.
 *
 * Must run BEFORE resolve(contentDir, srcRel/destRel):
 *
 *   * srcRel !== destRel (no-op move);
 *   * srcRel/destRel are valid relative paths with no `.` / `..` segments;
 *   * entries use only valid relative file paths (same constraint).
 *
 * Does NOT validate vault containment (that happens after resolve in
 * recovery), but rejects clearly malformed journals that would allow
 * path traversal attacks if resolved against contentDir. */
export function validateFolderMoveJournalV4Provenance(
  journal: FolderMoveJournalV4,
): string | null {
  // srcRel and destRel must differ — a no-op move is always a bug.
  if (journal.srcRel === journal.destRel) {
    return 'srcRel must not equal destRel'
  }

  // Both must be valid relative paths with no dots.
  for (const key of ['srcRel', 'destRel'] as const) {
    const value = journal[key]
    if (!validRelativePath(value)) {
      return `invalid ${key}: ${value}`
    }
  }

  // Per-entry paths must also be valid relative paths.
  for (const entry of journal.entries) {
    if (!validRelativePath(entry.relativeFilePath)) {
      return `invalid entry path: ${entry.relativeFilePath}`
    }
  }

  // Directory manifest must contain only valid relative paths.
  for (const dir of journal.directories) {
    if (!validRelativePath(dir)) {
      return `invalid directory entry: ${dir}`
    }
  }

  return null
}
