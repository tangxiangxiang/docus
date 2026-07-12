import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { applyMigrations } from '../db'
import {
  deleteDocumentMetadata,
  ensureDocumentMetadata,
  getDocumentMetadata,
  listDocumentMetadata,
  moveDocumentMetadata,
  moveDocumentMetadataPrefix,
  deleteDocumentMetadataPrefix,
  saveDocumentMetadata,
} from '../documentMetadata'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
})

describe('document metadata repository', () => {
  it('creates and reads normalized metadata', () => {
    const saved = saveDocumentMetadata(db, {
      id: 'doc-1', path: 'archive/example', title: ' Example ', summary: ' Summary ',
      tags: ['RAG', 'rag', ' notes '], aliases: ['Example', ' Example '],
      createdAt: 10, updatedAt: 20,
    })
    expect(saved).toMatchObject({
      id: 'doc-1', path: 'archive/example', title: 'Example', summary: 'Summary',
      tags: ['notes', 'RAG'], aliases: ['Example'], createdAt: 10, updatedAt: 20,
    })
  })

  it('updates metadata without changing document identity or creation time', () => {
    const first = saveDocumentMetadata(db, { id: 'stable', path: 'inbox/a', title: 'A', createdAt: 10, updatedAt: 20 })
    const second = saveDocumentMetadata(db, { path: 'inbox/a', title: 'B', tags: ['updated'], updatedAt: 30 })
    expect(second).toMatchObject({ id: first.id, title: 'B', createdAt: 10, updatedAt: 30, tags: ['updated'] })
  })

  it('moves and deletes metadata with related rows', () => {
    saveDocumentMetadata(db, { id: 'doc-1', path: 'inbox/a', title: 'A', tags: ['tag'], aliases: ['alias'] })
    db.prepare(`
      INSERT INTO metadata_migrations (path, status, source_hash, error, updated_at)
      VALUES ('inbox/a', 'verified', 'hash', '', 1)
    `).run()
    expect(moveDocumentMetadata(db, 'inbox/a', 'archive/a')).toBe(true)
    expect(getDocumentMetadata(db, 'inbox/a')).toBeNull()
    expect(getDocumentMetadata(db, 'archive/a')?.id).toBe('doc-1')
    expect(db.prepare('SELECT path FROM metadata_migrations').get()).toEqual({ path: 'archive/a' })
    expect(deleteDocumentMetadata(db, 'archive/a')).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM document_tags').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM document_aliases').get()).toEqual({ n: 0 })
    // The backup survives under an orphaned tombstone, no longer occupying
    // the user-visible path or being eligible for restore.
    expect(db.prepare('SELECT original_path, status FROM metadata_migrations').get()).toEqual({
      original_path: 'archive/a', status: 'orphaned',
    })
  })

  it('lists documents in path order and rejects invalid input', () => {
    saveDocumentMetadata(db, { path: 'b', title: 'B' })
    saveDocumentMetadata(db, { path: 'a', title: 'A' })
    expect(listDocumentMetadata(db).map((item) => item.path)).toEqual(['a', 'b'])
    expect(() => saveDocumentMetadata(db, { path: '', title: 'A' })).toThrow('metadata path is required')
    expect(() => saveDocumentMetadata(db, { path: 'a', title: ' ' })).toThrow('metadata title is required')
  })

  it('moves and deletes folder prefixes transactionally', () => {
    saveDocumentMetadata(db, { id: 'a', path: 'inbox/folder/a', title: 'A' })
    saveDocumentMetadata(db, { id: 'b', path: 'inbox/folder/nested/b', title: 'B' })
    saveDocumentMetadata(db, { id: 'c', path: 'inbox/other', title: 'C' })
    expect(moveDocumentMetadataPrefix(db, 'inbox/folder', 'literature/folder')).toBe(2)
    expect(getDocumentMetadata(db, 'literature/folder/a')?.id).toBe('a')
    expect(getDocumentMetadata(db, 'literature/folder/nested/b')?.id).toBe('b')
    expect(deleteDocumentMetadataPrefix(db, 'literature/folder')).toBe(2)
    expect(listDocumentMetadata(db).map((item) => item.path)).toEqual(['inbox/other'])
  })

  it('refuses prefix moves into the source subtree', () => {
    saveDocumentMetadata(db, { id: 'root', path: 'notes', title: 'Notes' })
    saveDocumentMetadata(db, { id: 'child', path: 'notes/2026/a', title: 'A' })
    expect(() => moveDocumentMetadataPrefix(db, 'notes', 'notes/2026'))
      .toThrow(/into its own subtree/)
    // Transaction rolled back: source rows are still where they started.
    expect(listDocumentMetadata(db).map((item) => item.path).sort()).toEqual(['notes', 'notes/2026/a'])
  })

  it('refuses a no-op prefix move', () => {
    saveDocumentMetadata(db, { path: 'inbox/a', title: 'A' })
    expect(() => moveDocumentMetadataPrefix(db, 'inbox', 'inbox'))
      .toThrow(/identical/)
    expect(getDocumentMetadata(db, 'inbox/a')?.title).toBe('A')
  })

  it('refuses a prefix move that would collide with an unrelated path', () => {
    saveDocumentMetadata(db, { id: 'a', path: 'inbox/a', title: 'A' })
    saveDocumentMetadata(db, { id: 'unrelated', path: 'archive/a', title: 'Archive' })
    expect(() => moveDocumentMetadataPrefix(db, 'inbox', 'archive'))
      .toThrow(/collides with existing path: archive\/a/)
    expect(getDocumentMetadata(db, 'inbox/a')?.id).toBe('a')
    expect(getDocumentMetadata(db, 'archive/a')?.id).toBe('unrelated')
  })

  it('preserves frontmatter_backup when deleting a cleaned document', () => {
    saveDocumentMetadata(db, { path: 'inbox/a', title: 'A' })
    db.prepare(`
      INSERT INTO metadata_migrations (path, status, source_hash, frontmatter_backup, error, updated_at)
      VALUES ('inbox/a', 'cleaned', 'hash', '---original---', '', 1)
    `).run()
    expect(deleteDocumentMetadata(db, 'inbox/a')).toBe(true)
    // The backup survives — it's the only place the pre-cleanup bytes live.
    expect(db.prepare(
      'SELECT status, original_path AS originalPath, frontmatter_backup AS backup FROM metadata_migrations',
    ).get()).toEqual({ status: 'orphaned', originalPath: 'inbox/a', backup: '---original---' })
  })

  it('preserves per-file migration rows when deleting a folder prefix', () => {
    saveDocumentMetadata(db, { path: 'inbox/a', title: 'A' })
    saveDocumentMetadata(db, { path: 'inbox/b', title: 'B' })
    db.prepare(`
      INSERT INTO metadata_migrations (path, status, source_hash, frontmatter_backup, error, updated_at)
      VALUES ('inbox/a', 'cleaned', 'h1', '---A---', '', 1),
             ('inbox/b', 'cleaned', 'h2', '---B---', '', 1)
    `).run()
    expect(deleteDocumentMetadataPrefix(db, 'inbox')).toBe(2)
    expect(db.prepare(
      `SELECT original_path AS originalPath, status, frontmatter_backup AS backup
       FROM metadata_migrations ORDER BY original_path`,
    ).all()).toEqual([
      { originalPath: 'inbox/a', status: 'orphaned', backup: '---A---' },
      { originalPath: 'inbox/b', status: 'orphaned', backup: '---B---' },
    ])
  })

  it('keeps a newer stored updatedAt across a save with an older mtime', () => {
    // External editor advances the file's `updated:` field without
    // bumping mtime (e.g. git checkout preserves mtime). The PUT path
    // calls ensureDocumentMetadata with the older mtimeMs — without
    // Math.max the stored updatedAt would silently move backwards.
    const futureMs = Date.UTC(2026, 6, 12)
    const oldMtimeMs = Date.UTC(2026, 5, 1)
    saveDocumentMetadata(db, { path: 'inbox/note', title: 'Note', updatedAt: futureMs })
    const result = ensureDocumentMetadata(db, 'inbox/note', 'body', oldMtimeMs, oldMtimeMs)
    expect(result.updatedAt).toBe(futureMs)
  })

  it('imports a fresh row using the frontmatter updated: field when it is newer than mtime', () => {
    const futureMs = Date.UTC(2026, 6, 12)
    const oldMtimeMs = Date.UTC(2026, 5, 1)
    const raw = [
      '---',
      'title: Note',
      `updated: ${new Date(futureMs).toISOString().slice(0, 10)}`,
      '---',
      '',
      'body',
    ].join('\n')
    const result = ensureDocumentMetadata(db, 'inbox/note', raw, oldMtimeMs, oldMtimeMs)
    expect(result.updatedAt).toBe(futureMs)
  })
})
