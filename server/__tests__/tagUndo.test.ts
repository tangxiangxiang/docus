import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import {
  __setTagManagementApplyHooksForTesting,
  applyTagOperation,
  previewTagOperation,
  TagManagementError,
  type TagManagementApplyFailureStage,
  type TagOperationRequest,
} from '../tagManagement'
import { resetTagUndoFoundationHealthForTesting } from '../tagUndoHealth'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
})

afterEach(() => {
  __setTagManagementApplyHooksForTesting(null)
  resetTagUndoFoundationHealthForTesting(db)
  if (db.open) db.close()
})

function seedTag(id: number, name: string, normalizedName = name.toLowerCase()): void {
  db.prepare('INSERT INTO tags (id, name, normalized_name) VALUES (?, ?, ?)').run(id, name, normalizedName)
}

function seedDocument(id: string, tagIds: number[], updatedAt = 100): void {
  db.prepare(`
    INSERT INTO documents (id, path, title, summary, created_at, updated_at)
    VALUES (?, ?, ?, '', 1, ?)
  `).run(id, `${id}/note`, id, updatedAt)
  const insert = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)')
  for (const tagId of tagIds) insert.run(id, tagId)
}

async function apply(operation: TagOperationRequest) {
  const preview = previewTagOperation(db, operation)
  return applyTagOperation(db, operation, preview.planFingerprint)
}

function parent(): Record<string, unknown> {
  return db.prepare('SELECT * FROM tag_undo_records').get() as Record<string, unknown>
}

function state(): Record<string, unknown> {
  return db.prepare('SELECT * FROM tag_undo_state').get() as Record<string, unknown>
}

function deltas(): Record<string, unknown>[] {
  return db.prepare(`
    SELECT effect, association_id, document_id, tag_id
    FROM tag_undo_association_deltas
    ORDER BY effect, document_id, association_id
  `).all() as Record<string, unknown>[]
}

function durableSnapshot(): Record<string, unknown> {
  return {
    tags: db.prepare('SELECT * FROM tags ORDER BY id').all(),
    documents: db.prepare('SELECT * FROM documents ORDER BY id').all(),
    documentTags: db.prepare('SELECT * FROM document_tags ORDER BY document_id, tag_id').all(),
    records: db.prepare('SELECT * FROM tag_undo_records ORDER BY record_id').all(),
    deltas: db.prepare('SELECT * FROM tag_undo_association_deltas ORDER BY record_id, effect, association_id').all(),
    undoState: db.prepare('SELECT * FROM tag_undo_state').all(),
  }
}

function expectTagManagementError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(TagManagementError)
  expect((error as TagManagementError).code).toBe(code)
}

