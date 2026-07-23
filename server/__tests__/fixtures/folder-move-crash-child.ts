// Crash-test child: runs the REAL replayable folder move — the Windows
// protocol — end to end: a durable folder-rename journal with every
// entry's content hash (exactly what server/routes/folders.ts writes),
// then createOnlyMoveDirectory('replayable-move'). It pauses at the
// named seam announcing READY:<point>; the parent force-kills it there,
// asserts the exact split state on disk, and replays from the journal.
//
// Env: DOCUS_FOLDER_VAULT, DOCUS_FOLDER_SRC, DOCUS_FOLDER_DEST (vault
//      rels), DOCUS_FOLDER_DB (sqlite path), DOCUS_FOLDER_CRASH_POINT
//      ('gate' | 'entry-a'). The vault must hold <src>/a.md and
//      <src>/nested/b.md.
import Database from 'better-sqlite3'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { applyMigrations } from '../../db.js'
import { saveDocumentMetadata } from '../../documentMetadata.js'
import { sha256Hex, writeDurableJournal } from '../../atomicTextWrite.js'
import {
  __setCreateOnlyMoveHooksForTesting,
  createOnlyMoveDirectory,
} from '../../documentFileLifecycle.js'
import { readyAndWait } from './crash-child-ready.js'

const vault = process.env.DOCUS_FOLDER_VAULT
const srcRel = process.env.DOCUS_FOLDER_SRC
const destRel = process.env.DOCUS_FOLDER_DEST
const dbPath = process.env.DOCUS_FOLDER_DB
const point = process.env.DOCUS_FOLDER_CRASH_POINT ?? 'gate'
if (!vault || !srcRel || !destRel || !dbPath) {
  console.error('missing DOCUS_FOLDER_* env')
  process.exit(2)
}

const srcAbs = path.join(vault, srcRel)
const destAbs = path.join(vault, destRel)
const aRaw = await fs.readFile(path.join(srcAbs, 'a.md'), 'utf8')
const bRaw = await fs.readFile(path.join(srcAbs, 'nested', 'b.md'), 'utf8')

const database = new Database(dbPath)
applyMigrations(database)
saveDocumentMetadata(database, { id: 'folder-a-id', path: `${srcRel}/a`, title: 'A', updatedAt: 1 })
saveDocumentMetadata(database, { id: 'folder-b-id', path: `${srcRel}/nested/b`, title: 'B', updatedAt: 1 })

const entries = [
  { rel: 'a', id: 'folder-a-id', sourceHash: sha256Hex(aRaw) },
  { rel: 'nested/b', id: 'folder-b-id', sourceHash: sha256Hex(bRaw) },
]
const sourceStat = await fs.stat(srcAbs)
await writeDurableJournal(path.join(vault, `.${path.basename(srcRel)}.docus-journal-cccccccc`), {
  version: 1,
  op: 'folder-rename',
  srcRel,
  destRel,
  strategy: 'replayable',
  sourceDev: sourceStat.dev,
  sourceIno: sourceStat.ino,
  entries,
})

__setCreateOnlyMoveHooksForTesting({
  afterReplayableGate: point === 'gate' ? () => readyAndWait('gate') : undefined,
  afterReplayableMovedEntry: point === 'entry-a'
    ? (entryRel) => { if (entryRel === 'a.md') return readyAndWait('entry-a') }
    : undefined,
})

const moved = await createOnlyMoveDirectory(srcAbs, destAbs, 'replayable-move')
// Reaching this line means the crash hook never fired.
console.error(`child completed without crashing (moved=${JSON.stringify(moved)})`)
process.exit(1)
