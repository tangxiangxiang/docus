import { randomUUID } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import matter from 'gray-matter'

export interface DocumentMetadata {
  id: string
  path: string
  title: string
  summary: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface SaveDocumentMetadata {
  id?: string
  path: string
  title: string
  summary?: string
  tags?: string[]
  createdAt?: number
  updatedAt?: number
}

/**
 * Exact rollback image for the SQLite-owned document metadata graph.
 *
 * This intentionally snapshots rows instead of hydrated business objects:
 * rollback must preserve stable document/tag identities and migration
 * tombstones exactly, including the meaningful state "metadata exists while
 * the Markdown file does not".
 */
export type DocumentMetadataDatabaseSnapshot = {
  documents: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  documentTags: Record<string, unknown>[]
  embeddings: Record<string, unknown>[]
  migrations: Record<string, unknown>[]
}

export type DocumentMetadataMutationSnapshot = DocumentMetadataDatabaseSnapshot & {
  paths: string[]
  documentIds: string[]
  tagIds: number[]
  preexistingTagIds: number[]
}

export function snapshotDocumentMetadataDatabase(db: DatabaseT): DocumentMetadataDatabaseSnapshot {
  return {
    documents: db.prepare('SELECT * FROM documents ORDER BY id').all() as Record<string, unknown>[],
    tags: db.prepare('SELECT * FROM tags ORDER BY id').all() as Record<string, unknown>[],
    documentTags: db.prepare('SELECT * FROM document_tags ORDER BY document_id, tag_id').all() as Record<string, unknown>[],
    embeddings: db.prepare('SELECT * FROM document_embeddings ORDER BY document_id').all() as Record<string, unknown>[],
    migrations: db.prepare('SELECT * FROM metadata_migrations ORDER BY path').all() as Record<string, unknown>[],
  }
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

/** Capture only the metadata graph owned by the paths in one file mutation. */
export function snapshotDocumentMetadataMutation(
  db: DatabaseT,
  inputPaths: readonly string[],
): DocumentMetadataMutationSnapshot {
  const paths = [...new Set(inputPaths)]
  const preexistingTagIds = (db.prepare('SELECT id FROM tags').all() as Array<{ id: number }>).map((row) => row.id)
  if (!paths.length) return { paths, documentIds: [], tagIds: [], preexistingTagIds, documents: [], tags: [], documentTags: [], embeddings: [], migrations: [] }
  const documents = db.prepare(`SELECT * FROM documents WHERE path IN (${placeholders(paths)}) ORDER BY id`)
    .all(...paths) as Record<string, unknown>[]
  const documentIds = documents.map((row) => String(row.id))
  const documentTags = documentIds.length
    ? db.prepare(`SELECT * FROM document_tags WHERE document_id IN (${placeholders(documentIds)}) ORDER BY document_id, tag_id`).all(...documentIds) as Record<string, unknown>[]
    : []
  const tagIds = [...new Set(documentTags.map((row) => Number(row.tag_id)))]
  const tags = tagIds.length
    ? db.prepare(`SELECT * FROM tags WHERE id IN (${placeholders(tagIds)}) ORDER BY id`).all(...tagIds) as Record<string, unknown>[]
    : []
  const embeddings = documentIds.length
    ? db.prepare(`SELECT * FROM document_embeddings WHERE document_id IN (${placeholders(documentIds)}) ORDER BY document_id`).all(...documentIds) as Record<string, unknown>[]
    : []
  const migrationClauses = paths.map(() => 'path = ?').concat(paths.map(() => 'original_path = ?'), documentIds.map(() => 'path = ?'), documentIds.map(() => 'document_id = ?'))
  const migrationArgs = [...paths, ...paths, ...documentIds.map((id) => `@deleted/${id}`), ...documentIds]
  const migrations = migrationClauses.length
    ? db.prepare(`SELECT * FROM metadata_migrations WHERE ${migrationClauses.join(' OR ')} ORDER BY path`).all(...migrationArgs) as Record<string, unknown>[]
    : []
  return { paths, documentIds, tagIds, preexistingTagIds, documents, tags, documentTags, embeddings, migrations }
}

/** Expand folder prefixes to the exact rows they currently own, including
 * recovery-only migration rows for files that do not exist on disk. */
export function snapshotDocumentMetadataPrefixMutation(
  db: DatabaseT,
  prefixes: readonly string[],
  extraPaths: readonly string[] = [],
): DocumentMetadataMutationSnapshot {
  const normalized = [...new Set(prefixes)]
  const matched = new Set(extraPaths)
  for (const prefix of normalized) {
    const like = `${prefix}/%`
    for (const row of db.prepare('SELECT path FROM documents WHERE path = ? OR path LIKE ?').all(prefix, like) as Array<{ path: string }>) {
      matched.add(row.path)
    }
    for (const row of db.prepare(`SELECT path, original_path FROM metadata_migrations
      WHERE path = ? OR path LIKE ? OR original_path = ? OR original_path LIKE ?`).all(prefix, like, prefix, like) as Array<{ path: string; original_path: string }>) {
      if (!row.path.startsWith('@deleted/')) matched.add(row.path)
      if (row.original_path) matched.add(row.original_path)
    }
  }
  return snapshotDocumentMetadataMutation(db, [...matched])
}

function insertRows(db: DatabaseT, table: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return
  const columns = Object.keys(rows[0])
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((column) => `@${column}`).join(', ')})`
  const insert = db.prepare(sql)
  for (const row of rows) insert.run(row)
}

export function restoreDocumentMetadataDatabase(
  db: DatabaseT,
  snapshot: DocumentMetadataDatabaseSnapshot,
): void {
  db.transaction(() => {
    db.exec(`
      DELETE FROM metadata_migrations;
      DELETE FROM document_tags;
      DELETE FROM document_embeddings;
      DELETE FROM documents;
      DELETE FROM tags;
    `)
    insertRows(db, 'documents', snapshot.documents)
    insertRows(db, 'tags', snapshot.tags)
    insertRows(db, 'document_tags', snapshot.documentTags)
    insertRows(db, 'document_embeddings', snapshot.embeddings)
    insertRows(db, 'metadata_migrations', snapshot.migrations)
  })()
}

/** Restore one locked mutation footprint without touching unrelated commits. */
export function restoreDocumentMetadataMutation(
  db: DatabaseT,
  snapshot: DocumentMetadataMutationSnapshot,
): void {
  db.transaction(() => {
    const currentDocuments = snapshot.paths.length
      ? db.prepare(`SELECT id FROM documents WHERE path IN (${placeholders(snapshot.paths)})`).all(...snapshot.paths) as Array<{ id: string }>
      : []
    const affectedIds = [...new Set([...snapshot.documentIds, ...currentDocuments.map((row) => row.id)])]
    if (affectedIds.length) {
      db.prepare(`DELETE FROM document_tags WHERE document_id IN (${placeholders(affectedIds)})`).run(...affectedIds)
      db.prepare(`DELETE FROM document_embeddings WHERE document_id IN (${placeholders(affectedIds)})`).run(...affectedIds)
      db.prepare(`DELETE FROM documents WHERE id IN (${placeholders(affectedIds)})`).run(...affectedIds)
    }
    if (snapshot.paths.length || affectedIds.length) {
      const clauses = snapshot.paths.map(() => 'path = ?').concat(snapshot.paths.map(() => 'original_path = ?'), affectedIds.map(() => 'path = ?'), affectedIds.map(() => 'document_id = ?'))
      db.prepare(`DELETE FROM metadata_migrations WHERE ${clauses.join(' OR ')}`)
        .run(...snapshot.paths, ...snapshot.paths, ...affectedIds.map((id) => `@deleted/${id}`), ...affectedIds)
    }
    insertRows(db, 'documents', snapshot.documents)
    for (const tag of snapshot.tags) {
      const columns = Object.keys(tag)
      db.prepare(`INSERT OR IGNORE INTO tags (${columns.join(', ')}) VALUES (${columns.map((key) => `@${key}`).join(', ')})`).run(tag)
    }
    insertRows(db, 'document_tags', snapshot.documentTags)
    insertRows(db, 'document_embeddings', snapshot.embeddings)
    insertRows(db, 'metadata_migrations', snapshot.migrations)

    // Tags created solely by the failed mutation are safe to remove only
    // when no successful document currently references them.
    const createdTagIds = (db.prepare('SELECT id FROM tags').all() as Array<{ id: number }>)
      .map((row) => row.id)
      .filter((id) => !snapshot.preexistingTagIds.includes(id))
    if (createdTagIds.length) {
      db.prepare(`DELETE FROM tags WHERE id IN (${placeholders(createdTagIds)}) AND id NOT IN (SELECT DISTINCT tag_id FROM document_tags)`)
        .run(...createdTagIds)
    }
  })()
}

/** Round-10 F8: a restore whose ownership validation and the actual
 * restore happen in the SAME SQLite IMMEDIATE transaction. The
 * `expect` callback runs INSIDE the transaction with a fresh snapshot
 * of the live rows the restore is about to overwrite; if it returns
 * false (or throws) the entire transaction is rolled back and the
 * metadata stays unchanged. Concurrent writers cannot race the
 * restore: better-sqlite3 IMMEDIATE acquires a RESERVED lock before
 * any reads, so the rows the validator observes are exactly the rows
 * the restore writes against. The callback must be synchronous. */
export function restoreDocumentMetadataMutationCAS(
  db: DatabaseT,
  snapshot: DocumentMetadataMutationSnapshot,
  expect?: (current: DocumentMetadataMutationSnapshot) => boolean,
): void {
  const tx = db.transaction(() => {
    if (expect) {
      const current = snapshotDocumentMetadataMutation(db, snapshot.paths)
      let ok = false
      try {
        ok = expect(current)
      } catch (error) {
        // bubble to roll back the transaction
        throw error
      }
      if (!ok) throw new Error('metadata ownership: live rows do not match the restore-time expectation')
    }
    restoreDocumentMetadataMutation(db, snapshot)
  })
  // better-sqlite3's .immediate variant opens the transaction with
  // BEGIN IMMEDIATE — a write lock acquired up front, so the snapshot
  // the validator reads cannot change between the validation and the
  // restore.
  tx.immediate()
}

function dateMs(value: unknown, fallback: number): number {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

type DocumentRow = {
  id: string
  path: string
  title: string
  summary: string
  created_at: number
  updated_at: number
}

function cleanValues(values: string[] = []): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const normalized = trimmed.toLocaleLowerCase()
    if (!trimmed || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(trimmed)
  }
  return result
}

function hydrate(db: DatabaseT, row: DocumentRow): DocumentMetadata {
  const tags = db.prepare(`
    SELECT t.name FROM tags t
    JOIN document_tags dt ON dt.tag_id = t.id
    WHERE dt.document_id = ? ORDER BY t.normalized_name
  `).all(row.id) as Array<{ name: string }>
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    summary: row.summary,
    tags: tags.map((item) => item.name),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getDocumentMetadata(db: DatabaseT, path: string): DocumentMetadata | null {
  const row = db.prepare(
    'SELECT id, path, title, summary, created_at, updated_at FROM documents WHERE path = ?',
  ).get(path) as DocumentRow | undefined
  return row ? hydrate(db, row) : null
}

/** Look a document up by its STABLE identity instead of its path —
 *  the path is a moving attribute (another window may rename at any
 *  time) while the id survives every rename. Draft recovery uses this
 *  to re-validate a document's CURRENT server path when its draft
 *  family has emptied out of IndexedDB: only a by-identity server
 *  query is authoritative there, never a cached tree / tab / posts
 *  path. `updatedAt` doubles as the version token a caller can carry
 *  alongside the path. */
export function getDocumentMetadataById(db: DatabaseT, id: string): DocumentMetadata | null {
  const row = db.prepare(
    'SELECT id, path, title, summary, created_at, updated_at FROM documents WHERE id = ?',
  ).get(id) as DocumentRow | undefined
  return row ? hydrate(db, row) : null
}

export function listDocumentMetadata(db: DatabaseT): DocumentMetadata[] {
  const rows = db.prepare(
    'SELECT id, path, title, summary, created_at, updated_at FROM documents ORDER BY path',
  ).all() as DocumentRow[]
  return rows.map((row) => hydrate(db, row))
}

export function saveDocumentMetadata(db: DatabaseT, input: SaveDocumentMetadata): DocumentMetadata {
  const path = input.path.trim()
  const title = input.title.trim()
  if (!path) throw new Error('metadata path is required')
  if (!title) throw new Error('metadata title is required')

  return db.transaction(() => {
    const existing = getDocumentMetadata(db, path)
    const now = Date.now()
    const id = existing?.id ?? input.id ?? randomUUID()
    const createdAt = input.createdAt ?? existing?.createdAt ?? now
    const updatedAt = input.updatedAt ?? now
    db.prepare(`
      INSERT INTO documents (id, path, title, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        updated_at = excluded.updated_at
    `).run(id, path, title, input.summary?.trim() ?? existing?.summary ?? '', createdAt, updatedAt)

    db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id)
    for (const tag of cleanValues(input.tags ?? existing?.tags)) {
      const normalized = tag.toLocaleLowerCase()
      db.prepare(`
        INSERT INTO tags (name, normalized_name) VALUES (?, ?)
        ON CONFLICT(normalized_name) DO NOTHING
      `).run(tag, normalized)
      const tagRow = db.prepare('SELECT id FROM tags WHERE normalized_name = ?').get(normalized) as { id: number }
      db.prepare('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)').run(id, tagRow.id)
    }

    return getDocumentMetadata(db, path)!
  })()
}

/** Import legacy Frontmatter once, then keep database-owned fields unchanged on body writes. */
export function ensureDocumentMetadata(
  db: DatabaseT,
  path: string,
  raw: string,
  mtimeMs: number,
  updatedAt = mtimeMs,
): DocumentMetadata {
  const existing = getDocumentMetadata(db, path)
  if (existing) {
    // Don't let mtime or a stale `updatedAt` argument push the stored
    // updatedAt backwards. External editors (vim, Obsidian) can advance
    // the frontmatter `updated:` without touching mtime — git checkout in
    // particular preserves mtime — and the database row's updatedAt is
    // supposed to be the user's most recent claim, not the file's clock.
    // Mirror the Math.max guard migrateVaultMetadata uses on re-import.
    return saveDocumentMetadata(db, {
      ...existing,
      updatedAt: Math.max(existing.updatedAt, updatedAt, mtimeMs),
    })
  }

  const parsed = matter(raw)
  const fallbackTitle = path.split('/').pop()!
  const heading = /^#\s+(.+)$/m.exec(parsed.content)?.[1]?.trim()
  const title = typeof parsed.data.title === 'string' && parsed.data.title.trim()
    ? parsed.data.title.trim()
    : heading || fallbackTitle
  const tags = Array.isArray(parsed.data.tags)
    ? parsed.data.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
    : []
  // First-time import: trust the file's frontmatter `updated:` when it
  // parses to a later date than mtime (e.g. user edited in vim then
  // git-checked-out without restoring mtime).
  const legacyUpdatedAt = dateMs(parsed.data.updated, mtimeMs)
  return saveDocumentMetadata(db, {
    path,
    title,
    summary: typeof parsed.data.summary === 'string' ? parsed.data.summary : '',
    tags,
    createdAt: dateMs(parsed.data.created ?? parsed.data.date, mtimeMs),
    updatedAt: Math.max(legacyUpdatedAt, mtimeMs),
  })
}

export function moveDocumentMetadata(db: DatabaseT, fromPath: string, toPath: string): boolean {
  return db.transaction(() => {
    const source = db.prepare('SELECT id FROM documents WHERE path = ?').get(fromPath) as { id: string } | undefined
    if (!source) return false
    const result = db.prepare(
      'UPDATE documents SET path = ?, updated_at = ? WHERE path = ?',
    ).run(toPath, Date.now(), fromPath)
    db.prepare(`
      UPDATE metadata_migrations SET path = ?, document_id = ?, updated_at = ?
      WHERE document_id = ? OR (document_id IS NULL AND path = ?)
    `).run(toPath, source.id, Date.now(), source.id, fromPath)
    return result.changes > 0
  })()
}

function quarantineMigrationAtPath(db: DatabaseT, path: string, documentId?: string): void {
  const row = db.prepare('SELECT path FROM metadata_migrations WHERE path = ?').get(path)
  if (!row) return
  const tombstone = `@deleted/${documentId ?? randomUUID()}`
  db.prepare(`
    UPDATE metadata_migrations
    SET path = ?, original_path = CASE WHEN original_path = '' THEN path ELSE original_path END,
        document_id = NULL, status = 'orphaned', updated_at = ?
    WHERE path = ?
  `).run(tombstone, Date.now(), path)
}

/** Atomically isolate a stale destination generation and move the source identity. */
export function moveDocumentMetadataReplacingDestination(
  db: DatabaseT,
  fromPath: string,
  toPath: string,
): boolean {
  return db.transaction(() => {
    const source = db.prepare('SELECT id FROM documents WHERE path = ?').get(fromPath) as { id: string } | undefined
    if (!source) return false
    const destination = db.prepare('SELECT id FROM documents WHERE path = ?').get(toPath) as { id: string } | undefined
    quarantineMigrationAtPath(db, toPath, destination?.id)
    if (destination) db.prepare('DELETE FROM documents WHERE id = ?').run(destination.id)
    db.prepare('UPDATE documents SET path = ?, updated_at = ? WHERE id = ?').run(toPath, Date.now(), source.id)
    db.prepare('UPDATE metadata_migrations SET path = ?, updated_at = ? WHERE document_id = ?')
      .run(toPath, Date.now(), source.id)
    return true
  })()
}

export function deleteDocumentMetadata(db: DatabaseT, path: string): boolean {
  return db.transaction(() => {
    const document = db.prepare('SELECT id FROM documents WHERE path = ?').get(path) as { id: string } | undefined
    quarantineMigrationAtPath(db, path, document?.id)
    const result = document
      ? db.prepare('DELETE FROM documents WHERE id = ?').run(document.id)
      : { changes: 0 }
    return result.changes > 0
  })()
}

/**
 * Reject operations that would (a) collapse source and destination to the same
 * prefix, (b) move a folder into one of its own descendants — which would
 * rewrite the prefix row onto a path that another descendant is also being
 * rewritten from — or (c) overwrite an unrelated existing path.
 *
 * Without this guard the UPDATE loop would either fail mid-transaction (the
 * SQLite UNIQUE(path) violation rolls back the whole rename and leaves the
 * filesystem in a state where the folder has already moved but the metadata
 * hasn't) or silently overwrite an unrelated row.
 */
function assertPrefixMoveSafe(fromPrefix: string, toPrefix: string, planned: Array<{ id: string; nextPath: string }>, db: DatabaseT): void {
  if (toPrefix === fromPrefix) {
    throw new Error(`metadata prefix move source and destination are identical: ${fromPrefix}`)
  }
  if (toPrefix.startsWith(`${fromPrefix}/`)) {
    throw new Error(`cannot move metadata prefix into its own subtree: ${fromPrefix} -> ${toPrefix}`)
  }
  const sourceIds = new Set(planned.map((row) => row.id))
  const seenNext = new Set<string>()
  const lookup = db.prepare('SELECT id FROM documents WHERE path = ?')
  for (const { nextPath } of planned) {
    if (seenNext.has(nextPath)) {
      throw new Error(`metadata prefix move duplicate destination: ${nextPath}`)
    }
    const existing = lookup.get(nextPath) as { id: string } | undefined
    if (existing && !sourceIds.has(existing.id)) {
      throw new Error(`metadata prefix move collides with existing path: ${nextPath}`)
    }
    seenNext.add(nextPath)
  }
}

export function moveDocumentMetadataPrefix(db: DatabaseT, fromPrefix: string, toPrefix: string): number {
  return db.transaction(() => {
    const rows = db.prepare(
      'SELECT id, path FROM documents WHERE path = ? OR path LIKE ? ORDER BY length(path)',
    ).all(fromPrefix, `${fromPrefix}/%`) as Array<{ id: string; path: string }>
    const planned = rows.map((row) => ({
      id: row.id,
      fromPath: row.path,
      nextPath: toPrefix + row.path.slice(fromPrefix.length),
    }))
    assertPrefixMoveSafe(fromPrefix, toPrefix, planned, db)
    const update = db.prepare('UPDATE documents SET path = ?, updated_at = ? WHERE id = ?')
    const updateMigration = db.prepare(`
      UPDATE metadata_migrations SET path = ?, document_id = ?, updated_at = ?
      WHERE document_id = ? OR (document_id IS NULL AND path = ?)
    `)
    const now = Date.now()
    for (const { id, fromPath, nextPath } of planned) {
      update.run(nextPath, now, id)
      updateMigration.run(nextPath, id, now, id, fromPath)
    }
    return rows.length
  })()
}

export function deleteDocumentMetadataPrefix(db: DatabaseT, prefix: string): number {
  return db.transaction(() => {
    const documents = db.prepare(
      'SELECT id, path FROM documents WHERE path = ? OR path LIKE ?',
    ).all(prefix, `${prefix}/%`) as Array<{ id: string; path: string }>
    for (const document of documents) quarantineMigrationAtPath(db, document.path, document.id)
    const result = db.prepare('DELETE FROM documents WHERE path = ? OR path LIKE ?')
      .run(prefix, `${prefix}/%`)
    return result.changes
  })()
}
