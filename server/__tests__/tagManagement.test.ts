import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations } from '../db'
import {
  __setTagManagementPlannerHookForTesting,
  buildTagOperationPlan,
  isPlanFingerprint,
  listManagedTags,
  parsePreviewPageRequest,
  parseTagOperation,
  previewTagOperation,
  previewTagOperationPage,
  TagManagementError,
  type TagOperationRequest,
} from '../tagManagement'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
})

afterEach(() => {
  __setTagManagementPlannerHookForTesting(null)
  if (db.open) db.close()
})

function seedTag(id: number, displayName: string, normalizedName = displayName.toLowerCase()): void {
  db.prepare('INSERT INTO tags (id, name, normalized_name) VALUES (?, ?, ?)').run(id, displayName, normalizedName)
}

function seedDocument(
  id: string,
  tagIds: number[] = [],
  options: { title?: string; summary?: string; createdAt?: number; updatedAt?: number } = {},
): void {
  const createdAt = options.createdAt ?? 100
  const updatedAt = options.updatedAt ?? createdAt
  db.prepare(`
    INSERT INTO documents (id, path, title, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, `${id}/note`, options.title ?? id, options.summary ?? '', createdAt, updatedAt)
  const insert = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)')
  for (const tagId of tagIds) insert.run(id, tagId)
}

function seedBasicGraph(): void {
  seedTag(7, 'Java', 'java')
  seedDocument('b', [7], { title: 'B' })
  seedDocument('a', [7], { title: 'A' })
}

function expectDomainCode(callback: () => unknown, code: string): void {
  try {
    callback()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(TagManagementError)
    expect((error as TagManagementError).code).toBe(code)
  }
}

describe('tag management read model', () => {
  it('lists stable IDs, distinct document counts, orphans, and binary identity order', () => {
    seedTag(7, 'Java', 'java')
    seedTag(9, 'Backend', 'backend')
    seedTag(12, 'Orphan', 'orphan')
    seedDocument('doc-a', [7, 9])
    seedDocument('doc-b', [7])

    expect(listManagedTags(db)).toEqual([
      { id: 9, normalizedName: 'backend', displayName: 'Backend', documentCount: 1 },
      { id: 7, normalizedName: 'java', displayName: 'Java', documentCount: 2 },
      { id: 12, normalizedName: 'orphan', displayName: 'Orphan', documentCount: 0 },
    ])
  })
})

describe('tag management planner', () => {
  it('plans normal Rename with source ID preserved and no association delta', () => {
    seedBasicGraph()
    const before = db.prepare('SELECT * FROM tags UNION ALL SELECT * FROM tags').all()
    const plan = buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: ' Backend ' })

    expect(plan).toMatchObject({
      operation: { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' },
      sourceTag: { id: 7, displayName: 'Java', normalizedName: 'java' },
      destinationTag: null,
      survivorTag: { id: 7 },
      displayOnly: false,
      affectedCount: 2,
      associationAdds: 0,
      associationRemoves: 0,
      duplicateCollapses: 0,
      tagCreates: 0,
      tagDeletes: 0,
      allowedToApply: true,
    })
    expect(plan.affectedDocuments.map((document) => document.id)).toEqual(['a', 'b'])
    expect(isPlanFingerprint(plan.planFingerprint)).toBe(true)
    expect(db.prepare('SELECT * FROM tags UNION ALL SELECT * FROM tags').all()).toEqual(before)
  })

  it('distinguishes Display Rename from a same-display no-op', () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])

    const display = buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: 'JAVA' })
    expect(display).toMatchObject({ displayOnly: true, allowedToApply: true, affectedCount: 1 })
    expect(display.conflictCode).toBeUndefined()

    const noop = buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: 'Java' })
    expect(noop).toMatchObject({ displayOnly: false, allowedToApply: false, conflictCode: 'INVALID_OPERATION' })
  })

  it('returns a reviewable Rename destination conflict without planning an implicit Merge', () => {
    seedTag(7, 'Java', 'java')
    seedTag(9, 'Backend', 'backend')
    seedDocument('doc', [7])

    const plan = buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: 'backend' })
    expect(plan).toMatchObject({
      allowedToApply: false,
      conflictCode: 'DESTINATION_EXISTS',
      destinationTag: { id: 9, displayName: 'Backend' },
      associationAdds: 0,
      associationRemoves: 0,
      tagDeletes: 0,
    })
  })

  it('plans orphan Rename and Remove with zero affected documents', () => {
    seedTag(7, 'Orphan', 'orphan')
    const rename = buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: 'Renamed' })
    const remove = buildTagOperationPlan(db, { kind: 'remove', sourceTagId: 7 })

    expect(rename).toMatchObject({ affectedCount: 0, allowedToApply: true })
    expect(remove).toMatchObject({
      affectedCount: 0,
      associationAdds: 0,
      associationRemoves: 0,
      duplicateCollapses: 0,
      tagDeletes: 1,
      allowedToApply: true,
      warnings: ['DESTRUCTIVE'],
    })
  })

  it('plans Merge with exact source-only adds, overlap collapses, and destination survivor', () => {
    seedTag(7, 'Java', 'java')
    seedTag(9, 'Backend', 'backend')
    seedTag(20, 'Python', 'python')
    seedDocument('source-only', [7])
    seedDocument('overlap', [7, 9])
    seedDocument('destination-only', [9, 20])

    const plan = buildTagOperationPlan(db, { kind: 'merge', sourceTagId: 7, destinationTagId: 9 })
    expect(plan).toMatchObject({
      affectedCount: 2,
      associationAdds: 1,
      associationRemoves: 2,
      duplicateCollapses: 1,
      tagDeletes: 1,
      survivorTag: { id: 9, displayName: 'Backend' },
      allowedToApply: true,
    })
    expect(plan.affectedDocuments.map((document) => document.id)).toEqual(['overlap', 'source-only'])
    expect(plan.affectedDocuments.some((document) => document.id === 'destination-only')).toBe(false)
  })

  it('rejects missing Merge rows and self Merge with stable domain codes', () => {
    seedTag(7, 'Java', 'java')
    expectDomainCode(() => buildTagOperationPlan(db, { kind: 'merge', sourceTagId: 7, destinationTagId: 9 }), 'TAG_NOT_FOUND')
    expect(buildTagOperationPlan(db, { kind: 'merge', sourceTagId: 7, destinationTagId: 7 })).toMatchObject({
      allowedToApply: false,
      conflictCode: 'SOURCE_DESTINATION_SAME',
    })
  })

  it('adds HIGH_IMPACT only at the stable 1000-document threshold', () => {
    seedTag(7, 'Java', 'java')
    const insertDocument = db.prepare(`
      INSERT INTO documents (id, path, title, summary, created_at, updated_at)
      VALUES (?, ?, ?, '', 1, 1)
    `)
    const insertAssociation = db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, 7)')
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        const id = `doc-${String(i).padStart(4, '0')}`
        insertDocument.run(id, id, id)
        insertAssociation.run(id)
      }
    })()

    const plan = buildTagOperationPlan(db, { kind: 'remove', sourceTagId: 7 })
    expect(plan.affectedCount).toBe(1000)
    expect(plan.sample).toHaveLength(20)
    expect(plan.warnings).toEqual(['DESTRUCTIVE', 'HIGH_IMPACT'])
  })
})

describe('tag management fingerprints and pagination', () => {
  it('fingerprints the relevant graph but ignores unrelated documents and tags', () => {
    seedTag(7, 'Java', 'java')
    seedTag(20, 'Python', 'python')
    seedDocument('affected', [7], { title: 'Before', summary: 'summary' })
    seedDocument('unrelated', [20], { title: 'Other' })
    const operation: TagOperationRequest = { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' }

    const initial = buildTagOperationPlan(db, operation)
    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run('Other changed', 'unrelated')
    db.prepare('UPDATE tags SET name = ? WHERE id = ?').run('Python 3', 20)
    expect(buildTagOperationPlan(db, operation).planFingerprint).toBe(initial.planFingerprint)

    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run('After', 'affected')
    expect(buildTagOperationPlan(db, operation).planFingerprint).not.toBe(initial.planFingerprint)

    const afterTitle = buildTagOperationPlan(db, operation)
    db.prepare('INSERT INTO tags (id, name, normalized_name) VALUES (?, ?, ?)').run(30, 'Extra', 'extra')
    db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)').run('affected', 30)
    expect(buildTagOperationPlan(db, operation).planFingerprint).not.toBe(afterTitle.planFingerprint)
  })

  it('fingerprints destination absence and treats normalized request spellings identically', () => {
    seedTag(7, 'Java', 'java')
    seedDocument('affected', [7])
    const withSpaces = buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: ' Backend ' })
    const withoutSpaces = buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' })
    expect(withSpaces.planFingerprint).toBe(withoutSpaces.planFingerprint)

    seedTag(9, 'Backend', 'backend')
    expect(buildTagOperationPlan(db, { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' }).planFingerprint)
      .not.toBe(withSpaces.planFingerprint)
  })

  it('excludes Merge destination-only metadata while fingerprinting source graph state', () => {
    seedTag(7, 'Java', 'java')
    seedTag(9, 'Backend', 'backend')
    seedDocument('source', [7], { title: 'Source' })
    seedDocument('destination-only', [9], { title: 'Destination before', summary: 'before' })
    const operation: TagOperationRequest = { kind: 'merge', sourceTagId: 7, destinationTagId: 9 }
    const initial = buildTagOperationPlan(db, operation)

    db.prepare('UPDATE documents SET title = ?, summary = ? WHERE id = ?')
      .run('Destination after', 'after', 'destination-only')
    expect(buildTagOperationPlan(db, operation).planFingerprint).toBe(initial.planFingerprint)

    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run('Source after', 'source')
    expect(buildTagOperationPlan(db, operation).planFingerprint).not.toBe(initial.planFingerprint)
  })

  it('keeps Preview read-only, including marker/settings and all tag/document rows', () => {
    seedTag(7, 'Java', 'java')
    seedDocument('doc', [7])
    const before = {
      tags: db.prepare('SELECT * FROM tags').all(),
      associations: db.prepare('SELECT * FROM document_tags').all(),
      documents: db.prepare('SELECT * FROM documents').all(),
      settings: db.prepare('SELECT * FROM settings').all(),
    }
    previewTagOperation(db, { kind: 'remove', sourceTagId: 7 })
    expect({
      tags: db.prepare('SELECT * FROM tags').all(),
      associations: db.prepare('SELECT * FROM document_tags').all(),
      documents: db.prepare('SELECT * FROM documents').all(),
      settings: db.prepare('SELECT * FROM settings').all(),
    }).toEqual(before)
  })

  it('returns bounded deterministic pages and rejects stale or tampered continuation', () => {
    seedTag(7, 'Java', 'java')
    for (let i = 0; i < 25; i++) seedDocument(`doc-${String(i).padStart(2, '0')}`, [7])
    const operation: TagOperationRequest = { kind: 'remove', sourceTagId: 7 }
    const preview = previewTagOperation(db, operation)
    expect(preview.sample).toHaveLength(20)
    expect(preview.nextAfterDocumentId).toBe('doc-19')

    const page = previewTagOperationPage(db, operation, preview.planFingerprint, preview.nextAfterDocumentId!, 3)
    expect(page.sample.map((document) => document.id)).toEqual(['doc-20', 'doc-21', 'doc-22'])
    expect(page.nextAfterDocumentId).toBe('doc-22')
    expectDomainCode(
      () => previewTagOperationPage(db, operation, preview.planFingerprint, 'unrelated', 3),
      'INVALID_OPERATION',
    )

    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run('Changed', 'doc-20')
    expectDomainCode(
      () => previewTagOperationPage(db, operation, preview.planFingerprint, 'doc-19', 3),
      'PREVIEW_STALE',
    )

    db.prepare('DELETE FROM tags WHERE id = ?').run(7)
    expectDomainCode(
      () => previewTagOperationPage(db, operation, preview.planFingerprint, 'doc-19', 3),
      'PREVIEW_STALE',
    )
  })

  it('uses a deferred read transaction snapshot while another WAL connection commits', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-tag-preview-wal-'))
    const databasePath = path.join(directory, 'preview.db')
    const first = new Database(databasePath)
    const second = new Database(databasePath)
    try {
      first.pragma('journal_mode = WAL')
      first.pragma('foreign_keys = ON')
      applyMigrations(first)
      second.pragma('journal_mode = WAL')
      second.pragma('foreign_keys = ON')
      seedTagOn(first, 7, 'Java', 'java')
      seedDocumentOn(first, 'doc', [7], { title: 'Before' })
      const operation: TagOperationRequest = { kind: 'rename', sourceTagId: 7, destinationName: 'Backend' }
      __setTagManagementPlannerHookForTesting((stage) => {
        if (stage !== 'after-affected-document-read') return
        second.prepare('UPDATE documents SET title = ? WHERE id = ?').run('After', 'doc')
      })

      const preview = previewTagOperation(first, operation)
      expect(preview.sample[0]).toMatchObject({ id: 'doc', title: 'Before' })
      expect(previewTagOperation(first, operation).sample[0]).toMatchObject({ id: 'doc', title: 'After' })
    } finally {
      __setTagManagementPlannerHookForTesting(null)
      if (second.open) second.close()
      if (first.open) first.close()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})

describe('tag management input safety and set-based scale', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '7', null])(
    'rejects unsafe source ID %p',
    (sourceTagId) => {
      expectDomainCode(() => parseTagOperation({ kind: 'remove', sourceTagId }), 'INVALID_OPERATION')
    },
  )

  it('rejects unknown fields, invalid fingerprints, oversized pages, and unsafe names', () => {
    expectDomainCode(() => parseTagOperation({ kind: 'remove', sourceTagId: 7, clientAffectedDocuments: [] }), 'INVALID_OPERATION')
    expectDomainCode(() => parseTagOperation({ kind: 'rename', sourceTagId: 7, destinationName: 'bad\u0000name' }), 'INVALID_TAG_NAME')
    expectDomainCode(() => parseTagOperation({ kind: 'rename', sourceTagId: 7, destinationName: 'x'.repeat(101) }), 'INVALID_TAG_NAME')
    expectDomainCode(() => parsePreviewPageRequest({ operation: { kind: 'remove', sourceTagId: 7 }, planFingerprint: 'A'.repeat(64) }), 'INVALID_OPERATION')
    expectDomainCode(() => parsePreviewPageRequest({ operation: { kind: 'remove', sourceTagId: 7 }, planFingerprint: 'a'.repeat(64), limit: 101 }), 'INVALID_OPERATION')
  })

  it('keeps planner query shapes constant as the affected set grows', () => {
    seedTag(7, 'Java', 'java')
    for (let i = 0; i < 100; i++) seedDocument(`doc-${i}`, [7])
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
    buildTagOperationPlan(countedDb, { kind: 'remove', sourceTagId: 7 })
    expect(preparedStatements).toHaveLength(3)
    expect(preparedStatements.some((sql) => sql.includes('IN (?, ?,'))).toBe(false)
  })

  it('handles the deterministic 10k-document / 50k-association fixture structurally', () => {
    for (let tagId = 1; tagId <= 5; tagId++) seedTag(tagId, `Tag-${tagId}`, `tag-${tagId}`)
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

    const plan = buildTagOperationPlan(db, { kind: 'merge', sourceTagId: 1, destinationTagId: 2 })
    expect(plan.affectedCount).toBe(10000)
    expect(plan.associationAdds).toBe(0)
    expect(plan.associationRemoves).toBe(10000)
    expect(plan.duplicateCollapses).toBe(10000)
    expect(plan.sample).toHaveLength(20)
    expect(isPlanFingerprint(plan.planFingerprint)).toBe(true)
  })
})

function seedTagOn(database: Database.Database, id: number, displayName: string, normalizedName: string): void {
  database.prepare('INSERT INTO tags (id, name, normalized_name) VALUES (?, ?, ?)').run(id, displayName, normalizedName)
}

function seedDocumentOn(
  database: Database.Database,
  id: string,
  tagIds: number[],
  options: { title?: string; summary?: string; createdAt?: number; updatedAt?: number } = {},
): void {
  const createdAt = options.createdAt ?? 100
  const updatedAt = options.updatedAt ?? createdAt
  database.prepare(`
    INSERT INTO documents (id, path, title, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, `${id}/note`, options.title ?? id, options.summary ?? '', createdAt, updatedAt)
  const insert = database.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)')
  for (const tagId of tagIds) insert.run(id, tagId)
}
