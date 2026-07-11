import { randomUUID } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import matter from 'gray-matter'

export interface DocumentMetadata {
  id: string
  path: string
  title: string
  summary: string
  tags: string[]
  aliases: string[]
  createdAt: number
  updatedAt: number
}

export interface SaveDocumentMetadata {
  id?: string
  path: string
  title: string
  summary?: string
  tags?: string[]
  aliases?: string[]
  createdAt?: number
  updatedAt?: number
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
  const aliases = db.prepare(
    'SELECT alias FROM document_aliases WHERE document_id = ? ORDER BY alias COLLATE NOCASE',
  ).all(row.id) as Array<{ alias: string }>
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    summary: row.summary,
    tags: tags.map((item) => item.name),
    aliases: aliases.map((item) => item.alias),
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

    db.prepare('DELETE FROM document_aliases WHERE document_id = ?').run(id)
    for (const alias of cleanValues(input.aliases ?? existing?.aliases)) {
      db.prepare('INSERT INTO document_aliases (document_id, alias) VALUES (?, ?)').run(id, alias)
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
  if (existing) return saveDocumentMetadata(db, { ...existing, updatedAt })

  const parsed = matter(raw)
  const fallbackTitle = path.split('/').pop()!
  const heading = /^#\s+(.+)$/m.exec(parsed.content)?.[1]?.trim()
  const title = typeof parsed.data.title === 'string' && parsed.data.title.trim()
    ? parsed.data.title.trim()
    : heading || fallbackTitle
  const tags = Array.isArray(parsed.data.tags)
    ? parsed.data.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
    : []
  const aliases = Array.isArray(parsed.data.aliases)
    ? parsed.data.aliases.filter((alias: unknown): alias is string => typeof alias === 'string')
    : []
  return saveDocumentMetadata(db, {
    path,
    title,
    summary: typeof parsed.data.summary === 'string' ? parsed.data.summary : '',
    tags,
    aliases,
    createdAt: dateMs(parsed.data.created ?? parsed.data.date, mtimeMs),
    updatedAt,
  })
}

export function moveDocumentMetadata(db: DatabaseT, fromPath: string, toPath: string): boolean {
  return db.transaction(() => {
    const result = db.prepare(
      'UPDATE documents SET path = ?, updated_at = ? WHERE path = ?',
    ).run(toPath, Date.now(), fromPath)
    db.prepare('UPDATE metadata_migrations SET path = ?, updated_at = ? WHERE path = ?')
      .run(toPath, Date.now(), fromPath)
    return result.changes > 0
  })()
}

export function deleteDocumentMetadata(db: DatabaseT, path: string): boolean {
  return db.transaction(() => {
    const result = db.prepare('DELETE FROM documents WHERE path = ?').run(path)
    db.prepare('DELETE FROM metadata_migrations WHERE path = ?').run(path)
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
  for (const { id, nextPath } of planned) {
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
    const updateMigration = db.prepare(
      'UPDATE metadata_migrations SET path = ?, updated_at = ? WHERE path = ?',
    )
    const now = Date.now()
    for (const { id, fromPath, nextPath } of planned) {
      update.run(nextPath, now, id)
      updateMigration.run(nextPath, now, fromPath)
    }
    return rows.length
  })()
}

export function deleteDocumentMetadataPrefix(db: DatabaseT, prefix: string): number {
  return db.transaction(() => {
    const result = db.prepare('DELETE FROM documents WHERE path = ? OR path LIKE ?')
      .run(prefix, `${prefix}/%`)
    db.prepare('DELETE FROM metadata_migrations WHERE path = ? OR path LIKE ?')
      .run(prefix, `${prefix}/%`)
    return result.changes
  })()
}
