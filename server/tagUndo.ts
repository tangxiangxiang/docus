import { randomUUID } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import type {
  TagOperationPlan,
  TagOperationRequest,
} from './tagManagement.js'
import {
  initializeTagUndoFoundationHealth,
  TAG_UNDO_FOUNDATION_SCHEMA_VERSION,
  TAG_UNDO_RECORD_CONTRACT_VERSION,
} from './tagUndoHealth.js'
import { TAG_IDENTITY_CONTRACT_VERSION } from '../shared/tagNormalization.js'

export type TagUndoRecordingFailureStage =
  | 'parent-insert'
  | 'removed-source-capture'
  | 'merge-source-staging'
  | 'created-destination-capture'
  | 'state-current-record'
  | 'state-last-superseded'
  | 'old-target-delete'
  | 'final-postcondition'

export type TagUndoRecordingFailureInjector = (stage: TagUndoRecordingFailureStage) => void

export type TagUndoRecordingErrorCode =
  | 'TAG_MANAGEMENT_UNAVAILABLE'
  | 'TRANSACTION_FAILED'

export class TagUndoRecordingError extends Error {
  readonly code: TagUndoRecordingErrorCode
  readonly details: Record<string, string | number | null>

  constructor(
    code: TagUndoRecordingErrorCode,
    message: string,
    details: Record<string, string | number | null> = {},
  ) {
    super(message)
    this.name = 'TagUndoRecordingError'
    this.code = code
    this.details = details
  }
}

type FoundationStateRow = {
  database_generation: string
  current_record_id: string | null
  last_superseded_record_id: string | null
}

export type TagUndoRecordingContext = {
  recordId: string
  originalOperationId: string
  originalResultId: string
  databaseGeneration: string
  previousRecordId: string | null
  operation: TagOperationRequest
  plan: TagOperationPlan
  committedAt: number
  fail?: TagUndoRecordingFailureInjector
}

const MERGE_SOURCE_DOCUMENTS_TEMP_TABLE = 'tag_undo_merge_source_documents'

function transactionFailed(message: string): never {
  throw new TagUndoRecordingError('TRANSACTION_FAILED', message)
}

function assertChanges(changes: number, expected: number, message: string): void {
  if (changes !== expected) transactionFailed(message)
}

function readFoundationState(db: DatabaseT): FoundationStateRow {
  const state = db.prepare(`
    SELECT database_generation, current_record_id, last_superseded_record_id
    FROM tag_undo_state
    WHERE state_id = 1
  `).get() as FoundationStateRow | undefined
  if (!state) transactionFailed('tag Undo foundation state is missing')
  return state
}

function canonicalOperationJson(operation: TagOperationRequest): string {
  if (operation.kind === 'rename') {
    return JSON.stringify({
      kind: 'rename',
      sourceTagId: operation.sourceTagId,
      destinationName: operation.destinationName,
    })
  }
  if (operation.kind === 'merge') {
    return JSON.stringify({
      kind: 'merge',
      sourceTagId: operation.sourceTagId,
      destinationTagId: operation.destinationTagId,
    })
  }
  return JSON.stringify({
    kind: 'remove',
    sourceTagId: operation.sourceTagId,
  })
}

function assertRecordingHealth(db: DatabaseT): FoundationStateRow {
  const health = initializeTagUndoFoundationHealth(db)
  if (health.state !== 'healthy') {
    throw new TagUndoRecordingError(
      'TAG_MANAGEMENT_UNAVAILABLE',
      'tag management reversible-record health is unavailable',
      { healthCode: health.code ?? 'TAG_UNDO_FOUNDATION_UNHEALTHY' },
    )
  }
  return readFoundationState(db)
}

function parentFields(
  operation: TagOperationRequest,
  plan: TagOperationPlan,
): {
  sourceAfterExists: number
  sourceAfterName: string | null
  sourceAfterNormalizedName: string | null
  destinationBeforeName: string | null
  destinationBeforeNormalizedName: string | null
  destinationAfterName: string | null
  destinationAfterNormalizedName: string | null
} {
  const sourceAfter = operation.kind === 'rename'
    ? plan.requestedDestination
    : null
  const destination = operation.kind === 'merge' ? plan.destinationTag : null
  return {
    sourceAfterExists: sourceAfter ? 1 : 0,
    sourceAfterName: sourceAfter?.displayName ?? null,
    sourceAfterNormalizedName: sourceAfter?.normalizedName ?? null,
    destinationBeforeName: destination?.displayName ?? null,
    destinationBeforeNormalizedName: destination?.normalizedName ?? null,
    destinationAfterName: destination?.displayName ?? null,
    destinationAfterNormalizedName: destination?.normalizedName ?? null,
  }
}

/**
 * Begin the durable record inside the existing Apply transaction. The health
 * check is deliberately fresh: startup health is not sufficient protection
 * against a later database drift.
 */
