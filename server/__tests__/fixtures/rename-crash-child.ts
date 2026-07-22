// Crash-test child: runs the REAL create-only file move (no fs mocks)
// and kills itself hard right AFTER the destination link lands but
// BEFORE the staging name is removed — the window that leaves two
// names on one inode. The parent (crashRecovery.test.ts) asserts the
// crash state, runs startup recovery, and verifies the metadata move
// completes without losing the documentId.
//
// Env: DOCUS_CRASH_FROM (abs path), DOCUS_CRASH_TO (abs path)
import {
  createOnlyMoveFile,
  __setCreateOnlyMoveHooksForTesting,
} from '../../documentFileLifecycle.js'

const from = process.env.DOCUS_CRASH_FROM
const to = process.env.DOCUS_CRASH_TO
if (!from || !to) {
  console.error('missing DOCUS_CRASH_FROM or DOCUS_CRASH_TO env')
  process.exit(2)
}

__setCreateOnlyMoveHooksForTesting({
  afterRenameLinked: () => {
    // SIGKILL: no finally blocks, no exit handlers — a real kill -9.
    process.kill(process.pid, 'SIGKILL')
  },
})

await createOnlyMoveFile(from, to)
// Reaching this line means the crash hook never fired.
console.error('child completed without crashing')
process.exit(1)