describe('T2.1-1 ordinary Apply durable records', () => {
  it('records identity Rename with canonical fields and no association children', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc-a', [7])
    seedDocument('doc-b', [7])
    const beforeAssociations = db.prepare(`
      SELECT document_id, association_id
      FROM document_tags
      WHERE tag_id = 7
      ORDER BY document_id
    `).all()

    const result = await apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Backend' })
    const record = parent()
    expect(record).toMatchObject({
      original_operation_id: result.operationId,
      original_result_id: result.resultId,
      kind: 'rename',
      display_only: 0,
      identity_contract_version: 'tag-identity-v1',
      record_contract_version: 'tag-undo-record-v1',
      operation_json: JSON.stringify({ kind: 'rename', sourceTagId: 7, destinationName: 'Backend' }),
      source_tag_id: 7,
      source_before_name: 'Java',
      source_before_normalized_name: 'java',
      source_after_exists: 1,
      source_after_name: 'Backend',
      source_after_normalized_name: 'backend',
      destination_tag_id: null,
      destination_before_name: null,
      destination_before_normalized_name: null,
      destination_after_name: null,
      destination_after_normalized_name: null,
      lifecycle: 'latest',
      terminal_code: null,
      undo_operation_id: null,
      undo_result_id: null,
      consumed_at: null,
      association_remove_count: 0,
      association_add_count: 0,
      version_update_count: 2,
    })
    expect(record.record_id).toBe((state() as { current_record_id: string }).current_record_id)
    expect(deltas()).toEqual([])
    expect(db.prepare(`
      SELECT document_id, association_id
      FROM document_tags
      WHERE tag_id = 7
      ORDER BY document_id
    `).all()).toEqual(beforeAssociations)
    expect((state() as { last_superseded_record_id: string | null }).last_superseded_record_id).toBeNull()
  })

  it('records Display Rename without changing association identities', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    const before = db.prepare('SELECT association_id FROM document_tags WHERE document_id = ?').get('doc')

    const result = await apply({ kind: 'rename', sourceTagId: 7, destinationName: 'JAVA' })
    expect(parent()).toMatchObject({
      original_operation_id: result.operationId,
      kind: 'rename',
      display_only: 1,
      source_after_exists: 1,
      source_after_name: 'JAVA',
      source_after_normalized_name: 'java',
      destination_tag_id: null,
      association_remove_count: 0,
      association_add_count: 0,
      version_update_count: 1,
      operation_json: JSON.stringify({ kind: 'rename', sourceTagId: 7, destinationName: 'JAVA' }),
    })
    expect(deltas()).toEqual([])
    expect(db.prepare('SELECT association_id FROM document_tags WHERE document_id = ?').get('doc')).toEqual(before)
  })

  it('records Merge source-only and overlap provenance using actual association IDs', async () => {
    seedTag(7, 'Java', 'java')
    seedTag(9, 'Backend', 'backend')
    seedTag(20, 'Python', 'python')
    seedDocument('source-only', [7])
    seedDocument('overlap', [7, 9])
    seedDocument('destination-only', [9, 20])

    const before = db.prepare(`
      SELECT document_id, tag_id, association_id
      FROM document_tags
      ORDER BY document_id, tag_id
    `).all() as Array<{ document_id: string; tag_id: number; association_id: number }>
    const sourceOnlySource = before.find((row) => row.document_id === 'source-only' && row.tag_id === 7)!
    const overlapSource = before.find((row) => row.document_id === 'overlap' && row.tag_id === 7)!
    const overlapDestination = before.find((row) => row.document_id === 'overlap' && row.tag_id === 9)!
    const destinationOnly = before.find((row) => row.document_id === 'destination-only' && row.tag_id === 9)!

    const result = await apply({ kind: 'merge', sourceTagId: 7, destinationTagId: 9 })
    expect(parent()).toMatchObject({
      original_operation_id: result.operationId,
      kind: 'merge',
      display_only: 0,
      source_after_exists: 0,
      destination_tag_id: 9,
      destination_before_name: 'Backend',
      destination_before_normalized_name: 'backend',
      destination_after_name: 'Backend',
      destination_after_normalized_name: 'backend',
      association_remove_count: 2,
      association_add_count: 1,
      version_update_count: 2,
      operation_json: JSON.stringify({ kind: 'merge', sourceTagId: 7, destinationTagId: 9 }),
    })
    expect(deltas()).toEqual([
      {
        effect: 'created-destination',
        association_id: expect.any(Number),
        document_id: 'source-only',
        tag_id: 9,
      },
      {
        effect: 'removed-source',
        association_id: overlapSource.association_id,
        document_id: 'overlap',
        tag_id: 7,
      },
      {
        effect: 'removed-source',
        association_id: sourceOnlySource.association_id,
        document_id: 'source-only',
        tag_id: 7,
      },
    ])
    const created = deltas().find((row) => row.effect === 'created-destination')!.association_id
    expect(created).not.toBe(overlapDestination.association_id)
    expect(created).not.toBe(destinationOnly.association_id)
    expect(db.prepare(`
      SELECT association_id
      FROM document_tags
      WHERE document_id = 'overlap' AND tag_id = 9
    `).get()).toEqual({ association_id: overlapDestination.association_id })
    expect(db.prepare(`
      SELECT association_id
      FROM document_tags
      WHERE document_id = 'destination-only' AND tag_id = 9
    `).get()).toEqual({ association_id: destinationOnly.association_id })
  })

  it('records Remove associations and permits an orphan Remove', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc-a', [7])
    seedDocument('doc-b', [7])
    const before = db.prepare(`
      SELECT association_id, document_id
      FROM document_tags
      WHERE tag_id = 7
      ORDER BY document_id
    `).all()

    const result = await apply({ kind: 'remove', sourceTagId: 7 })
    expect(parent()).toMatchObject({
      original_operation_id: result.operationId,
      kind: 'remove',
      display_only: 0,
      source_before_name: 'Java',
      source_before_normalized_name: 'java',
      source_after_exists: 0,
      source_after_name: null,
      source_after_normalized_name: null,
      destination_tag_id: null,
      association_remove_count: 2,
      association_add_count: 0,
      version_update_count: 2,
      operation_json: JSON.stringify({ kind: 'remove', sourceTagId: 7 }),
    })
    expect(deltas()).toEqual(before.map((row: any) => ({
      effect: 'removed-source',
      association_id: row.association_id,
      document_id: row.document_id,
      tag_id: 7,
    })))

    seedTag(20, 'Orphan', 'orphan')
    const orphanResult = await apply({ kind: 'remove', sourceTagId: 20 })
    const orphanRecord = parent()
    expect(orphanRecord).toMatchObject({
      original_operation_id: orphanResult.operationId,
      kind: 'remove',
      association_remove_count: 0,
      association_add_count: 0,
      version_update_count: 0,
    })
    expect(deltas()).toEqual([])
    expect((state() as { last_superseded_record_id: string | null }).last_superseded_record_id)
      .toBeTruthy()
  })

  it('supersedes one target with the next and deletes the previous heavy record', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    await apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Backend' })
    const first = parent().record_id as string
    await apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Kotlin' })
    const second = parent().record_id as string

    expect(second).not.toBe(first)
    expect(db.prepare('SELECT COUNT(*) AS count FROM tag_undo_records').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT record_id FROM tag_undo_records').get()).toEqual({ record_id: second })
    expect(state()).toMatchObject({ current_record_id: second, last_superseded_record_id: first })
    expect(db.prepare('SELECT COUNT(*) AS count FROM tag_undo_association_deltas').get()).toEqual({ count: 0 })
  })

  it('keeps the existing target and graph unchanged when a second Apply fails', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    await apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Backend' })
    const before = durableSnapshot()
    __setTagManagementApplyHooksForTesting({ failureStage: 'parent-insert' })

    await expect(apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Kotlin' })).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
    })
    expect(durableSnapshot()).toEqual(before)
  })
})

