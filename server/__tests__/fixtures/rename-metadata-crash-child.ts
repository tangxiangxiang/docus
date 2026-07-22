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
  afterFileMoveFinalized: () => process.kill(process.pid, 'SIGKILL'),
})
await renameDocumentWithMetadata({
  db: database,
  fromPath: 'old',
  toPath: 'new',
  fromAbs,
  toAbs,
})
process.exit(1)
