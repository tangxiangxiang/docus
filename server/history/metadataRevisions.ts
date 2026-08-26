import { createHash, randomUUID } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'

import {
  createDocumentMetadataWithinTransaction,
  deleteDocumentMetadata,
  getDocumentMetadata,
  getDocumentMetadataById,
  getDocumentTombstoneIdentity,
  patchDocumentMetadataWithinTransaction,
  restoreDocumentMetadataFieldsCAS,
  type DocumentMetadata,
} from '../documentMetadata.js'
import { normalizeAndDedupeTags, TagNormalizationError } from '../../shared/tagNormalization.js'
import {
  atomicRemoveTextIfUnchanged,
  atomicReplaceTextIfUnchanged,
  readStableTextSnapshot,
} from '../atomicTextWrite.js'
import {
  resolveSafeRelativePathDetailed,
  verifySafePathResolution,
} from '../paths.js'
import * as git from './git.js'

export const HISTORY_METADATA_SCHEMA_VERSION = 1 as const

export type HistoricalMetadataValues = {
  title: string
  summary: string
  tags: string[]
}

export type HistoricalMetadataPayload = {
  schemaVersion: typeof HISTORY_METADATA_SCHEMA_VERSION
  fields: HistoricalMetadataValues
}

export type HistoryMetadataErrorCode =
  | 'HISTORY_METADATA_CORRUPT'
  | 'HISTORY_METADATA_UNKNOWN_FIELD'
  | 'HISTORY_METADATA_UNSUPPORTED_SCHEMA'
  | 'HISTORY_METADATA_IDENTITY_CONFLICT'
  | 'HISTORY_METADATA_CONFLICT'
  | 'HISTORY_METADATA_JOURNAL_AMBIGUOUS'
  | 'HISTORY_METADATA_CAPTURE_FAILED'
  | 'HISTORY_METADATA_REVISION_WITHDRAWN'
  | 'HISTORY_METADATA_TREE_MISMATCH'
  | 'HISTORY_METADATA_BODY_MISMATCH'

export class HistoryMetadataError extends Error {
  readonly code: HistoryMetadataErrorCode

  constructor(code: HistoryMetadataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'HistoryMetadataError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new HistoryMetadataError(
      'HISTORY_METADATA_UNKNOWN_FIELD',
      `${label} contains unsupported field(s): ${unknown.join(', ')}`,
    )
  }
  const missing = keys.filter((key) => !Object.hasOwn(value, key))
  if (missing.length > 0) {
    throw new HistoryMetadataError(
      'HISTORY_METADATA_CORRUPT',
      `${label} is missing required field(s): ${missing.join(', ')}`,
    )
  }
}

function normalizeValues(value: unknown): HistoricalMetadataValues {
  if (!isRecord(value)) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata fields must be an object')
  }
  assertExactKeys(value, ['title', 'summary', 'tags'], 'historical metadata fields')
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata title is invalid')
  }
  if (typeof value.summary !== 'string' || value.summary.length > 2000) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata summary is invalid')
  }

  let tags
  try {
    tags = normalizeAndDedupeTags(value.tags as readonly unknown[])
  } catch (error) {
    if (error instanceof TagNormalizationError) {
      throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', `historical metadata tags are invalid: ${error.message}`, { cause: error })
    }
    throw error
  }
  // The live metadata owner exposes tags in normalized-name order. Keeping
  // the same order makes equivalent snapshots byte-for-byte deterministic,
  // while arbitrary valid tag strings remain opaque known-field values.
  tags.sort((left, right) => left.normalizedName.localeCompare(right.normalizedName))
  return {
    title: value.title.trim(),
    summary: value.summary.trim(),
    tags: tags.map((tag) => tag.displayName),
  }
}

export function canonicalizeHistoricalMetadata(values: HistoricalMetadataValues): HistoricalMetadataValues {
  return normalizeValues(values)
}

export function encodeHistoricalMetadataPayload(
  values: HistoricalMetadataValues,
): { payload: HistoricalMetadataPayload; payloadJson: string; payloadDigest: string } {
  const fields = canonicalizeHistoricalMetadata(values)
  const payload: HistoricalMetadataPayload = {
    schemaVersion: HISTORY_METADATA_SCHEMA_VERSION,
    fields,
  }
  // Do not use a generic object key sorter here: the envelope itself is a
  // versioned contract and its explicit order is part of the digest input.
  const payloadJson = JSON.stringify({
    schemaVersion: payload.schemaVersion,
    fields: {
      title: fields.title,
      summary: fields.summary,
      tags: fields.tags,
    },
  })
  const payloadDigest = createHash('sha256').update(payloadJson, 'utf8').digest('hex')
  return { payload, payloadJson, payloadDigest }
}

