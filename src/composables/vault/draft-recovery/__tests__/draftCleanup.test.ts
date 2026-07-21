import { describe, expect, it } from 'vitest'
import {
  MAX_DRAFT_CONTENT_BYTES,
  MAX_VAULT_RECOVERY_RECORDS,
  ORPHAN_RETENTION_MS,
  conflictRecoveryRecord,
  draftContentBytes,
  planDraftCleanup,
  primaryRecoveryRecord,
  recoveryIdentityId,
  recoveryRecordId,
} from '../draftCleanup'
import type { DraftConflictRecord, UnsavedDraft } from '../draftTypes'

function draft(id: string, updatedAt: number, content = id): UnsavedDraft {
  return {
    version: 1, vaultId: 'vault', documentId: id, documentPath: `notes/${id}`,
    content, baseContentHash: null, baseModifiedAt: null,
    createdAt: updatedAt, updatedAt,
  }
}

function conflict(id: string, updatedAt: number): DraftConflictRecord {
  return {
    ...draft(id, updatedAt), conflictId: `c-${id}`, origin: 'delete-conflict',
    crossContextUpdatedAt: null, recordedAt: updatedAt,
  }
}

describe('draft cleanup policy', () => {
  it('measures UTF-8 bytes and preserves the exact 2 MiB boundary', () => {
    expect(draftContentBytes('abc')).toBe(3)
    expect(draftContentBytes('草稿')).toBe(6)
    expect(draftContentBytes('a'.repeat(MAX_DRAFT_CONTENT_BYTES))).toBe(MAX_DRAFT_CONTENT_BYTES)
  })

  it('expires only missing or identity-mismatch records older than 30 days', () => {
    const now = ORPHAN_RETENTION_MS + 100
    const expired = primaryRecoveryRecord(draft('expired', 99))
    const boundary = primaryRecoveryRecord(draft('boundary', 100))
    const unknown = primaryRecoveryRecord(draft('unknown', 0))
    const decisions = new Map([
      [recoveryRecordId(expired), 'missing-source' as const],
      [recoveryRecordId(boundary), 'identity-mismatch' as const],
      [recoveryRecordId(unknown), 'unknown' as const],
    ])
    const plan = planDraftCleanup({ records: [boundary, unknown, expired], decisions, now })
    expect(plan.retentionCandidates.map(recoveryRecordId)).toEqual([recoveryRecordId(expired)])
  })

  it('counts primary and conflicts and deletes deterministically oldest first', () => {
    const records = [
      primaryRecoveryRecord(draft('same', 1)),
      conflictRecoveryRecord(conflict('same', 1)),
      ...Array.from({ length: MAX_VAULT_RECOVERY_RECORDS }, (_, index) => (
        primaryRecoveryRecord(draft(`d-${index}`, index + 2))
      )),
    ]
    const plan = planDraftCleanup({ records, now: 0 })
    expect(plan.before.recordCount).toBe(102)
    expect(plan.capacityCandidates.map((item) => item.source)).toEqual(['conflict', 'primary'])
  })

  it('deduplicates retention and capacity candidates', () => {
    const records = Array.from({ length: 101 }, (_, index) => (
      primaryRecoveryRecord(draft(`d-${index}`, index))
    ))
    const decisions = new Map([[recoveryRecordId(records[0]!), 'missing-source' as const]])
    const plan = planDraftCleanup({ records, decisions, now: ORPHAN_RETENTION_MS + 1 })
    expect(new Set(plan.candidates.map(recoveryRecordId)).size).toBe(plan.candidates.length)
  })

  it('never selects protected identities and reports unresolved capacity', () => {
    const records = Array.from({ length: 101 }, (_, index) => (
      primaryRecoveryRecord(draft(`d-${index}`, index))
    ))
    const identities = new Set(records.map(recoveryIdentityId))
    const plan = planDraftCleanup({ records, protectedIdentityIds: identities, now: 0 })
    expect(plan.candidates).toEqual([])
    expect(plan.skippedProtected).toHaveLength(101)
    expect(plan.stillOverCapacity).toBe(true)
  })
})
