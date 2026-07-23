import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import {
  removeDurableJournal,
  removeDurableRecoveryPayload,
  rewriteDurableJournal,
  sha256Hex,
  writeDurableJournal,
  writeDurableRecoveryPayload,
} from './atomicTextWrite.js'

export type RenameReferencePlan = {
  path: string
  beforeRaw: string
  afterRaw: string
}

type ReferenceEntry = {
  path: string
  beforeHash: string
  afterHash: string
  beforePayload: string
  afterPayload: string
}

type JournalEntry = {
  version: 1
  op: 'document-rename-references' | 'folder-rename-references'
  phase: 'preparing' | 'roll-forward' | 'roll-back' | 'cleanup'
  srcRel: string
  destRel: string
  documentId?: string
  sourceHash?: string
  sourceDev?: number
  sourceIno?: number
  /** Folder identities carry each document's source hash so recovery
   * can verify the actual generation — a directory's dev/ino is weak
   * evidence (recycled after external delete/recreate, unreliable on
   * some Windows file systems, brand-new after a replayable move). */
  identities?: Array<{ path: string; id: string; sourceHash?: string }>
  references: ReferenceEntry[]
}

export type PreparedRenameReferenceJournal = {
  journalPath: string
  setDirection(direction: 'roll-forward' | 'roll-back'): Promise<void>
  cleanup(): Promise<void>
}

/** Exact protocol seams for subprocess crash verification. Null in
 * production and unreachable from requests. */
export type RenameReferenceJournalCrashHooks = {
  afterPreparingJournal?: () => void | Promise<void>
  afterPayloadWrite?: (index: number, kind: 'before' | 'after') => void | Promise<void>
  afterPhaseRewrite?: (phase: 'roll-forward' | 'roll-back' | 'cleanup') => void | Promise<void>
  afterPayloadRemove?: (index: number) => void | Promise<void>
}
let __crashHooks: RenameReferenceJournalCrashHooks | null = null
export function __setRenameReferenceJournalCrashHooksForTesting(hooks: RenameReferenceJournalCrashHooks | null): void {
  __crashHooks = hooks
}

type PrepareRenameReferenceJournalInput = {
  sourceAbs: string
  srcRel: string
  destRel: string
  references: readonly RenameReferencePlan[]
} & ({
  op: 'document-rename-references'
  documentId: string
} | {
  op: 'folder-rename-references'
  documentId?: never
  identities: readonly { path: string; id: string; sourceHash: string }[]
})

export async function prepareRenameReferenceJournal(input: PrepareRenameReferenceJournalInput): Promise<PreparedRenameReferenceJournal | null> {
  if (!input.references.length) return null
  if (input.op === 'document-rename-references' && !input.documentId) {
    throw new Error('document rename reference journal requires a documentId')
  }
  const dir = path.dirname(input.sourceAbs)
  const base = path.basename(input.sourceAbs)
  const transactionId = randomUUID()
  const journalPath = path.join(dir, `.${base}.docus-journal-${transactionId}`)
  const references = input.references.map((reference, index) => ({
    path: reference.path,
    beforeHash: sha256Hex(reference.beforeRaw),
    afterHash: sha256Hex(reference.afterRaw),
    beforePayload: `.${base}.docus-ref-before-${transactionId}-${index}`,
    afterPayload: `.${base}.docus-ref-after-${transactionId}-${index}`,
  }))
  const payloadPaths = references.flatMap((reference) => [
    path.join(dir, reference.beforePayload),
    path.join(dir, reference.afterPayload),
  ])
  const sourceStat = input.op === 'folder-rename-references' ? await fs.stat(input.sourceAbs) : null
  const baseEntry: Omit<JournalEntry, 'phase'> = {
    version: 1,
    op: input.op,
    srcRel: input.srcRel,
    destRel: input.destRel,
    documentId: input.documentId,
    sourceHash: input.op === 'document-rename-references'
      ? sha256Hex(await fs.readFile(input.sourceAbs, 'utf8'))
      : undefined,
    sourceDev: sourceStat?.dev,
    sourceIno: sourceStat?.ino,
    identities: input.op === 'folder-rename-references' ? [...input.identities] : undefined,
    references,
  }
  await writeDurableJournal(journalPath, { ...baseEntry, phase: 'preparing' })
  if (__crashHooks?.afterPreparingJournal) await __crashHooks.afterPreparingJournal()
  const removePayloads = async (): Promise<void> => {
    for (let index = 0; index < payloadPaths.length; index += 1) {
      await removeDurableRecoveryPayload(payloadPaths[index])
      if (__crashHooks?.afterPayloadRemove) await __crashHooks.afterPayloadRemove(index)
    }
  }
  try {
    for (let index = 0; index < references.length; index += 1) {
      await writeDurableRecoveryPayload(path.join(dir, references[index].beforePayload), input.references[index].beforeRaw)
      if (__crashHooks?.afterPayloadWrite) await __crashHooks.afterPayloadWrite(index, 'before')
      await writeDurableRecoveryPayload(path.join(dir, references[index].afterPayload), input.references[index].afterRaw)
      if (__crashHooks?.afterPayloadWrite) await __crashHooks.afterPayloadWrite(index, 'after')
    }
    let phase: JournalEntry['phase'] = 'roll-forward'
    await rewriteDurableJournal(journalPath, { ...baseEntry, phase })
    if (__crashHooks?.afterPhaseRewrite) await __crashHooks.afterPhaseRewrite(phase)
    return {
      journalPath,
      async setDirection(direction) {
        phase = direction
        await rewriteDurableJournal(journalPath, { ...baseEntry, phase })
        if (__crashHooks?.afterPhaseRewrite) await __crashHooks.afterPhaseRewrite(phase)
      },
      async cleanup() {
        phase = 'cleanup'
        await rewriteDurableJournal(journalPath, { ...baseEntry, phase })
        if (__crashHooks?.afterPhaseRewrite) await __crashHooks.afterPhaseRewrite(phase)
        await removePayloads()
        await removeDurableJournal(journalPath)
      },
    }
  } catch (error) {
    // The preparing journal remains authoritative until every declared
    // payload has been removed. Startup recovery can repeat this cleanup.
    try {
      await removePayloads()
      await removeDurableJournal(journalPath)
    } catch {
      // Retain the preparing journal whenever cleanup is incomplete.
      // Startup recovery can repeat removal without orphaning payloads.
    }
    throw error
  }
}
