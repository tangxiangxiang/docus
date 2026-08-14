import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { performance } from 'node:perf_hooks'
import { applyMigrations } from '../db'
import {
  applyTagOperation,
  buildTagOperationPlan,
  isPlanFingerprint,
  previewTagOperation,
  type TagOperationRequest,
} from '../tagManagement'

const SCALE_TEST_TIMEOUT_MS = 30_000

function seedScaleFixture(db: Database.Database): void {
  const insertTag = db.prepare('INSERT INTO tags (id, name, normalized_name) VALUES (?, ?, ?)')
  for (let tagId = 1; tagId <= 5; tagId++) insertTag.run(tagId, `Tag-${tagId}`, `tag-${tagId}`)

  const insertDocument = db.prepare(`
    INSERT INTO documents (id, path, title, summary, created_at, updated_at)
    VALUES (?, ?, ?, '', 1, 1)
  `)
  const insertAssociation = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)')
  db.transaction(() => {
    for (let i = 0; i < 10000; i++) {
      const id = `doc-${String(i).padStart(5, '0')}`
      insertDocument.run(id, id, id)
      for (let tagId = 1; tagId <= 5; tagId++) insertAssociation.run(id, tagId)
    }
  })()
}

describe('Tags scale evidence', { timeout: SCALE_TEST_TIMEOUT_MS }, () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    applyMigrations(db)
  })

  afterEach(() => {
    if (db.open) db.close()
  })

  it('records constant-query planning evidence for the deterministic 10k/50k fixture', () => {
    seedScaleFixture(db)
    const preparedStatements: string[] = []
    const countedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== 'prepare') return Reflect.get(target, property, receiver)
        return (sql: string) => {
          preparedStatements.push(sql)
          return target.prepare(sql)
        }
      },
    }) as Database.Database
    const heapBefore = process.memoryUsage().heapUsed
    const startedAt = performance.now()
    const plan = buildTagOperationPlan(countedDb, { kind: 'merge', sourceTagId: 1, destinationTagId: 2 })
    const elapsedMs = Number((performance.now() - startedAt).toFixed(2))
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore
    const evidence = {
      documents: 10000,
      associations: 50000,
      plannerQueries: preparedStatements.length,
      elapsedMs,
      heapDeltaBytes,
    }
    console.info('[tag-management-perf]', JSON.stringify(evidence))

    expect(plan.affectedCount).toBe(10000)
    expect(plan.associationAdds).toBe(0)
    expect(plan.associationRemoves).toBe(10000)
    expect(plan.duplicateCollapses).toBe(10000)
    expect(plan.sample).toHaveLength(20)
    expect(isPlanFingerprint(plan.planFingerprint)).toBe(true)
    expect(evidence.plannerQueries).toBe(3)
    expect(Number.isFinite(evidence.elapsedMs)).toBe(true)
    expect(Number.isFinite(evidence.heapDeltaBytes)).toBe(true)
  })

  it('keeps Apply mutation queries set-based at the 10k-document/50k-association scale', async () => {
    seedScaleFixture(db)
    const operation: TagOperationRequest = { kind: 'remove', sourceTagId: 1 }
    const preview = previewTagOperation(db, operation)
    const result = await applyTagOperation(db, operation, preview.planFingerprint)

    expect(result).toMatchObject({
      affectedCount: 10000,
      associationAdds: 0,
      associationRemoves: 10000,
      duplicateCollapses: 0,
      tagDeletes: 1,
      versionUpdateCount: 10000,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM document_tags WHERE tag_id = 1').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM document_tags').get()).toEqual({ count: 40000 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM documents WHERE updated_at = 1').get()).toEqual({ count: 0 })
  })
})
