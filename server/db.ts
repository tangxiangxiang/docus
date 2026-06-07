// Server-side SQLite — single connection to ./data/docus.db, opened
// lazily on first call to getDb(). Migrations live in
// server/migrations/*.sql and are applied in version order on the
// first getDb() call. The runner is also exported (applyMigrations)
// so tests can apply the same migrations to an in-memory DB without
// touching the on-disk file.
//
// Conventions:
//   - timestamps are INTEGER ms-since-epoch (Date.now())
//   - SQL uses snake_case; service modules map to camelCase for the client
//   - foreign_keys=ON so ON DELETE CASCADE actually fires
//   - journal_mode=WAL for better concurrent reads
import Database, { type Database as DatabaseT } from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'docus.db')
// import.meta.dirname resolves to the directory of THIS source file
// at runtime, which is server/ — so server/migrations/ is found
// regardless of where vite/tsx was launched from.
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, 'migrations')

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

/**
 * Apply all un-applied migrations to the given DB. The runner is a
 * no-op on the second call (idempotent): it reads the current
 * version from `schema_version` and only runs files whose N > current.
 *
 * The schema_version table is created on the very first call (before
 * any migration runs), so subsequent migrations can record their
 * version.
 */
export function applyMigrations(db: DatabaseT) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`)
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined
  const current = row?.version ?? 0

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()

  for (const file of files) {
    const version = parseInt(file.match(/^(\d+)/)![1], 10)
    if (version <= current) continue
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      // schema_version holds a single row of the current version. We
      // upsert: delete any existing row, then insert. A real UPSERT
      // works too but `DELETE + INSERT` is unambiguous and the table
      // is one row so the cost is trivial.
      db.prepare('DELETE FROM schema_version').run()
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version)
    })()
    console.log(`[migrate] applied ${file} (→ v${version})`)
  }
}

let _db: DatabaseT | null = null

/**
 * Lazily open the on-disk DB. First call ensures data/ exists, opens
 * ./data/docus.db, sets the two PRAGMAs, and runs the migration
 * runner. Subsequent calls return the same instance.
 */
export function getDb(): DatabaseT {
  if (_db) return _db
  ensureDataDir()
  _db = new Database(DB_PATH)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  applyMigrations(_db)
  return _db
}
