// Crash-test child: runs the REAL atomic replace protocol (no fs
// mocks) and pauses at the exact protocol point named by
// DOCUS_CRASH_POINT, announcing READY:<point> on stdout; the parent
// (crashRecovery.test.ts) force-kills it there and then asserts the
// on-disk crash state before running startup recovery.
//
// Env: DOCUS_CRASH_TARGET (abs path), DOCUS_CRASH_EXPECTED,
//      DOCUS_CRASH_REPLACEMENT, DOCUS_CRASH_POINT ('takeover'|'journal')
import {
  atomicReplaceTextIfUnchanged,
  __setAtomicWriteCrashHooksForTesting,
} from '../../atomicTextWrite.js'
import { readyAndWait } from './crash-child-ready.js'

const target = process.env.DOCUS_CRASH_TARGET
const expected = process.env.DOCUS_CRASH_EXPECTED
const replacement = process.env.DOCUS_CRASH_REPLACEMENT
const point = process.env.DOCUS_CRASH_POINT ?? 'takeover'
if (!target || expected === undefined || replacement === undefined) {
  console.error('missing DOCUS_CRASH_* env')
  process.exit(2)
}

__setAtomicWriteCrashHooksForTesting({
  afterJournalWrite: point === 'journal' ? () => readyAndWait('journal') : undefined,
  afterTakeover: point === 'takeover' ? () => readyAndWait('takeover') : undefined,
})

await atomicReplaceTextIfUnchanged(target, expected, replacement)
// Reaching this line means the crash hook never fired.
console.error('child completed without crashing')
process.exit(1)
