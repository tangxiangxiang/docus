import type { Database as DatabaseT } from 'better-sqlite3'
import { TAG_IDENTITY_CONTRACT_VERSION } from '../shared/tagNormalization.js'

export const TAG_UNDO_RECORD_CONTRACT_VERSION = 'tag-undo-record-v1'
export const UNDO_FINGERPRINT_CONTRACT_VERSION = 'tag-undo-fingerprint-v1'
export const TAG_UNDO_FOUNDATION_SCHEMA_VERSION = 7

export type TagUndoFoundationHealthState = 'checking' | 'healthy' | 'unavailable'

export type TagUndoFoundationHealth = {
  state: TagUndoFoundationHealthState
  code?: string
  reason?: string
  schemaVersion: number
  checkedAt: number
}

const healthByDb = new WeakMap<object, TagUndoFoundationHealth>()

function now(): number {
  return Date.now()
}

function unavailable(code: string, reason: string, schemaVersion = 0): TagUndoFoundationHealth {
  return { state: 'unavailable', code, reason, schemaVersion, checkedAt: now() }
}

function tableExists(db: DatabaseT, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name))
}

function indexExists(db: DatabaseT, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?",
  ).get(name))
}

function tableColumns(db: DatabaseT, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name)
}

function hasExactTableColumns(db: DatabaseT, table: string, columns: readonly string[]): boolean {
  return tableColumns(db, table).join('\0') === columns.join('\0')
}

function hasUniqueDocumentTagConstraint(db: DatabaseT): boolean {
  const indexes = db.prepare('PRAGMA index_list(document_tags)').all() as Array<{
    name: string
    unique: number
  }>
  return indexes.some((index) => {
    if (index.unique !== 1) return false
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>
    return columns.map((column) => column.name).join('\0') === 'document_id\0tag_id'
  })
}

