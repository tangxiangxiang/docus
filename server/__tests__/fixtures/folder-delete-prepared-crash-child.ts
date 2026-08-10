import Database from 'better-sqlite3'

const vault = process.env.DOCUS_FOLDER_VAULT
const dbPath = process.env.DOCUS_FOLDER_DB
if (!vault || !dbPath) {
  console.error('missing DOCUS_FOLDER_VAULT or DOCUS_FOLDER_DB')
  process.exit(2)
}

const { setContentDir } = await import('../../paths.js')
const { applyMigrations } = await import('../../db.js')
const { default: app, __setMetadataDbForTesting } = await import('../../index.js')
const { createAuthenticatedTestContext, withAuthCookie } = await import('../helpers/auth.js')
const { __setFolderRaceHooksForTesting } = await import('../../routes/folders.js')

setContentDir(vault)
const database = new Database(dbPath)
applyMigrations(database)
__setMetadataDbForTesting(database)
const auth = createAuthenticatedTestContext({ db: database })
__setFolderRaceHooksForTesting({
  failDeleteRemoval: true,
  afterDeleteRollbackPrepared: () => new Promise<never>(() => {
    process.stdout.write('READY:DELETE_ROLLBACK_PREPARED\n', () => process.exit(93))
  }),
} as Parameters<typeof __setFolderRaceHooksForTesting>[0])

const response = await app.fetch(withAuthCookie(auth, new Request('http://localhost/api/folders/gone?recursive=true', {
  method: 'DELETE',
})))
console.error(`child completed without crashing (status=${response.status})`)
process.exit(1)
