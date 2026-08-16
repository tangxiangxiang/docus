import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import {
  applyDocumentTagsSetDiff,
  getDocumentMetadata,
  restoreDocumentMetadataMutation,
  saveDocumentMetadata,
  snapshotDocumentMetadataMutation,
} from '../documentMetadata'
import {
  getDocumentTagsSnapshotGeneration,
  hasValidSnapshotRowSchema,
  isSerializedMetadataSnapshot,
  reviveMetadataSnapshot,
  serializeMetadataSnapshot,
} from '../folderMoveTransaction'
import {
  getTagUndoFoundationHealth,
  initializeTagUndoFoundationHealth,
  resetTagUndoFoundationHealthForTesting,
} from '../tagUndoHealth'

function migratedDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  return db
}

function legacyV6Db(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (6);
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE document_tags (
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (document_id, tag_id)
    );
    CREATE INDEX idx_document_tags_tag ON document_tags(tag_id, document_id);
  `)
  return db
}

function brokenLegacyV6Db(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (6);
    CREATE TABLE documents (id TEXT PRIMARY KEY);
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE document_tags (document_id TEXT NOT NULL);
  `)
  return db
}

function seedDocument(db: Database.Database, tags: string[] = ['Backend']): void {
  saveDocumentMetadata(db, {
    id: 'doc-1',
    path: 'notes/one',
    title: 'One',
    tags,
    createdAt: 1,
    updatedAt: 10,
  })
}