export function beginTagUndoRecording(
  db: DatabaseT,
  operation: TagOperationRequest,
  plan: TagOperationPlan,
  operationId: string,
  committedAt: number,
  fail?: TagUndoRecordingFailureInjector,
): TagUndoRecordingContext {
  const state = assertRecordingHealth(db)
  const recordId = randomUUID()
  const fields = parentFields(operation, plan)
  const inserted = db.prepare(`
    INSERT INTO tag_undo_records (
      record_id,
      original_operation_id,
      original_result_id,
      kind,
      display_only,
      identity_contract_version,
      record_contract_version,
      database_generation,
      operation_json,
      committed_at,
      source_tag_id,
      source_before_name,
      source_before_normalized_name,
      source_after_exists,
      source_after_name,
      source_after_normalized_name,
      destination_tag_id,
      destination_before_name,
      destination_before_normalized_name,
      destination_after_name,
      destination_after_normalized_name,
      lifecycle,
      terminal_code,
      undo_operation_id,
      undo_result_id,
      consumed_at,
      association_remove_count,
      association_add_count,
      version_update_count
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      'latest', NULL, NULL, NULL, NULL, ?, ?, ?
    )
  `).run(
    recordId,
    operationId,
    operationId,
    operation.kind,
    plan.displayOnly ? 1 : 0,
    TAG_IDENTITY_CONTRACT_VERSION,
    TAG_UNDO_RECORD_CONTRACT_VERSION,
    state.database_generation,
    canonicalOperationJson(operation),
    committedAt,
    plan.sourceTag.id,
    plan.sourceTag.displayName,
    plan.sourceTag.normalizedName,
    fields.sourceAfterExists,
    fields.sourceAfterName,
    fields.sourceAfterNormalizedName,
    operation.kind === 'merge' ? operation.destinationTagId : null,
    fields.destinationBeforeName,
    fields.destinationBeforeNormalizedName,
    fields.destinationAfterName,
    fields.destinationAfterNormalizedName,
    plan.associationRemoves,
    plan.associationAdds,
    plan.affectedCount,
  )
  assertChanges(inserted.changes, 1, 'reversible parent record was not created')
  fail?.('parent-insert')
  return {
    recordId,
    originalOperationId: operationId,
    originalResultId: operationId,
    databaseGeneration: state.database_generation,
    previousRecordId: state.current_record_id,
    operation,
    plan,
    committedAt,
    fail,
  }
}

export function captureTagUndoRemovedSourceDeltas(
  db: DatabaseT,
  context: TagUndoRecordingContext,
): void {
  if (context.operation.kind === 'rename') return
  const inserted = db.prepare(`
    INSERT INTO tag_undo_association_deltas (
      record_id, effect, association_id, document_id, tag_id
    )
    SELECT ?, 'removed-source', association_id, document_id, tag_id
    FROM document_tags
    WHERE tag_id = ?
    ORDER BY association_id
  `).run(context.recordId, context.operation.sourceTagId)
  assertChanges(
    inserted.changes,
    context.plan.associationRemoves,
    'removed-source reversible delta count mismatched',
  )
  context.fail?.('removed-source-capture')
}

export function stageTagUndoMergeSourceOnlyDocuments(
  db: DatabaseT,
  context: TagUndoRecordingContext,
): void {
  if (context.operation.kind !== 'merge') return
  db.exec(`
    DROP TABLE IF EXISTS temp.${MERGE_SOURCE_DOCUMENTS_TEMP_TABLE};
    CREATE TEMP TABLE ${MERGE_SOURCE_DOCUMENTS_TEMP_TABLE} (
      document_id TEXT PRIMARY KEY
    ) WITHOUT ROWID;
  `)
  const staged = db.prepare(`
    INSERT INTO temp.${MERGE_SOURCE_DOCUMENTS_TEMP_TABLE} (document_id)
    SELECT source.document_id
    FROM document_tags source
    WHERE source.tag_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM document_tags destination
        WHERE destination.document_id = source.document_id
          AND destination.tag_id = ?
      )
    ORDER BY source.document_id COLLATE BINARY
  `).run(context.operation.sourceTagId, context.operation.destinationTagId)
  assertChanges(staged.changes, context.plan.associationAdds, 'Merge source-only staging count mismatched')
  context.fail?.('merge-source-staging')
}

export function captureTagUndoCreatedDestinationDeltas(
  db: DatabaseT,
  context: TagUndoRecordingContext,
): void {
  if (context.operation.kind !== 'merge') return
  const inserted = db.prepare(`
    INSERT INTO tag_undo_association_deltas (
      record_id, effect, association_id, document_id, tag_id
    )
    SELECT ?, 'created-destination', destination.association_id,
           destination.document_id, destination.tag_id
    FROM document_tags destination
    JOIN temp.${MERGE_SOURCE_DOCUMENTS_TEMP_TABLE} source_only
      ON source_only.document_id = destination.document_id
    WHERE destination.tag_id = ?
    ORDER BY destination.association_id
  `).run(context.recordId, context.operation.destinationTagId)
  assertChanges(
    inserted.changes,
    context.plan.associationAdds,
    'created-destination reversible delta count mismatched',
  )
  context.fail?.('created-destination-capture')
}

