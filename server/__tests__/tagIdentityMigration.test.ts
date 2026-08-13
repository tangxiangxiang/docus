import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import {
  __setTagIdentityMigrationFailureForTesting,
  getTagIdentityHealth,
  initializeTagIdentityAndHealth,
  resetTagIdentityHealthForTesting,
  runTagIdentityMigrationForTesting,
  TAG_IDENTITY_MIGRATION_KEY,
} from '../tagIdentityMigration'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
})

afterEach(() => {
  __setTagIdentityMigrationFailureForTesting(null)
  resetTagIdentityHealthForTesting(db)
  db.close()
})

function seedCollision(): void {
  db.exec(`
    INSERT INTO documents (id, path, title, summary, created_at, updated_at)
      VALUES ('a', 'a', 'A', '', 100, 100), ('b', 'b', 'B', '', 200, 200);
    INSERT INTO tags (id, name, normalized_name) VALUES
      (3, 'Java', 'Java'),
      (8, '#java', '#java'),
      (11, 'JAVA', 'JAVA');
    INSERT INTO document_tags (document_id, tag_id) VALUES
      ('a', 3), ('a', 8), ('b', 8), ('b', 11);
  `)
}

describe('T2-0 tag identity migration', () => {
  it('consolidates collisions deterministically and preserves logical memberships', () => {
    seedCollision()
    const result = runTagIdentityMigrationForTesting(db)
    expect(result.complete).toBe(true)
    expect(db.prepare('SELECT id, name, normalized_name FROM tags').all()).toEqual([
      { id: 3, name: 'Java', normalized_name: 'java' },
    ])
    expect(db.prepare('SELECT document_id, tag_id FROM document_tags ORDER BY document_id').all()).toEqual([
      { document_id: 'a', tag_id: 3 },
      { document_id: 'b', tag_id: 3 },
    ])
    const versions = db.prepare('SELECT updated_at FROM documents ORDER BY id').all() as Array<{ updated_at: number }>
    expect(versions[0].updated_at).toBeGreaterThan(200)
    expect(versions[1].updated_at).toBe(versions[0].updated_at)
    expect(result.report.tagRowsDeleted).toBe(2)
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get(TAG_IDENTITY_MIGRATION_KEY)).toBeTruthy()
  })

  it('is idempotent after the complete marker', () => {
    seedCollision()
    expect(runTagIdentityMigrationForTesting(db).complete).toBe(true)
    const before = db.prepare('SELECT * FROM documents ORDER BY id').all()
    const second = runTagIdentityMigrationForTesting(db)
    expect(second.complete).toBe(true)
    expect(db.prepare('SELECT * FROM documents ORDER BY id').all()).toEqual(before)
  })

  it('fails closed and rolls back association repointing', () => {
    seedCollision()
    const beforeTags = db.prepare('SELECT * FROM tags ORDER BY id').all()
    const beforeAssociations = db.prepare('SELECT * FROM document_tags ORDER BY document_id, tag_id').all()
    __setTagIdentityMigrationFailureForTesting('after-association-repoint')
    const result = runTagIdentityMigrationForTesting(db)
    expect(result.complete).toBe(false)
    expect(result.code).toBe('TAG_IDENTITY_MIGRATION_FAILED')
    expect(db.prepare('SELECT * FROM tags ORDER BY id').all()).toEqual(beforeTags)
    expect(db.prepare('SELECT * FROM document_tags ORDER BY document_id, tag_id').all()).toEqual(beforeAssociations)
    const marker = JSON.parse((db.prepare('SELECT value FROM settings WHERE key = ?').get(TAG_IDENTITY_MIGRATION_KEY) as { value: string }).value)
    expect(marker).toMatchObject({ status: 'failed', errorCode: 'TAG_IDENTITY_MIGRATION_FAILED' })
  })

  it('rejects invalid historical data without deleting it', () => {
    db.exec(`INSERT INTO tags (id, name, normalized_name) VALUES (3, '#', '#')`)
    const before = db.prepare('SELECT * FROM tags').all()
    const result = runTagIdentityMigrationForTesting(db)
    expect(result.complete).toBe(false)
    expect(db.prepare('SELECT * FROM tags').all()).toEqual(before)
  })

  it('reports healthy only after migration and live metadata checks', async () => {
    const root = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp('t2-0-health-'))
    try {
      const health = await initializeTagIdentityAndHealth(db, root, {
        scanned: 0, imported: 0, verified: 0, skipped: 0, failed: 0, pruned: 0,
      })
      expect(health.state).toBe('healthy')
      expect(getTagIdentityHealth(db).state).toBe('healthy')
    } finally {
      await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }))
    }
  })
})
