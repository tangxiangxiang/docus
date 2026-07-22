// Crash-test child: runs the REAL atomic replace protocol (no fs
// mocks) and kills itself hard at the exact protocol point named by
// DOCUS_CRASH_POINT. The parent process (crashRecovery.test.ts) then
// asserts the on-disk crash state and runs startup recovery.
//
// Env: DOCUS_CRASH_TARGET (abs path), DOCUS_CRASH_EXPECTED,
//      DOCUS_CRASH_REPLACEMENT, DOCUS_CRASH_POINT ('takeover'|'journal')
import {
  atomicReplaceTextIfUnchanged,
  __setAtomicWriteCrashHooksForTesting,
} from '../../atomicTextWrite.js'

const target = process.env.DOCUS_CRASH_TARGET
const expected = process.env.DOCUS_CRASH_EXPECTED
const replacement = process.env.DOCUS_CRASH_REPLACEMENT
const point = process.env.DOCUS_CRASH_POINT ?? 'takeover'
if (!target || expected === undefined || replacement === undefined) {
  console.error('missing DOCUS_CRASH_* env')
  process.exit(2)
}

const die = (): void => {
  // SIGKILL: no finally blocks, no exit handlers — a real kill -9.
  process.kill(process.pid, 'SIGKILL')
}
__setAtomicWriteCrashHooksForTesting({
  afterJournalWrite: point === 'journal' ? die : undefined,
  afterTakeover: point === 'takeover' ? die : undefined,
})

await atomicReplaceTextIfUnchanged(target, expected, replacement)
// Reaching this line means the crash hook never fired.
console.error('child completed without crashing')
process.exit(1)
