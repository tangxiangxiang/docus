// Crash-test child: drives the REAL folder rename HTTP route through
// its ROLLBACK path and kills it at a named reverse-move seam.
//
// The route is made to roll back the way production actually does:
// updateReferences plans a backlink rewrite, and the afterRenamePlanBuilt
// hook mutates the reference file like an external editor — the
// ownership-verified reference write then fails (AtomicTextWriteConflict)
// and the route enters its real rollback: durably flip the folder-move
// journal's direction, reverse the tree, restore the metadata snapshot.
//
// Env: DOCUS_FOLDER_VAULT, DOCUS_FOLDER_DB (sqlite path),
//      DOCUS_FOLDER_CRASH_POINT:
//        'rollback-entry:a.md'       — after the first reverse file landed
//        'rollback-entry:image.bin'  — mid reverse move
//        'rollback-after-tree'       — whole tree back, metadata pending
// The vault must hold proj/a.md, proj/image.bin, proj/nested/b.md and
// ref-a.md linking into the folder.
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const vault = process.env.DOCUS_FOLDER_VAULT
const dbPath = process.env.DOCUS_FOLDER_DB
const point = process.env.DOCUS_FOLDER_CRASH_POINT ?? ''
if (!vault || !dbPath) {
  console.error('missing DOCUS_FOLDER_* env')
  process.exit(2)
}

const { setContentDir } = await import('../../paths.js')
const { applyMigrations } = await import('../../db.js')
const { default: app, __setMetadataDbForTesting } = await import('../../index.js')
const {
  __setCreateOnlyMoveHooksForTesting,
  __setDirectoryMoveStrategyOverrideForTesting,
} = await import('../../documentFileLifecycle.js')
const { __setFolderRaceHooksForTesting } = await import('../../routes/folders.js')
const { readyAndWait } = await import('./crash-child-ready.js')

setContentDir(vault)
const database = new Database(dbPath)
applyMigrations(database)
__setMetadataDbForTesting(database)

__setDirectoryMoveStrategyOverrideForTesting('replayable-move')
// The forward move runs WITHOUT move hooks (they would fire on the
// forward entries too); the reverse-move kill is armed inside
// afterRenamePlanBuilt — which fires only after the forward move,
// metadata commit and journal removal, right before the reference
// write loop. The external save planted there is what fails the
// reference write and drives the route into its real rollback.
__setFolderRaceHooksForTesting({
  afterRenamePlanBuilt: async () => {
    __setCreateOnlyMoveHooksForTesting({
      afterReplayableMovedEntry: point.startsWith('rollback-entry:')
        ? (entryRel) => { if (entryRel === point.slice('rollback-entry:'.length)) return readyAndWait(point) }
        : undefined,
    })
    await fs.writeFile(path.join(vault, 'ref-a.md'), '# externally changed\n', 'utf8')
  },
  afterRollbackMove: point === 'rollback-after-tree' ? () => readyAndWait(point) : undefined,
})

const response = await app.fetch(new Request('http://localhost/api/folders/proj', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ newPath: 'ren', updateReferences: true }),
}))
console.error(`child completed without crashing (status=${response.status})`)
process.exit(1)
