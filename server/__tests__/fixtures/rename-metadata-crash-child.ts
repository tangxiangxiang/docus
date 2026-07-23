// Crash-test child: runs the REAL renameDocumentWithMetadata (durable
// journal + create-only move + metadata commit) and pauses at one of
// its seams, announcing READY:<point>; the parent force-kills it there
// and replays the journal through startup recovery.
//
// Env: DOCUS_RENAME_FROM, DOCUS_RENAME_TO (abs paths), DOCUS_RENAME_DB
//      (sqlite path), DOCUS_RENAME_CRASH_POINT ('takeover'|'finalized')
import Database from 'better-sqlite3'
import { applyMigrations } from '../../db.js'
import { saveDocumentMetadata } from '../../documentMetadata.js'
import {
  __setCreateOnlyMoveHooksForTesting,
  renameDocumentWithMetadata,
} from '../../documentFileLifecycle.js'
import { readyAndWait } from './crash-child-ready.js'

const fromAbs = process.env.DOCUS_RENAME_FROM
const toAbs = process.env.DOCUS_RENAME_TO
const dbPath = process.env.DOCUS_RENAME_DB
const point = process.env.DOCUS_RENAME_CRASH_POINT ?? 'finalized'
if (!fromAbs || !toAbs || !dbPath) {
  console.error('missing DOCUS_RENAME_* env')
  process.exit(2)
}

const database = new Database(dbPath)
applyMigrations(database)
saveDocumentMetadata(database, { id: 'post-staging-crash-id', path: 'old', title: 'Old', updatedAt: 1 })
__setCreateOnlyMoveHooksForTesting({
  afterRenameTakenOver: point === 'takeover' ? () => readyAndWait('takeover') : undefined,
  afterFileMoveFinalized: point === 'finalized' ? () => readyAndWait('finalized') : undefined,
})
await renameDocumentWithMetadata({
  db: database,
  fromPath: 'old',
  toPath: 'new',
  fromAbs,
  toAbs,
})
// Reaching this line means the crash hook never fired.
console.error('child completed without crashing')
process.exit(1)