export function decodeHistoricalMetadataPayload(
  payloadJson: string,
  payloadDigest: string,
): HistoricalMetadataPayload {
  if (typeof payloadJson !== 'string' || typeof payloadDigest !== 'string') {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata payload is incomplete')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch (error) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata payload is not valid JSON', { cause: error })
  }
  if (!isRecord(parsed)) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata payload must be an object')
  }
  assertExactKeys(parsed, ['schemaVersion', 'fields'], 'historical metadata payload')
  if (parsed.schemaVersion !== HISTORY_METADATA_SCHEMA_VERSION) {
    throw new HistoryMetadataError(
      'HISTORY_METADATA_UNSUPPORTED_SCHEMA',
      `historical metadata schema ${String(parsed.schemaVersion)} is not supported`,
    )
  }
  const fields = normalizeValues(parsed.fields)
  const canonicalJson = JSON.stringify({
    schemaVersion: HISTORY_METADATA_SCHEMA_VERSION,
    fields: {
      title: fields.title,
      summary: fields.summary,
      tags: fields.tags,
    },
  })
  const actualDigest = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  if (!/^[0-9a-f]{64}$/i.test(payloadDigest) || actualDigest !== payloadDigest.toLowerCase()) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata payload digest does not match')
  }
  return {
    schemaVersion: HISTORY_METADATA_SCHEMA_VERSION,
    fields,
  }
}

export type HistoricalMetadataImage = {
  id: string
  path: string
  title: string
  summary: string
  tags: string[]
}

export function metadataImage(metadata: DocumentMetadata | null): HistoricalMetadataImage | null {
  if (!metadata) return null
  return {
    id: metadata.id,
    path: metadata.path,
    title: metadata.title,
    summary: metadata.summary,
    tags: [...metadata.tags],
  }
}

function imageJson(image: HistoricalMetadataImage | null): string | null {
  return image ? JSON.stringify(image) : null
}

function parseImage(raw: string | null): HistoricalMetadataImage | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata image is not valid JSON', { cause: error })
  }
  if (!isRecord(parsed)) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata image is invalid')
  }
  assertExactKeys(parsed, ['id', 'path', 'title', 'summary', 'tags'], 'historical metadata image')
  if (typeof parsed.id !== 'string'
    || !parsed.id
    || typeof parsed.path !== 'string'
    || !parsed.path
    || typeof parsed.title !== 'string'
    || typeof parsed.summary !== 'string'
    || !Array.isArray(parsed.tags)
    || parsed.tags.some((tag) => typeof tag !== 'string')) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata image is invalid')
  }
  const fields = normalizeValues({ title: parsed.title, summary: parsed.summary, tags: parsed.tags })
  if (parsed.title !== fields.title
    || parsed.summary !== fields.summary
    || JSON.stringify(parsed.tags) !== JSON.stringify(fields.tags)) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical metadata image is not canonical')
  }
  return {
    id: parsed.id,
    path: parsed.path,
    title: fields.title,
    summary: fields.summary,
    tags: fields.tags,
  }
}

