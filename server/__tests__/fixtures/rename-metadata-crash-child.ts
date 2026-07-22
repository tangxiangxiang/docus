import Database from 'better-sqlite3'
import { applyMigrations } from '../../db.js'
import { saveDocumentMetadata } from '../../documentMetadata.js'
import {
  __setCreateOnlyMoveHooksForTesting,
  renameDocumentWithMetadata,
} from '../../documentFileLifecycle.js'

const fromAbs = process.env.DOCUS_RENAME_FROM
const toAbs = process.env.DOCUS_RENAME_TO
const dbPath = process.env.DOCUS_RENAME_DB
if (!fromAbs || !toAbs || !dbPath) process.exit(2)

const database = new Database(dbPath)
applyMigrations(database)
saveDocumentMetadata(database, { id: 'post-staging-crash-id', path: 'old', title: 'Old', updatedAt: 1 })
__setCreateOnlyMoveHooksForTesting({
  afterRenameTakenOver: process.env.DOCUS_RENAME_CRASH_POINT === 'takeover'
    ? () => process.kill(process.pid, 'SIGKILL')
    : undefined,
  afterFileMoveFinalized: process.env.DOCUS_RENAME_CRASH_POINT !== 'takeover'
    ? () => process.kill(process.pid, 'SIGKILL')
    : undefined,
})
await renameDocumentWithMetadata({
  db: database,
  fromPath: 'old',
  toPath: 'new',
  fromAbs,
  toAbs,
})
process.exit(1)