describe('T2.1-1 no-record-no-commit failure matrix', () => {
  const simpleStages: TagManagementApplyFailureStage[] = [
    'parent-insert',
    'after-version-update',
    'after-tag-row-mutation',
    'state-current-record',
    'state-last-superseded',
    'final-postcondition',
  ]

  it.each(simpleStages)('rolls back a Rename at %s', async (stage) => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    const before = durableSnapshot()
    __setTagManagementApplyHooksForTesting({ failureStage: stage })

    await expect(apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Backend' })).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
    })
    expect(durableSnapshot()).toEqual(before)
  })

  it('rolls back removed-source child capture and post-association failures', async () => {
    for (const stage of ['removed-source-capture', 'after-association-mutation'] as const) {
      db.exec('DELETE FROM documents; DELETE FROM tags;')
      seedTag(7, 'Java', 'java')
      seedDocument('doc', [7])
      const before = durableSnapshot()
      __setTagManagementApplyHooksForTesting({ failureStage: stage })

      await expect(apply({ kind: 'remove', sourceTagId: 7 })).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
      expect(durableSnapshot()).toEqual(before)
      __setTagManagementApplyHooksForTesting(null)
    }
  })

  it('rolls back Merge staging and created-destination capture failures', async () => {
    for (const stage of ['merge-source-staging', 'created-destination-capture'] as const) {
      db.exec('DELETE FROM documents; DELETE FROM tags;')
      seedTag(7, 'Java', 'java')
      seedTag(9, 'Backend', 'backend')
      seedDocument('doc', [7])
      const before = durableSnapshot()
      __setTagManagementApplyHooksForTesting({ failureStage: stage })

      await expect(apply({ kind: 'merge', sourceTagId: 7, destinationTagId: 9 }))
        .rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
      expect(durableSnapshot()).toEqual(before)
      __setTagManagementApplyHooksForTesting(null)
    }
  })

  it('rolls back old-target deletion after pointer transition', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    await apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Backend' })
    const before = durableSnapshot()
    __setTagManagementApplyHooksForTesting({ failureStage: 'old-target-delete' })

    await expect(apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Kotlin' }))
      .rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(durableSnapshot()).toEqual(before)
  })
})

describe('T2.1-1 health and compatibility gates', () => {
  it('fails closed before mutation when reversible-record health is unhealthy', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    db.prepare('UPDATE tag_undo_state SET database_generation = ?').run('broken-generation')
    const before = durableSnapshot()

    await expect(apply({ kind: 'rename', sourceTagId: 7, destinationName: 'Backend' }))
      .rejects.toMatchObject({ code: 'TAG_MANAGEMENT_UNAVAILABLE' })
    expect(durableSnapshot()).toEqual(before)
  })

  it('records the unchanged old-client Apply shape entirely server-side', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    const operation = { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' } as const
    const preview = previewTagOperation(db, operation)
    const result = await applyTagOperation(db, operation, preview.planFingerprint)

    expect(Object.keys(result)).not.toContain('recordId')
    expect(db.prepare('SELECT original_operation_id, original_result_id FROM tag_undo_records').get())
      .toEqual({ original_operation_id: result.operationId, original_result_id: result.resultId })
  })

  it('rejects a duplicate reviewed Apply as stale without creating another record', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    const operation = { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' } as const
    const preview = previewTagOperation(db, operation)
    await applyTagOperation(db, operation, preview.planFingerprint)

    try {
      await applyTagOperation(db, operation, preview.planFingerprint)
      throw new Error('expected stale duplicate Apply')
    } catch (error) {
      expectTagManagementError(error, 'PREVIEW_STALE')
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM tag_undo_records').get()).toEqual({ count: 1 })
  })

  it('serializes concurrent same-preview Apply into one durable current record', async () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc-a', [7])
    seedDocument('doc-b', [7])
    const operation = { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' } as const
    const preview = previewTagOperation(db, operation)
    const outcomes = await Promise.allSettled([
      applyTagOperation(db, operation, preview.planFingerprint),
      applyTagOperation(db, operation, preview.planFingerprint),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => {
      return outcome.reason
    })).toEqual([expect.objectContaining({ code: 'PREVIEW_STALE' })])
    expect(db.prepare('SELECT COUNT(*) AS count FROM tag_undo_records').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM tag_undo_association_deltas').get()).toEqual({ count: 0 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