function imagesEqual(left: HistoricalMetadataImage | null, right: HistoricalMetadataImage | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function logicalHistoryPath(historyPath: string): string {
  return historyPath.endsWith('.md') ? historyPath.slice(0, -3) : historyPath
}

function logicalPath(historyPath: string): string {
  return logicalHistoryPath(historyPath)
}

export function historicalBodySha(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

function hashRaw(raw: string | null): string | null {
  return raw === null ? null : historicalBodySha(raw)
}

export type HistoryMetadataCaptureItem = {
  pathAtRevision: string
  documentId: string | null
  generationId: string | null
  coverageKind: 'covered' | 'legacy'
  schemaVersion: number | null
  payloadJson: string | null
  payloadDigest: string | null
  bodySha: string | null
  capturedAt: number
}

export type PreparedHistoryMetadataCapture = {
  operationId: string
  vaultId: string
  expectedParentSha: string | null
  paths: string[]
  items: HistoryMetadataCaptureItem[]
}

type CaptureOperationRow = {
  operation_id: string
  vault_id: string
  state: string
  expected_parent_sha: string | null
  commit_sha: string | null
}

function sortedUniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort()
}

function expectedHashesJson(paths: readonly string[], expectedHashes: Record<string, string | null>): string {
  const entries = paths.map((filePath) => {
    if (!Object.hasOwn(expectedHashes, filePath)) {
      throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', `expected body hash is missing: ${filePath}`)
    }
    const hash = expectedHashes[filePath]
    if (hash !== null && !/^[0-9a-f]{64}$/i.test(hash)) {
      throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', `expected body hash is invalid: ${filePath}`)
    }
    return [filePath, hash] as const
  })
  return JSON.stringify(Object.fromEntries(entries))
}

/** Persist the pre-commit capture journal and all live metadata images. */
export function prepareHistoryMetadataCapture(input: {
  db: DatabaseT
  vaultId: string
  expectedParentSha: string | null
  paths: readonly string[]
  expectedHashes: Record<string, string | null>
  now?: number
}): PreparedHistoryMetadataCapture {
  const paths = sortedUniquePaths(input.paths)
  if (paths.length === 0) throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'metadata capture needs at least one path')
  const operationId = randomUUID()
  const capturedAt = input.now ?? Date.now()
  const items: HistoryMetadataCaptureItem[] = []
  for (const filePath of paths) {
    const metadata = getDocumentMetadata(input.db, logicalPath(filePath))
    if (!metadata) {
      items.push({
        pathAtRevision: filePath,
        documentId: null,
        generationId: null,
        coverageKind: 'legacy',
        schemaVersion: null,
        payloadJson: null,
        payloadDigest: null,
        bodySha: input.expectedHashes[filePath] ?? null,
        capturedAt,
      })
      continue
    }
    const encoded = encodeHistoricalMetadataPayload({
      title: metadata.title,
      summary: metadata.summary,
      tags: metadata.tags,
    })
    items.push({
      pathAtRevision: filePath,
      documentId: metadata.id,
      generationId: metadata.id,
      coverageKind: 'covered',
      schemaVersion: encoded.payload.schemaVersion,
      payloadJson: encoded.payloadJson,
      payloadDigest: encoded.payloadDigest,
      bodySha: input.expectedHashes[filePath] ?? null,
      capturedAt,
    })
  }

  const hashesJson = expectedHashesJson(paths, input.expectedHashes)
  const tx = input.db.transaction(() => {
    input.db.prepare(`
      INSERT INTO history_metadata_operations (
        operation_id, vault_id, kind, state, expected_parent_sha,
        commit_sha, tree_sha, paths_json, expected_hashes_json,
        error_code, error_message, created_at, updated_at
      ) VALUES (?, ?, 'capture', 'prepared', ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)
    `).run(
      operationId,
      input.vaultId,
      input.expectedParentSha,
      JSON.stringify(paths),
      hashesJson,
      capturedAt,
      capturedAt,
    )
    const insert = input.db.prepare(`
      INSERT INTO history_metadata_revisions (
        operation_id, vault_id, commit_sha, parent_sha, tree_sha,
        path_at_revision, document_id, generation_id, coverage_kind,
        schema_version, payload_json, payload_digest, body_sha, captured_at
      ) VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of items) {
      insert.run(
        operationId,
        input.vaultId,
        item.pathAtRevision,
        item.documentId,
        item.generationId,
        item.coverageKind,
        item.schemaVersion,
        item.payloadJson,
        item.payloadDigest,
        item.bodySha,
        item.capturedAt,
      )
    }
  })
  try {
    tx.immediate()
  } catch (error) {
    throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'could not prepare historical metadata capture', { cause: error })
  }
  return { operationId, vaultId: input.vaultId, expectedParentSha: input.expectedParentSha, paths, items }
}

async function verifyCommitBinding(
  repoRoot: string,
  commitSha: string,
  expectedParentSha: string | null,
  expectedTreeSha: string,
): Promise<void> {
  const resolved = await git.resolveCommit(repoRoot, commitSha)
  if (resolved !== commitSha) {
    throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'commit SHA could not be resolved immutably')
  }
  const tree = await git.run(repoRoot, ['rev-parse', `${commitSha}^{tree}`])
  if (tree.status !== 0 || tree.stdout.trim() !== expectedTreeSha) {
    throw new HistoryMetadataError('HISTORY_METADATA_TREE_MISMATCH', 'Git tree changed before metadata finalization')
  }
  const parents = await git.run(repoRoot, ['rev-list', '--parents', '-n', '1', commitSha])
  if (parents.status !== 0) {
    throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'Git parent proof failed')
  }
  const values = parents.stdout.trim().split(/\s+/).filter(Boolean)
  const actualParents = values.slice(1)
  if (actualParents.length > 1
    || (expectedParentSha === null && actualParents.length !== 0)
    || (expectedParentSha !== null && actualParents[0] !== expectedParentSha)) {
    throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'Git parent proof does not match capture journal')
  }
}

/** Bind prepared live metadata images to the immutable commit/tree/body proof. */
export async function finalizeHistoryMetadataCapture(input: {
  db: DatabaseT
  repoRoot: string
  operationId: string
  commitSha: string
  parentSha: string | null
  treeSha: string
}): Promise<void> {
  const operation = input.db.prepare(`
    SELECT operation_id, vault_id, state, expected_parent_sha, commit_sha
    FROM history_metadata_operations
    WHERE operation_id = ? AND kind = 'capture'
  `).get(input.operationId) as CaptureOperationRow | undefined
  if (!operation) throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture journal was not found')
  if (operation.state === 'committed') {
    if (operation.commit_sha === input.commitSha) return
    throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture journal is bound to a different commit')
  }
  if (operation.state !== 'prepared') {
    throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', `capture journal is not finalizable from ${operation.state}`)
  }
  if (operation.expected_parent_sha !== input.parentSha) {
    throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture parent changed before Git binding')
  }
  await verifyCommitBinding(input.repoRoot, input.commitSha, input.parentSha, input.treeSha)
  const revisions = input.db.prepare(`
    SELECT path_at_revision, body_sha
    FROM history_metadata_revisions
    WHERE operation_id = ?
    ORDER BY path_at_revision
  `).all(input.operationId) as Array<{ path_at_revision: string; body_sha: string | null }>
  if (revisions.length === 0) throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture journal has no revision rows')
  for (const revision of revisions) {
    const raw = await git.rawAt(input.repoRoot, input.commitSha, revision.path_at_revision)
    if (hashRaw(raw) !== revision.body_sha) {
      throw new HistoryMetadataError(
        'HISTORY_METADATA_BODY_MISMATCH',
        `Git body does not match capture proof: ${revision.path_at_revision}`,
      )
    }
  }

  const now = Date.now()
  const tx = input.db.transaction(() => {
    const current = input.db.prepare(`
      SELECT state, commit_sha
      FROM history_metadata_operations
      WHERE operation_id = ? AND kind = 'capture'
    `).get(input.operationId) as { state: string; commit_sha: string | null } | undefined
    if (!current) throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture journal disappeared during finalization')
    if (current.state === 'committed') {
      if (current.commit_sha === input.commitSha) return
      throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture journal was concurrently rebound')
    }
    if (current.state !== 'prepared') throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture journal is no longer prepared')
    const operationUpdate = input.db.prepare(`
      UPDATE history_metadata_operations
      SET state = 'committed', commit_sha = ?, tree_sha = ?, updated_at = ?,
          error_code = NULL, error_message = NULL
      WHERE operation_id = ? AND kind = 'capture' AND state = 'prepared'
    `).run(input.commitSha, input.treeSha, now, input.operationId)
    if (operationUpdate.changes !== 1) throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'capture journal finalize lost its state race')
    const revisionUpdate = input.db.prepare(`
      UPDATE history_metadata_revisions
      SET commit_sha = ?, parent_sha = ?, tree_sha = ?
      WHERE operation_id = ? AND commit_sha IS NULL
    `).run(input.commitSha, input.parentSha, input.treeSha, input.operationId)
    if (revisionUpdate.changes !== revisions.length) {
      throw new HistoryMetadataError('HISTORY_METADATA_CAPTURE_FAILED', 'not all metadata revisions were bound to the commit')
    }
  })
  tx.immediate()
}

export function abortHistoryMetadataCapture(
  db: DatabaseT,
  operationId: string,
  error: unknown,
): void {
  const code = error instanceof HistoryMetadataError ? error.code : 'HISTORY_METADATA_CAPTURE_FAILED'
  const message = error instanceof Error ? error.message : String(error)
  const now = Date.now()
  db.prepare(`
    UPDATE history_metadata_operations
    SET state = 'aborted', error_code = ?, error_message = ?, updated_at = ?
    WHERE operation_id = ? AND kind = 'capture' AND state = 'prepared'
  `).run(code, message.slice(0, 2000), now, operationId)
}

/**
 * A successful History withdrawal intentionally removes a Docus commit from
 * the reachable graph. Retire its capture journal as well so the next
 * startup/history operation does not mistake an intentional withdrawal for
 * an unresolved cross-store failure.
 */
export function withdrawHistoryMetadataCapture(
  db: DatabaseT,
  vaultId: string,
  commitSha: string,
): void {
  db.prepare(`
    UPDATE history_metadata_operations
    SET state = 'aborted', error_code = 'HISTORY_METADATA_REVISION_WITHDRAWN',
        error_message = 'Docus History revision was intentionally withdrawn',
        updated_at = ?
    WHERE vault_id = ? AND kind = 'capture' AND commit_sha = ?
      AND state = 'committed'
  `).run(Date.now(), vaultId, commitSha)
}

/** Reconcile capture journals without guessing an unbound Git object. */
export async function reconcileHistoryMetadataCaptures(
  db: DatabaseT,
  repoRoot: string,
): Promise<void> {
  const operations = db.prepare(`
    SELECT operation_id, state, commit_sha
    FROM history_metadata_operations
    WHERE kind = 'capture' AND state IN ('prepared', 'committed', 'ambiguous')
    ORDER BY created_at, operation_id
  `).all() as Array<{ operation_id: string; state: string; commit_sha: string | null }>
  const ambiguous: string[] = []
  for (const operation of operations) {
    if (operation.state === 'prepared') {
      abortHistoryMetadataCapture(db, operation.operation_id, new HistoryMetadataError(
        'HISTORY_METADATA_CAPTURE_FAILED',
        'prepared capture had no durable commit binding after process recovery',
      ))
      continue
    }
    if (operation.state === 'ambiguous') {
      ambiguous.push(operation.operation_id)
      continue
    }
    if (!operation.commit_sha || !await git.isCommitReachable(repoRoot, operation.commit_sha)) {
      db.prepare(`
        UPDATE history_metadata_operations
        SET state = 'ambiguous', error_code = 'HISTORY_METADATA_JOURNAL_AMBIGUOUS',
            error_message = 'committed metadata capture is not reachable from Git', updated_at = ?
        WHERE operation_id = ? AND kind = 'capture' AND state = 'committed'
      `).run(Date.now(), operation.operation_id)
      ambiguous.push(operation.operation_id)
    }
  }
  if (ambiguous.length > 0) {
    throw new HistoryMetadataError(
      'HISTORY_METADATA_JOURNAL_AMBIGUOUS',
      `historical metadata capture requires repair: ${ambiguous.join(', ')}`,
    )
  }
}

export type HistoryMetadataRevision = {
  kind: 'covered'
  commitSha: string
  parentSha: string | null
  treeSha: string
  pathAtRevision: string
  documentId: string
  generationId: string
  schemaVersion: number
  payloadJson: string
  payloadDigest: string
  bodySha: string | null
  values: HistoricalMetadataValues
} | {
  kind: 'legacy'
  commitSha: string
  pathAtRevision: string
  reason: 'pre-coverage' | 'untracked'
}

/** Resolve a revision by immutable SHA; an absent capture operation means an
 * external/pre-coverage revision. Once Docus has a committed capture for a
 * selected path, a missing row is corruption—not permission to downgrade the
 * revision to body-only legacy semantics. */
export function resolveHistoryMetadataRevision(
  db: DatabaseT,
  input: { vaultId: string; commitSha: string; pathAtRevision: string },
): HistoryMetadataRevision {
  const operation = db.prepare(`
    SELECT operation_id, state, paths_json
    FROM history_metadata_operations
    WHERE vault_id = ? AND kind = 'capture' AND commit_sha = ?
  `).get(input.vaultId, input.commitSha) as {
    operation_id: string
    state: string
    paths_json: string
  } | undefined
  if (!operation) {
    return { kind: 'legacy', commitSha: input.commitSha, pathAtRevision: input.pathAtRevision, reason: 'pre-coverage' }
  }
  let capturedPaths: unknown
  try {
    capturedPaths = JSON.parse(operation.paths_json)
  } catch (error) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical capture paths are not valid JSON', { cause: error })
  }
  if (!Array.isArray(capturedPaths) || capturedPaths.some((value) => typeof value !== 'string')) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'historical capture paths are invalid')
  }
  if (!capturedPaths.includes(input.pathAtRevision)) {
    return { kind: 'legacy', commitSha: input.commitSha, pathAtRevision: input.pathAtRevision, reason: 'untracked' }
  }
  if (operation.state !== 'committed') {
    throw new HistoryMetadataError(
      'HISTORY_METADATA_JOURNAL_AMBIGUOUS',
      `historical metadata revision is not durably committed: ${input.commitSha}`,
    )
  }
  const row = db.prepare(`
    SELECT r.commit_sha, r.parent_sha, r.tree_sha, r.path_at_revision,
           r.document_id, r.generation_id, r.coverage_kind, r.schema_version,
           r.payload_json, r.payload_digest, r.body_sha, o.state
    FROM history_metadata_revisions r
    JOIN history_metadata_operations o ON o.operation_id = r.operation_id
    WHERE r.operation_id = ? AND r.vault_id = ? AND r.commit_sha = ? AND r.path_at_revision = ?
      AND o.kind = 'capture'
  `).get(operation.operation_id, input.vaultId, input.commitSha, input.pathAtRevision) as {
    commit_sha: string
    parent_sha: string | null
    tree_sha: string | null
    path_at_revision: string
    document_id: string | null
    generation_id: string | null
    coverage_kind: 'covered' | 'legacy'
    schema_version: number | null
    payload_json: string | null
    payload_digest: string | null
    body_sha: string | null
    state: string
  } | undefined
  if (!row) {
    throw new HistoryMetadataError(
      'HISTORY_METADATA_CORRUPT',
      `historical metadata capture row is missing: ${input.commitSha}:${input.pathAtRevision}`,
    )
  }
  if (row.coverage_kind === 'legacy') {
    return { kind: 'legacy', commitSha: row.commit_sha, pathAtRevision: row.path_at_revision, reason: 'untracked' }
  }
  if (row.document_id === null || row.generation_id === null || row.schema_version === null
    || row.payload_json === null || row.payload_digest === null || row.tree_sha === null) {
    throw new HistoryMetadataError('HISTORY_METADATA_CORRUPT', 'covered historical metadata revision is incomplete')
  }
  if (row.generation_id !== row.document_id || row.schema_version !== HISTORY_METADATA_SCHEMA_VERSION) {
    throw new HistoryMetadataError('HISTORY_METADATA_UNSUPPORTED_SCHEMA', 'covered historical metadata generation/schema is unsupported')
  }
  const payload = decodeHistoricalMetadataPayload(row.payload_json, row.payload_digest)
  return {
    kind: 'covered',
    commitSha: row.commit_sha,
    parentSha: row.parent_sha,
    treeSha: row.tree_sha,
    pathAtRevision: row.path_at_revision,
    documentId: row.document_id,
    generationId: row.generation_id,
    schemaVersion: row.schema_version,
    payloadJson: row.payload_json,
    payloadDigest: row.payload_digest,
    bodySha: row.body_sha,
    values: payload.fields,
  }
}

export type PreparedHistoryMetadataRestore = {
  operationId: string
  target: HistoricalMetadataImage
}

export function prepareHistoryMetadataRestore(input: {
  db: DatabaseT
  vaultId: string
  commitSha: string
  pathAtRevision: string
  documentId: string
  generationId: string
  beforeRaw: string | null
  beforeMetadata: HistoricalMetadataImage | null
  targetRaw: string
  targetMetadata: HistoricalMetadataImage
  targetDigest: string
  now?: number
}): PreparedHistoryMetadataRestore {
  const operationId = randomUUID()
  const now = input.now ?? Date.now()
  const tx = input.db.transaction(() => {
    input.db.prepare(`
      INSERT INTO history_metadata_operations (
        operation_id, vault_id, kind, state, expected_parent_sha,
        commit_sha, tree_sha, paths_json, expected_hashes_json,
        error_code, error_message, created_at, updated_at
      ) VALUES (?, ?, 'restore', 'prepared', NULL, ?, NULL, ?, ?, NULL, NULL, ?, ?)
    `).run(
      operationId,
      input.vaultId,
      input.commitSha,
      JSON.stringify([input.pathAtRevision]),
      JSON.stringify({ [input.pathAtRevision]: hashRaw(input.targetRaw) }),
      now,
      now,
    )
    input.db.prepare(`
      INSERT INTO history_metadata_restore_journal (
        operation_id, vault_id, commit_sha, path_at_revision,
        document_id, generation_id, before_exists, before_raw,
        target_raw, before_metadata_json, target_metadata_json,
        target_digest, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      operationId,
      input.vaultId,
      input.commitSha,
      input.pathAtRevision,
      input.documentId,
      input.generationId,
      input.beforeRaw === null ? 0 : 1,
      input.beforeRaw,
      input.targetRaw,
      imageJson(input.beforeMetadata),
      imageJson(input.targetMetadata),
      input.targetDigest,
      now,
      now,
    )
  })
  tx.immediate()
  return { operationId, target: input.targetMetadata }
}

function setRestoreJournalState(
  db: DatabaseT,
  operationId: string,
  state: 'committed' | 'recovered' | 'aborted' | 'ambiguous' | 'compensating' | 'failed',
  error?: unknown,
): void {
  const code = error instanceof HistoryMetadataError ? error.code : error ? 'HISTORY_METADATA_CONFLICT' : null
  const message = error instanceof Error ? error.message : error ? String(error) : null
  const now = Date.now()
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE history_metadata_operations
      SET state = ?, error_code = ?, error_message = ?, updated_at = ?
      WHERE operation_id = ? AND kind = 'restore'
    `).run(state, code, message?.slice(0, 2000) ?? null, now, operationId)
    db.prepare(`
      UPDATE history_metadata_restore_journal
      SET updated_at = ? WHERE operation_id = ?
    `).run(now, operationId)
  })
  tx.immediate()
}

export function markHistoryMetadataRestoreCommitted(db: DatabaseT, operationId: string): void {
  setRestoreJournalState(db, operationId, 'committed')
}

export function abortHistoryMetadataRestore(db: DatabaseT, operationId: string, error: unknown): void {
  setRestoreJournalState(db, operationId, 'aborted', error)
}

function currentImage(db: DatabaseT, path: string): HistoricalMetadataImage | null {
  return metadataImage(getDocumentMetadata(db, path))
}

/**
 * Apply covered metadata through the existing live owner and mark the restore
 * journal in the same SQLite transaction. A missing row is only rehydrated
 * when the caller already proved the matching lifecycle tombstone.
 */
export function applyCoveredHistoricalMetadata(input: {
  db: DatabaseT
  operationId: string
  path: string
  documentId: string
  generationId: string
  expectedUpdatedAt: number | null
  allowRehydrate: boolean
  values: HistoricalMetadataValues
  now?: number
}): DocumentMetadata {
  const values = canonicalizeHistoricalMetadata(input.values)
  const tx = input.db.transaction(() => {
    const current = getDocumentMetadata(input.db, input.path)
    let restored: DocumentMetadata
    if (!current) {
      if (!input.allowRehydrate || getDocumentTombstoneIdentity(input.db, input.path) !== input.documentId) {
        throw new HistoryMetadataError(
          'HISTORY_METADATA_IDENTITY_CONFLICT',
          `historical metadata generation cannot be rehydrated: ${input.path}`,
        )
      }
      if (getDocumentMetadataById(input.db, input.documentId)) {
        throw new HistoryMetadataError(
          'HISTORY_METADATA_IDENTITY_CONFLICT',
          `historical document identity is already bound elsewhere: ${input.documentId}`,
        )
      }
      restored = createDocumentMetadataWithinTransaction(input.db, {
        id: input.documentId,
        path: input.path,
        title: values.title,
        summary: values.summary,
        tags: values.tags,
      }, input.now)
    } else {
      if (current.id !== input.documentId
        || input.generationId !== input.documentId
        || input.expectedUpdatedAt === null
        || current.updatedAt !== input.expectedUpdatedAt) {
        throw new HistoryMetadataError(
          'HISTORY_METADATA_CONFLICT',
          `current metadata identity or version changed: ${input.path}`,
        )
      }
      try {
        restored = patchDocumentMetadataWithinTransaction(input.db, {
          path: input.path,
          expectedUpdatedAt: input.expectedUpdatedAt,
          changes: [
            { field: 'title', value: values.title },
            { field: 'summary', value: values.summary },
            { field: 'tags', values: values.tags },
          ],
        }, input.now)
      } catch (error) {
        if (error instanceof Error && !(error instanceof HistoryMetadataError)) {
          throw new HistoryMetadataError('HISTORY_METADATA_CONFLICT', error.message, { cause: error })
        }
        throw error
      }
    }
    const update = input.db.prepare(`
      UPDATE history_metadata_operations
      SET state = 'committed', error_code = NULL, error_message = NULL,
          updated_at = ?
      WHERE operation_id = ? AND kind = 'restore' AND state = 'prepared'
    `).run(Date.now(), input.operationId)
    if (update.changes !== 1) throw new HistoryMetadataError('HISTORY_METADATA_CONFLICT', 'restore journal is no longer prepared')
    input.db.prepare('UPDATE history_metadata_restore_journal SET updated_at = ? WHERE operation_id = ?')
      .run(Date.now(), input.operationId)
    return restored
  })

  // `restoreDocumentMetadataFieldsCAS` is normally a transaction wrapper.
  // It must not be nested inside this journal transaction, so perform the
  // same semantic update inline when a current row exists.
  try {
    return tx.immediate()
  } catch (error) {
    if (error instanceof HistoryMetadataError) throw error
    throw new HistoryMetadataError('HISTORY_METADATA_CONFLICT', 'historical metadata restore failed', { cause: error })
  }
}

type RestoreJournalRow = {
  operation_id: string
  vault_id: string
  commit_sha: string
  path_at_revision: string
  document_id: string
  generation_id: string
  before_exists: number
  before_raw: string | null
  target_raw: string
  before_metadata_json: string | null
  target_metadata_json: string
  target_digest: string
  state: string
}

async function readRestoreTarget(repoRoot: string, historyPath: string): Promise<string | null> {
  const resolution = await resolveSafeRelativePathDetailed(repoRoot, historyPath, { allowMissingFinal: true })
  await verifySafePathResolution(resolution)
  try {
    const snapshot = await readStableTextSnapshot(resolution.absolute)
    return snapshot.raw
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function rollbackRestoreBody(
  repoRoot: string,
  row: RestoreJournalRow,
): Promise<boolean> {
  const resolution = await resolveSafeRelativePathDetailed(repoRoot, row.path_at_revision, { allowMissingFinal: true })
  await verifySafePathResolution(resolution)
  if (row.before_exists) {
    await atomicReplaceTextIfUnchanged(resolution.absolute, row.target_raw, row.before_raw!, {})
  } else {
    await atomicRemoveTextIfUnchanged(resolution.absolute, row.target_raw)
  }
  const after = await readRestoreTarget(repoRoot, row.path_at_revision)
  return after === (row.before_exists ? row.before_raw : null)
}

async function reconcileRestoreJournal(
  db: DatabaseT,
  repoRoot: string,
  row: RestoreJournalRow,
): Promise<'ok' | 'ambiguous'> {
  const beforeMetadata = parseImage(row.before_metadata_json)
  const targetMetadata = parseImage(row.target_metadata_json)
  if (!targetMetadata) return 'ambiguous'
  const currentRaw = await readRestoreTarget(repoRoot, row.path_at_revision)
  const currentMetadata = currentImage(db, logicalPath(row.path_at_revision))
  const beforeRaw = row.before_exists ? row.before_raw : null
  if (currentRaw === row.target_raw && imagesEqual(currentMetadata, targetMetadata)) {
    setRestoreJournalState(db, row.operation_id, 'recovered')
    return 'ok'
  }
  if (currentRaw === beforeRaw && imagesEqual(currentMetadata, beforeMetadata)) {
    setRestoreJournalState(db, row.operation_id, 'aborted')
    return 'ok'
  }
  if (currentRaw === row.target_raw && imagesEqual(currentMetadata, beforeMetadata)) {
    try {
      await rollbackRestoreBody(repoRoot, row)
      setRestoreJournalState(db, row.operation_id, 'aborted')
      return 'ok'
    } catch (error) {
      setRestoreJournalState(db, row.operation_id, 'ambiguous', error)
      return 'ambiguous'
    }
  }
  if (currentRaw === beforeRaw && imagesEqual(currentMetadata, targetMetadata)) {
    try {
      if (beforeMetadata === null) {
        if (currentMetadata?.id !== targetMetadata.id) throw new Error('restore metadata identity changed')
        deleteDocumentMetadata(db, logicalPath(row.path_at_revision))
      } else {
        if (!currentMetadata || currentMetadata.id !== targetMetadata.id) throw new Error('restore metadata identity changed')
        restoreDocumentMetadataFieldsCAS(db, {
          path: logicalPath(row.path_at_revision),
          documentId: beforeMetadata.id,
          generationId: beforeMetadata.id,
          expectedUpdatedAt: getDocumentMetadata(db, logicalPath(row.path_at_revision))!.updatedAt,
          title: beforeMetadata.title,
          summary: beforeMetadata.summary,
          tags: beforeMetadata.tags,
        })
      }
      setRestoreJournalState(db, row.operation_id, 'aborted')
      return 'ok'
    } catch (error) {
      setRestoreJournalState(db, row.operation_id, 'ambiguous', error)
      return 'ambiguous'
    }
  }
  setRestoreJournalState(db, row.operation_id, 'ambiguous', new HistoryMetadataError(
    'HISTORY_METADATA_JOURNAL_AMBIGUOUS',
    `restore journal cannot prove body/metadata state: ${row.path_at_revision}`,
  ))
  return 'ambiguous'
}

/** Reconcile interrupted covered restores before another history mutation. */
export async function reconcileHistoryMetadataRestores(
  db: DatabaseT,
  repoRoot: string,
): Promise<void> {
  const rows = db.prepare(`
    SELECT j.operation_id, j.vault_id, j.commit_sha, j.path_at_revision,
           j.document_id, j.generation_id, j.before_exists, j.before_raw,
           j.target_raw, j.before_metadata_json, j.target_metadata_json,
           j.target_digest, o.state
    FROM history_metadata_restore_journal j
    JOIN history_metadata_operations o ON o.operation_id = j.operation_id
    WHERE o.kind = 'restore' AND o.state = 'prepared'
    ORDER BY j.created_at, j.operation_id
  `).all() as RestoreJournalRow[]
  const ambiguous: string[] = []
  for (const row of rows) {
    try {
      if (await reconcileRestoreJournal(db, repoRoot, row) === 'ambiguous') ambiguous.push(row.operation_id)
    } catch (error) {
      setRestoreJournalState(db, row.operation_id, 'ambiguous', error)
      ambiguous.push(row.operation_id)
    }
  }
  const existingAmbiguous = db.prepare(`
    SELECT operation_id FROM history_metadata_operations
    WHERE kind = 'restore' AND state = 'ambiguous'
  `).all() as Array<{ operation_id: string }>
  ambiguous.push(...existingAmbiguous.map((row) => row.operation_id))
  if (ambiguous.length > 0) {
    throw new HistoryMetadataError(
      'HISTORY_METADATA_JOURNAL_AMBIGUOUS',
      `historical metadata restore requires repair: ${[...new Set(ambiguous)].join(', ')}`,
    )
  }
}

export async function reconcileHistoryMetadata(
  db: DatabaseT,
  repoRoot: string,
): Promise<void> {
  await reconcileHistoryMetadataCaptures(db, repoRoot)
  await reconcileHistoryMetadataRestores(db, repoRoot)
}

export function metadataTombstoneMatches(
  db: DatabaseT,
  path: string,
  documentId: string,
): boolean {
  return getDocumentTombstoneIdentity(db, path) === documentId
}