function validateFoundationSchema(db: DatabaseT): string | null {
  const version = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined
  if (!version || version.version < TAG_UNDO_FOUNDATION_SCHEMA_VERSION) return 'tag Undo foundation migration is not applied'

  for (const table of ['document_tags', 'tag_undo_records', 'tag_undo_association_deltas', 'tag_undo_state']) {
    if (!tableExists(db, table)) return `tag Undo foundation table is missing: ${table}`
  }
  for (const index of ['idx_document_tags_tag', 'idx_document_tags_document', 'idx_tag_undo_records_lifecycle', 'idx_tag_undo_deltas_record_document', 'idx_tag_undo_deltas_record_effect_association']) {
    if (!indexExists(db, index)) return `tag Undo foundation index is missing: ${index}`
  }
  if (!hasExactTableColumns(db, 'document_tags', ['association_id', 'document_id', 'tag_id'])
    || !hasExactTableColumns(db, 'tag_undo_records', [
      'record_id', 'original_operation_id', 'original_result_id', 'kind',
      'display_only', 'identity_contract_version', 'record_contract_version',
      'database_generation', 'operation_json', 'committed_at', 'source_tag_id',
      'source_before_name', 'source_before_normalized_name', 'source_after_exists',
      'source_after_name', 'source_after_normalized_name', 'destination_tag_id',
      'destination_before_name', 'destination_before_normalized_name',
      'destination_after_name', 'destination_after_normalized_name', 'lifecycle',
      'terminal_code', 'undo_operation_id', 'undo_result_id', 'consumed_at',
      'association_remove_count', 'association_add_count', 'version_update_count',
    ])
    || !hasExactTableColumns(db, 'tag_undo_association_deltas', [
      'record_id', 'effect', 'association_id', 'document_id', 'tag_id',
    ])
    || !hasExactTableColumns(db, 'tag_undo_state', [
      'state_id', 'database_generation', 'current_record_id',
      'last_superseded_record_id', 'updated_at',
    ])) {
    return 'document_tags association provenance schema is invalid'
  }
  if (!hasUniqueDocumentTagConstraint(db)) return 'document_tags logical uniqueness constraint is missing'

  const states = db.prepare('SELECT state_id, database_generation, current_record_id FROM tag_undo_state').all() as Array<{
    state_id: number
    database_generation: string
    current_record_id: string | null
  }>
  if (states.length !== 1 || states[0].state_id !== 1 || !/^[0-9a-f]{32}$/.test(states[0].database_generation)) {
    return 'tag Undo foundation state singleton is invalid'
  }
  if (states[0].current_record_id !== null && !db.prepare(
    'SELECT 1 FROM tag_undo_records WHERE record_id = ?',
  ).get(states[0].current_record_id)) {
    return 'tag Undo foundation state points at a missing record'
  }
  const records = db.prepare(`
    SELECT record_id, original_operation_id, original_result_id, kind,
           display_only, identity_contract_version, record_contract_version,
           database_generation, lifecycle, source_tag_id,
           association_remove_count, association_add_count, version_update_count
    FROM tag_undo_records
  `).all() as Array<{
    record_id: string
    original_operation_id: string
    original_result_id: string
    kind: string
    display_only: number
    identity_contract_version: string
    record_contract_version: string
    database_generation: string
    lifecycle: string
    source_tag_id: number
    association_remove_count: number
    association_add_count: number
    version_update_count: number
  }>
  for (const record of records) {
    if (record.identity_contract_version !== TAG_IDENTITY_CONTRACT_VERSION
      || record.record_contract_version !== TAG_UNDO_RECORD_CONTRACT_VERSION
      || record.database_generation !== states[0].database_generation
      || !['rename', 'merge', 'remove'].includes(record.kind)
      || (record.kind !== 'rename' && record.display_only !== 0)
      || !['latest', 'consumed', 'terminal'].includes(record.lifecycle)
      || !Number.isSafeInteger(record.source_tag_id) || record.source_tag_id <= 0
      || ![record.association_remove_count, record.association_add_count, record.version_update_count]
        .every((value) => Number.isSafeInteger(value) && value >= 0)) {
      return 'tag Undo foundation record contract is invalid'
    }
    const deltaCounts = db.prepare(`
      SELECT effect, COUNT(*) AS count
      FROM tag_undo_association_deltas
      WHERE record_id = ?
      GROUP BY effect
    `).all(record.record_id) as Array<{ effect: string; count: number }>
    const removedCount = deltaCounts.find((row) => row.effect === 'removed-source')?.count ?? 0
    const addedCount = deltaCounts.find((row) => row.effect === 'created-destination')?.count ?? 0
    if (removedCount !== record.association_remove_count || addedCount !== record.association_add_count) {
      return 'tag Undo foundation record/delta counts are inconsistent'
    }
    if (record.kind === 'rename' && (removedCount !== 0 || addedCount !== 0)) {
      return 'tag Undo rename record has association deltas'
    }
  }
  if (states[0].current_record_id !== null) {
    const current = records.find((record) => record.record_id === states[0].current_record_id)
    if (!current || current.lifecycle !== 'latest') return 'tag Undo foundation latest pointer is invalid'
  }
  const orphanDelta = db.prepare(`
    SELECT d.record_id
    FROM tag_undo_association_deltas d
    LEFT JOIN tag_undo_records r ON r.record_id = d.record_id
    WHERE r.record_id IS NULL
       OR d.association_id <= 0
       OR d.tag_id <= 0
    LIMIT 1
  `).get()
  if (orphanDelta) return 'tag Undo foundation association delta is invalid'

  const duplicateAssociation = db.prepare(`
    SELECT document_id, tag_id, COUNT(*) AS count
    FROM document_tags
    GROUP BY document_id, tag_id
    HAVING count > 1
    LIMIT 1
  `).get()
  if (duplicateAssociation) return 'duplicate logical document-tag association exists'
  const invalidAssociation = db.prepare(
    'SELECT association_id FROM document_tags WHERE association_id <= 0 OR association_id IS NULL LIMIT 1',
  ).get()
  if (invalidAssociation) return 'document-tag association identity is invalid'
  if (db.prepare('PRAGMA foreign_key_check').get()) return 'foreign-key check failed'
  const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined
  if (integrity?.integrity_check !== 'ok') return 'SQLite integrity check failed'
  return null
}

export function initializeTagUndoFoundationHealth(db: DatabaseT): TagUndoFoundationHealth {
  const checking: TagUndoFoundationHealth = {
    state: 'checking',
    schemaVersion: 0,
    checkedAt: now(),
  }
  healthByDb.set(db, checking)
  let schemaVersion = 0
  try {
    schemaVersion = Number((db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined)?.version ?? 0)
    const reason = validateFoundationSchema(db)
    const result = reason
      ? unavailable('TAG_UNDO_FOUNDATION_UNHEALTHY', reason, schemaVersion)
      : { state: 'healthy' as const, schemaVersion, checkedAt: now() }
    healthByDb.set(db, result)
    return result
  } catch {
    const result = unavailable('TAG_UNDO_FOUNDATION_UNHEALTHY', 'tag Undo foundation validation failed', schemaVersion)
    healthByDb.set(db, result)
    return result
  }
}

export function getTagUndoFoundationHealth(db: DatabaseT): TagUndoFoundationHealth {
  return healthByDb.get(db) ?? unavailable(
    'TAG_UNDO_FOUNDATION_NOT_INITIALIZED',
    'tag Undo foundation health has not been initialized',
  )
}

export function resetTagUndoFoundationHealthForTesting(db?: DatabaseT): void {
  if (db) healthByDb.delete(db)
}
