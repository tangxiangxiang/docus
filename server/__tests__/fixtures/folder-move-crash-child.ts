// Crash-test child: runs the REAL folder rename HTTP route against a
// temp vault — the route writes the real durable journal (schema v2:
// every PHYSICAL entry with its content hash, the runtime strategy
// value) and performs the real move. The child pauses at the named
// seam announcing READY:<point>; the parent force-kills it there,
// asserts the exact split state on disk INCLUDING the real journal
// JSON, and replays from the journal. The journal is never
// hand-copied here — it is the route's own artifact.
//
// Env: DOCUS_FOLDER_VAULT, DOCUS_FOLDER_DB (sqlite path),
//      DOCUS_FOLDER_CRASH_POINT ('gate' | 'entry:<relativeFilePath>' |
//      'parity', e.g. 'entry:a.md'). The vault must hold proj/a.md,
//      proj/image.bin and proj/nested/b.md.
import Database from 'better-sqlite3'

const vault = process.env.DOCUS_FOLDER_VAULT
const dbPath = process.env.DOCUS_FOLDER_DB
const point = process.env.DOCUS_FOLDER_CRASH_POINT ?? 'gate'
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
const { readyAndWait } = await import('./crash-child-ready.js')

setContentDir(vault)
const database = new Database(dbPath)
applyMigrations(database)
__setMetadataDbForTesting(database)

// Exercise the Windows journaled protocol through the real route on
// every platform: the override makes the route PERSIST strategy
// 'replayable-move' and run the per-file move under that journal.
__setDirectoryMoveStrategyOverrideForTesting('replayable-move')
__setCreateOnlyMoveHooksForTesting({
  afterReplayableGate: point === 'gate' ? () => readyAndWait('gate') : undefined,
  afterReplayableMovedEntry: point.startsWith('entry:')
    ? (entryRel) => { if (entryRel === point.slice('entry:'.length)) return readyAndWait(`entry:${entryRel}`) }
    : undefined,
  // Round-10 F5: parity passes, metadata has not yet committed — the
  // crash child fires here to leave recovery a clear "finish metadata"
  // job. The hook name was renamed in F5; the legacy alias is kept
  // here for the fixtures and any external tests.
  afterReplayableFinalParity: point === 'parity' ? () => readyAndWait('parity') : undefined,
  afterParityBeforeMetadata: point === 'parity' ? () => readyAndWait('parity') : undefined,
} as any)

const response = await app.fetch(new Request('http://localhost/api/folders/proj', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ newPath: 'ren' }),
}))
// Reaching this line means the crash hook never fired.
console.error(`child completed without crashing (status=${response.status})`)
process.exit(1)
