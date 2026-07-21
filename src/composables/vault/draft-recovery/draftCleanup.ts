import type { DraftConflictRecord, UnsavedDraft } from './draftTypes'
import type { DraftRecoveryDecisionKind } from './draftRecoveryDecision'

export const MAX_DRAFT_CONTENT_BYTES = 2 * 1024 * 1024
export const MAX_VAULT_RECOVERY_RECORDS = 100
export const MAX_VAULT_RECOVERY_CONTENT_BYTES = 20 * 1024 * 1024
export const ORPHAN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type RecoveryRecordRef =
  | { source: 'primary'; record: UnsavedDraft; bytes: number }
  | { source: 'conflict'; record: DraftConflictRecord; bytes: number }

export interface DraftCapacitySnapshot {
  recordCount: number
  contentBytes: number
  recordLimit: number
  contentByteLimit: number
  overCapacity: boolean
}

export interface DraftCleanupPlan {
  before: DraftCapacitySnapshot
  candidates: RecoveryRecordRef[]
  retentionCandidates: RecoveryRecordRef[]
  capacityCandidates: RecoveryRecordRef[]
  skippedProtected: RecoveryRecordRef[]
  stillOverCapacity: boolean
}

export function draftContentBytes(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

export function primaryRecoveryRecord(record: UnsavedDraft): RecoveryRecordRef {
  return { source: 'primary', record, bytes: draftContentBytes(record.content) }
}

export function conflictRecoveryRecord(record: DraftConflictRecord): RecoveryRecordRef {
  return { source: 'conflict', record, bytes: draftContentBytes(record.content) }
}

export function recoveryRecordId(value: RecoveryRecordRef): string {
  return value.source === 'primary'
    ? JSON.stringify([value.record.vaultId, value.record.documentId])
    : JSON.stringify([
        value.record.vaultId,
        value.record.documentId,
        'conflict',
        value.record.conflictId,
      ])
}

export function recoveryIdentityId(value: RecoveryRecordRef): string {
  return JSON.stringify([value.record.vaultId, value.record.documentId])
}

export function compareRecoveryOldestFirst(
  left: RecoveryRecordRef,
  right: RecoveryRecordRef,
): number {
  return left.record.updatedAt - right.record.updatedAt
    || left.record.createdAt - right.record.createdAt
    || (left.source === right.source ? 0 : left.source === 'conflict' ? -1 : 1)
    || left.record.documentId.localeCompare(right.record.documentId)
    || (left.source === 'conflict' ? left.record.conflictId : '')
      .localeCompare(right.source === 'conflict' ? right.record.conflictId : '')
}

export function compareRecoveryNewestFirst(
  left: RecoveryRecordRef,
  right: RecoveryRecordRef,
): number {
  return compareRecoveryOldestFirst(right, left)
}

export function capacitySnapshot(records: readonly RecoveryRecordRef[]): DraftCapacitySnapshot {
  const contentBytes = records.reduce((sum, item) => sum + item.bytes, 0)
  return {
    recordCount: records.length,
    contentBytes,
    recordLimit: MAX_VAULT_RECOVERY_RECORDS,
    contentByteLimit: MAX_VAULT_RECOVERY_CONTENT_BYTES,
    overCapacity: records.length > MAX_VAULT_RECOVERY_RECORDS
      || contentBytes > MAX_VAULT_RECOVERY_CONTENT_BYTES,
  }
}

export interface PlanDraftCleanupInput {
  records: readonly RecoveryRecordRef[]
  decisions?: ReadonlyMap<string, DraftRecoveryDecisionKind | 'error' | null>
  protectedRecoveryIds?: ReadonlySet<string>
  protectedIdentityIds?: ReadonlySet<string>
  now: number
}

export function planDraftCleanup(input: PlanDraftCleanupInput): DraftCleanupPlan {
  const records = [...input.records].sort(compareRecoveryOldestFirst)
  const before = capacitySnapshot(records)
  const isProtected = (record: RecoveryRecordRef): boolean => (
    input.protectedRecoveryIds?.has(recoveryRecordId(record)) === true
    || input.protectedIdentityIds?.has(recoveryIdentityId(record)) === true
  )
  const skippedProtected = records.filter(isProtected)
  const retentionCandidates = records.filter((record) => {
    if (isProtected(record)) return false
    const decision = input.decisions?.get(recoveryRecordId(record))
    return (decision === 'missing-source' || decision === 'identity-mismatch')
      && input.now - record.record.updatedAt > ORPHAN_RETENTION_MS
  })
  const selected = new Set(retentionCandidates.map(recoveryRecordId))
  const remaining = records.filter((record) => !selected.has(recoveryRecordId(record)))
  let remainingCount = remaining.length
  let remainingBytes = remaining.reduce((sum, record) => sum + record.bytes, 0)
  const capacityCandidates: RecoveryRecordRef[] = []
  for (const record of remaining) {
    if (remainingCount <= MAX_VAULT_RECOVERY_RECORDS
      && remainingBytes <= MAX_VAULT_RECOVERY_CONTENT_BYTES) break
    if (isProtected(record)) continue
    capacityCandidates.push(record)
    selected.add(recoveryRecordId(record))
    remainingCount -= 1
    remainingBytes -= record.bytes
  }
  return {
    before,
    candidates: [...retentionCandidates, ...capacityCandidates],
    retentionCandidates,
    capacityCandidates,
    skippedProtected,
    stillOverCapacity: remainingCount > MAX_VAULT_RECOVERY_RECORDS
      || remainingBytes > MAX_VAULT_RECOVERY_CONTENT_BYTES,
  }
}