describe('T2.1-0 migration and foundation health', () => {
  it('rebuilds a populated v6 association graph with explicit unique IDs', () => {
    const db = legacyV6Db()
    db.exec(`
      INSERT INTO documents (id, path, title, summary, created_at, updated_at)
      VALUES ('a', 'notes/a', 'A', '', 1, 10), ('b', 'notes/b', 'B', '', 2, 20);
      INSERT INTO tags (id, name, normalized_name)
      VALUES (7, 'Java', 'java'), (9, 'Python', 'python');
      INSERT INTO document_tags (document_id, tag_id)
      VALUES ('a', 7), ('a', 9), ('b', 7);
    `)

    applyMigrations(db)

    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(7)
    expect(db.prepare('SELECT document_id, tag_id FROM document_tags ORDER BY document_id, tag_id').all()).toEqual([
      { document_id: 'a', tag_id: 7 },
      { document_id: 'a', tag_id: 9 },
      { document_id: 'b', tag_id: 7 },
    ])
    const associations = db.prepare('SELECT association_id FROM document_tags ORDER BY association_id').all() as Array<{ association_id: number }>
    expect(associations).toHaveLength(3)
    expect(new Set(associations.map((row) => row.association_id)).size).toBe(3)
    expect(associations.every((row) => row.association_id > 0)).toBe(true)
    expect(() => db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)').run('a', 7)).toThrow()
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'document_tags'").all()).toEqual(expect.arrayContaining([
      { name: 'idx_document_tags_tag' },
      { name: 'idx_document_tags_document' },
    ]))
  })

  it('is idempotent and exposes a healthy foundation without activating Undo', () => {
    const db = migratedDb()
    const before = db.prepare('SELECT * FROM tag_undo_state').all()
    applyMigrations(db)
    expect(db.prepare('SELECT * FROM tag_undo_state').all()).toEqual(before)

    const health = initializeTagUndoFoundationHealth(db)
    expect(health).toMatchObject({ state: 'healthy', schemaVersion: 7 })
    expect(getTagUndoFoundationHealth(db)).toEqual(health)
    expect(db.prepare('SELECT COUNT(*) AS count FROM tag_undo_records').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT current_record_id FROM tag_undo_state').get()).toEqual({ current_record_id: null })
    resetTagUndoFoundationHealthForTesting(db)
    db.close()
  })

  it('fails foundation health closed when the singleton is malformed', () => {
    const db = migratedDb()
    db.prepare('UPDATE tag_undo_state SET database_generation = ? WHERE state_id = 1').run('bad')
    expect(initializeTagUndoFoundationHealth(db)).toMatchObject({
      state: 'unavailable',
      code: 'TAG_UNDO_FOUNDATION_UNHEALTHY',
    })
    db.close()
  })

  it('rolls back a failed 0007 rebuild without changing the v6 database', () => {
    const db = brokenLegacyV6Db()
    expect(() => applyMigrations(db)).toThrow()
    expect((db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(6)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'document_tags'").get()).toEqual({ name: 'document_tags' })
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'document_tags_phase21'").get()).toBeUndefined()
    db.close()
  })
})

describe('T2.1-0 ordinary association provenance', () => {
  it('preserves unchanged IDs, inserts only additions, and deletes only removals', () => {
    const db = migratedDb()
    seedDocument(db, ['Backend', 'Python'])
    const backendBefore = db.prepare("SELECT association_id FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = 'doc-1' AND t.normalized_name = 'backend'").get() as { association_id: number }
    const pythonBefore = db.prepare("SELECT association_id FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = 'doc-1' AND t.normalized_name = 'python'").get() as { association_id: number }

    const diff = applyDocumentTagsSetDiff(db, 'doc-1', [
      { displayName: 'Backend', normalizedName: 'backend' },
      { displayName: 'Vue', normalizedName: 'vue' },
    ])
    expect(diff.unchangedAssociationIds).toEqual([backendBefore.association_id])
    expect(diff.removedAssociationIds).toEqual([pythonBefore.association_id])
    expect(diff.addedAssociationIds).toHaveLength(1)
    expect(db.prepare("SELECT association_id FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = 'doc-1' AND t.normalized_name = 'backend'").get()).toEqual(backendBefore)
    expect(db.prepare("SELECT association_id FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = 'doc-1' AND t.normalized_name = 'vue'").get()).toEqual({ association_id: diff.addedAssociationIds[0] })
    db.close()
  })

  it('does no association rewrite for an identical set and allocates a new ID after delete/re-add', () => {
    const db = migratedDb()
    seedDocument(db, ['Backend'])
    const before = db.prepare('SELECT association_id FROM document_tags WHERE document_id = ?').get('doc-1') as { association_id: number }
    const noOp = applyDocumentTagsSetDiff(db, 'doc-1', [{ displayName: 'Backend', normalizedName: 'backend' }])
    expect(noOp).toEqual({
      unchangedAssociationIds: [before.association_id],
      addedAssociationIds: [],
      removedAssociationIds: [],
    })
    expect(db.prepare('SELECT association_id FROM document_tags WHERE document_id = ?').get('doc-1')).toEqual(before)

    applyDocumentTagsSetDiff(db, 'doc-1', [])
    const readded = applyDocumentTagsSetDiff(db, 'doc-1', [{ displayName: 'Backend', normalizedName: 'backend' }])
    expect(readded.addedAssociationIds[0]).toBeGreaterThan(before.association_id)
    expect(readded.addedAssociationIds[0]).not.toBe(before.association_id)
    db.close()
  })
})

describe('T2.1-0 v6/v7 durable metadata snapshot compatibility', () => {
  it('accepts exact legacy v6 and marked v7 rows, but rejects mixed rows', () => {
    const base = {
      paths: ['notes/one'],
      documentIds: ['doc-1'],
      tagIds: [1],
      preexistingTagIds: [1],
      documents: [{ id: 'doc-1', path: 'notes/one', title: 'One', summary: '', created_at: 1, updated_at: 10 }],
      tags: [{ id: 1, name: 'Backend', normalized_name: 'backend' }],
      embeddings: [],
      migrations: [],
    }
    const v6 = { ...base, documentTags: [{ document_id: 'doc-1', tag_id: 1 }] }
    const v7 = { ...base, documentTagsVersion: 7 as const, documentTags: [{ association_id: 51, document_id: 'doc-1', tag_id: 1 }] }
    const mixed = { ...base, documentTags: [...v6.documentTags, ...v7.documentTags] }

    expect(isSerializedMetadataSnapshot(v6)).toBe(true)
    expect(hasValidSnapshotRowSchema(v6)).toBe(true)
    expect(getDocumentTagsSnapshotGeneration(v6)).toBe('v6')
    expect(isSerializedMetadataSnapshot(v7)).toBe(true)
    expect(getDocumentTagsSnapshotGeneration(v7)).toBe('v7')
    expect(isSerializedMetadataSnapshot(mixed)).toBe(false)
    expect(getDocumentTagsSnapshotGeneration(mixed)).toBeNull()
  })

  it('preserves an existing v7 ID and allocates a new ID for a missing v6 row', () => {
    const db = migratedDb()
    db.prepare("INSERT INTO documents (id, path, title, summary, created_at, updated_at) VALUES ('doc-1', 'notes/one', 'One', '', 1, 10)").run()
    db.prepare("INSERT INTO tags (id, name, normalized_name) VALUES (1, 'Backend', 'backend')").run()
    db.prepare("INSERT INTO document_tags (association_id, document_id, tag_id) VALUES (51, 'doc-1', 1)").run()
    const v6Snapshot = {
      paths: ['notes/one'],
      documentIds: ['doc-1'],
      tagIds: [1],
      preexistingTagIds: [1],
      documents: [{ id: 'doc-1', path: 'notes/one', title: 'One', summary: '', created_at: 1, updated_at: 10 }],
      tags: [{ id: 1, name: 'Backend', normalized_name: 'backend' }],
      documentTags: [{ document_id: 'doc-1', tag_id: 1 }],
      embeddings: [],
      migrations: [],
    }
    restoreDocumentMetadataMutation(db, reviveMetadataSnapshot(v6Snapshot))
    expect(db.prepare('SELECT association_id FROM document_tags').get()).toEqual({ association_id: 51 })

    db.prepare('DELETE FROM documents WHERE id = ?').run('doc-1')
    restoreDocumentMetadataMutation(db, reviveMetadataSnapshot(v6Snapshot))
    const restored = db.prepare('SELECT association_id FROM document_tags').get() as { association_id: number }
    expect(restored.association_id).toBeGreaterThan(51)
    db.close()
  })

  it('handles a v6 snapshot with both proven live and missing associations', () => {
    const db = migratedDb()
    db.exec(`
      INSERT INTO documents (id, path, title, summary, created_at, updated_at)
      VALUES ('doc-1', 'notes/one', 'One', '', 1, 10);
      INSERT INTO tags (id, name, normalized_name) VALUES (1, 'Backend', 'backend');
      INSERT INTO document_tags (association_id, document_id, tag_id)
      VALUES (51, 'doc-1', 1);
    `)
    const v6Snapshot = {
      paths: ['notes/one', 'notes/two'],
      documentIds: ['doc-1', 'doc-2'],
      tagIds: [1],
      preexistingTagIds: [1],
      documents: [
        { id: 'doc-1', path: 'notes/one', title: 'One', summary: '', created_at: 1, updated_at: 10 },
        { id: 'doc-2', path: 'notes/two', title: 'Two', summary: '', created_at: 2, updated_at: 20 },
      ],
      tags: [{ id: 1, name: 'Backend', normalized_name: 'backend' }],
      documentTags: [
        { document_id: 'doc-1', tag_id: 1 },
        { document_id: 'doc-2', tag_id: 1 },
      ],
      embeddings: [],
      migrations: [],
    }

    restoreDocumentMetadataMutation(db, reviveMetadataSnapshot(v6Snapshot))
    expect(db.prepare('SELECT association_id FROM document_tags WHERE document_id = ?').get('doc-1')).toEqual({ association_id: 51 })
    const newAssociation = db.prepare('SELECT association_id FROM document_tags WHERE document_id = ?').get('doc-2') as { association_id: number }
    expect(newAssociation.association_id).toBeGreaterThan(51)
    db.close()
  })

  it('marks new durable snapshots as v7 with explicit physical identity', () => {
    const db = migratedDb()
    seedDocument(db)
    const serialized = serializeMetadataSnapshot(snapshotDocumentMetadataMutation(db, ['notes/one']))
    expect(serialized.documentTagsVersion).toBe(7)
    expect(getDocumentTagsSnapshotGeneration(serialized)).toBe('v7')
    expect(serialized.documentTags[0]).toHaveProperty('association_id')
    db.close()
  })
})
