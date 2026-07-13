import type { Database as DatabaseT } from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import { ensureDocumentMetadata } from '../documentMetadata.js'
import { getDb } from '../db.js'

let metadataDbOverride: DatabaseT | null = null

/** Test-only injection so temp-vault integration tests never write the user's database. */
export function __setMetadataDbForTesting(db: DatabaseT | null): void {
  metadataDbOverride = db
}

export function metadataDb(): DatabaseT {
  return metadataDbOverride ?? getDb()
}

export function bad(c: any, msg: string, code = 400) { return c.json({ error: msg }, code) }

export async function exists(p: string) {
  try { await fs.stat(p); return true } catch { return false }
}

export function ensureMetadata(path: string, raw: string, mtimeMs: number, updatedAt = mtimeMs) {
  return ensureDocumentMetadata(metadataDb(), path, raw, mtimeMs, updatedAt)
}
