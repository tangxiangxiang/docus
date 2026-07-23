import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  __setRenameReferenceJournalCrashHooksForTesting,
  prepareRenameReferenceJournal,
} from '../../renameReferenceJournal.js'

const vault = process.env.DOCUS_REFERENCE_VAULT
const point = process.env.DOCUS_REFERENCE_CRASH_POINT
if (!vault || !point) process.exit(2)

const kill = (): never => process.kill(process.pid, 'SIGKILL') as never
__setRenameReferenceJournalCrashHooksForTesting({
  afterPreparingJournal: point === 'preparing' ? kill : undefined,
  afterPayloadWrite: point.startsWith('payload-')
    ? (index, kind) => { if (`payload-${index}-${kind}` === point) kill() }
    : undefined,
  afterPhaseRewrite: point === 'roll-forward'
    ? (phase) => { if (phase === 'roll-forward') kill() }
    : point === 'roll-back'
      ? (phase) => { if (phase === 'roll-back') kill() }
      : point === 'cleanup'
        ? (phase) => { if (phase === 'cleanup') kill() }
        : undefined,
  afterPayloadRemove: point === 'cleanup-payload-0'
    ? (index) => { if (index === 0) kill() }
    : undefined,
})

const sourceAbs = path.join(vault, 'old.md')
const prepared = await prepareRenameReferenceJournal({
  sourceAbs,
  op: 'document-rename-references',
  srcRel: 'old',
  destRel: 'new',
  documentId: 'rename-id',
  references: [
    { path: 'ref-a', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' },
    { path: 'ref-b', beforeRaw: '[[old]]\n', afterRaw: '[[new]]\n' },
  ],
})
if (!prepared) process.exit(3)
if (point === 'roll-back') await prepared.setDirection('roll-back')
if (point === 'cleanup' || point === 'cleanup-payload-0') await prepared.cleanup()
await fs.writeFile(path.join(vault, 'unexpected-completion'), point)
process.exit(1)
