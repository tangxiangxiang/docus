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
//        'reverse-gate'              — after reverse gate mkdir + phase rewrite
//        'reverse-entry:a.md'        — after first reverse file landed
//        'reverse-parity'            — after reverse exact parity passed
//        'reverse-before-metadata'    — immediately before reverse CAS
//        'reverse-metadata'          — after reverse metadata restore
//        'reverse-journal-remove'    — just before reverse journal removal
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
if (point === 'reverse-before-metadata') {
  __setCreateOnlyMoveHooksForTesting({
    beforeReverseMetadataRestore: () => readyAndWait(point),
  })
}
// The forward move runs WITHOUT move hooks (they would fire on the
// forward entries too); the reverse-move kill is armed inside
// afterRenamePlanBuilt — which fires only after the forward move,
// metadata commit and journal removal, right before the reference
// write loop. The external save planted there is what fails the
// reference write and drives the route into its real rollback.
const raceHooks: import('../../routes/folders.js').FolderRaceHooks = {}
if (point === 'rollback-after-tree') {
  raceHooks.afterRollbackMove = () => readyAndWait(point)
}
__setFolderRaceHooksForTesting(raceHooks)
__setFolderRaceHooksForTesting({
  ...raceHooks,
  afterRenamePlanBuilt: async () => {
    const hooks: Record<string, unknown> = {}
    // Support both old "rollback-" and new "reverse-" prefixes
    const effectivePoint = point.replace(/^rollback-/, 'reverse-')
    if (effectivePoint.startsWith('reverse-entry:')) {
      const targetEntry = effectivePoint.slice('reverse-entry:'.length)
      hooks.afterReplayableMovedEntry = (entryRel: string) => {
        if (entryRel === targetEntry) return readyAndWait(point)
      }
    }
    if (effectivePoint === 'reverse-gate') {
      hooks.afterReverseGateCreated = () => readyAndWait(point)
    }
    if (effectivePoint === 'reverse-parity') {
      hooks.afterReverseParity = () => readyAndWait(point)
    }
    if (effectivePoint === 'reverse-metadata') {
      hooks.afterReverseMetadata = () => readyAndWait(point)
    }
    if (effectivePoint === 'reverse-journal-remove') {
      hooks.beforeReverseJournalRemove = () => readyAndWait(point)
    }
    __setCreateOnlyMoveHooksForTesting(hooks as any)
    await fs.writeFile(path.join(vault, 'ref-a.md'), '# externally changed\n', 'utf8')
  },
})

const response = await app.fetch(new Request('http://localhost/api/folders/proj', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ newPath: 'ren', updateReferences: true }),
}))
console.error(
  `child completed without crashing (status=${response.status}, body=${await response.text()})`,
)
process.exit(1)