export function updateTagUndoVersionCount(
  db: DatabaseT,
  context: TagUndoRecordingContext,
  versionUpdateCount: number,
): void {
  if (!Number.isSafeInteger(versionUpdateCount) || versionUpdateCount < 0
    || versionUpdateCount !== context.plan.affectedCount) {
    transactionFailed('reversible version count mismatched')
  }
  const updated = db.prepare(`
    UPDATE tag_undo_records
    SET version_update_count = ?
    WHERE record_id = ?
  `).run(versionUpdateCount, context.recordId)
  assertChanges(updated.changes, 1, 'reversible version count was not persisted')
}

function assertTagUndoDeltaCounts(db: DatabaseT, context: TagUndoRecordingContext): void {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tag_undo_association_deltas
       WHERE record_id = ? AND effect = 'removed-source') AS removed_count,
      (SELECT COUNT(*) FROM tag_undo_association_deltas
       WHERE record_id = ? AND effect = 'created-destination') AS added_count
  `).get(context.recordId, context.recordId) as { removed_count: number; added_count: number }
  if (row.removed_count !== context.plan.associationRemoves
    || row.added_count !== context.plan.associationAdds) {
    transactionFailed('reversible association delta counts mismatched')
  }
}

function assertCurrentRecordPostcondition(db: DatabaseT, context: TagUndoRecordingContext): void {
  const state = readFoundationState(db)
  const parentCount = (db.prepare('SELECT COUNT(*) AS count FROM tag_undo_records').get() as { count: number }).count
  const parent = db.prepare(`
    SELECT record_id, original_operation_id, original_result_id,
           database_generation, kind, display_only, lifecycle,
           association_remove_count, association_add_count,
           version_update_count
    FROM tag_undo_records
    WHERE record_id = ?
  `).get(context.recordId) as {
    record_id: string
    original_operation_id: string
    original_result_id: string
    database_generation: string
    kind: string
    display_only: number
    lifecycle: string
    association_remove_count: number
    association_add_count: number
    version_update_count: number
  } | undefined
  if (parentCount !== 1 || !parent
    || state.current_record_id !== context.recordId
    || state.database_generation !== context.databaseGeneration
    || parent.original_operation_id !== context.originalOperationId
    || parent.original_result_id !== context.originalResultId
    || parent.database_generation !== context.databaseGeneration
    || parent.kind !== context.operation.kind
    || parent.display_only !== (context.plan.displayOnly ? 1 : 0)
    || parent.lifecycle !== 'latest'
    || parent.association_remove_count !== context.plan.associationRemoves
    || parent.association_add_count !== context.plan.associationAdds
    || parent.version_update_count !== context.plan.affectedCount) {
    transactionFailed('reversible record postcondition failed')
  }
  assertTagUndoDeltaCounts(db, context)
}

/**
 * Atomically make the new record current and retire the previous heavy target.
 * The pointer is moved before the old parent is deleted so foreign keys remain
 * valid throughout the transaction.
 */
export function finalizeTagUndoRecording(
  db: DatabaseT,
  context: TagUndoRecordingContext,
): void {
  assertTagUndoDeltaCounts(db, context)
  const currentState = readFoundationState(db)
  if (currentState.database_generation !== context.databaseGeneration
    || currentState.current_record_id !== context.previousRecordId) {
    transactionFailed('tag Undo state changed during Apply')
  }

  const currentUpdate = currentState.current_record_id === null
    ? db.prepare(`
        UPDATE tag_undo_state
        SET current_record_id = ?
        WHERE state_id = 1
          AND database_generation = ?
          AND current_record_id IS NULL
      `).run(context.recordId, context.databaseGeneration)
    : db.prepare(`
        UPDATE tag_undo_state
        SET current_record_id = ?
        WHERE state_id = 1
          AND database_generation = ?
          AND current_record_id = ?
      `).run(context.recordId, context.databaseGeneration, context.previousRecordId)
  assertChanges(currentUpdate.changes, 1, 'current reversible target transition failed')
  context.fail?.('state-current-record')

  const lastSupersededUpdate = db.prepare(`
    UPDATE tag_undo_state
    SET last_superseded_record_id = ?, updated_at = ?
    WHERE state_id = 1
      AND database_generation = ?
      AND current_record_id = ?
  `).run(
    context.previousRecordId,
    context.committedAt,
    context.databaseGeneration,
    context.recordId,
  )
  assertChanges(lastSupersededUpdate.changes, 1, 'last superseded target transition failed')
  context.fail?.('state-last-superseded')

  if (context.previousRecordId !== null) {
    const deleted = db.prepare('DELETE FROM tag_undo_records WHERE record_id = ?')
      .run(context.previousRecordId)
    assertChanges(deleted.changes, 1, 'previous reversible target deletion failed')
    context.fail?.('old-target-delete')
  }

  db.exec(`DROP TABLE IF EXISTS temp.${MERGE_SOURCE_DOCUMENTS_TEMP_TABLE}`)
  const finalHealth = initializeTagUndoFoundationHealth(db)
  if (finalHealth.state !== 'healthy') {
    transactionFailed('final reversible-record state is unhealthy')
  }
  assertCurrentRecordPostcondition(db, context)
  context.fail?.('final-postcondition')
}

export { TAG_UNDO_FOUNDATION_SCHEMA_VERSION }
