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
  references: ReferenceEntry[]
}

export type PreparedRenameReferenceJournal = {
  journalPath: string
  setDirection(direction: 'roll-forward' | 'roll-back'): Promise<void>
  cleanup(): Promise<void>
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
})

export async function prepareRenameReferenceJournal(input: PrepareRenameReferenceJournalInput): Promise<PreparedRenameReferenceJournal | null> {
  if (!input.references.length) return null
  if (input.op === 'document-rename-references' && !input.documentId) {
    throw new Error('document rename reference journal requires a documentId')
  }
  const dir = path.dirname(input.sourceAbs)
  const base = path.basename(input.sourceAbs)
  const journalPath = path.join(dir, `.${base}.docus-journal-${randomUUID()}`)
  const references = input.references.map((reference) => ({
    path: reference.path,
    beforeHash: sha256Hex(reference.beforeRaw),
    afterHash: sha256Hex(reference.afterRaw),
    beforePayload: `.${base}.docus-ref-before-${randomUUID()}`,
    afterPayload: `.${base}.docus-ref-after-${randomUUID()}`,
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
    references,
  }
  await writeDurableJournal(journalPath, { ...baseEntry, phase: 'preparing' })
  try {
    for (let index = 0; index < references.length; index += 1) {
      await writeDurableRecoveryPayload(path.join(dir, references[index].beforePayload), input.references[index].beforeRaw)
      await writeDurableRecoveryPayload(path.join(dir, references[index].afterPayload), input.references[index].afterRaw)
    }
    let phase: JournalEntry['phase'] = 'roll-forward'
    await rewriteDurableJournal(journalPath, { ...baseEntry, phase })
    return {
      journalPath,
      async setDirection(direction) {
        phase = direction
        await rewriteDurableJournal(journalPath, { ...baseEntry, phase })
      },
      async cleanup() {
        phase = 'cleanup'
        await rewriteDurableJournal(journalPath, { ...baseEntry, phase })
        for (const payloadPath of payloadPaths) await removeDurableRecoveryPayload(payloadPath).catch(() => {})
        await removeDurableJournal(journalPath)
      },
    }
  } catch (error) {
    // The preparing journal remains authoritative until every declared
    // payload has been removed. Startup recovery can repeat this cleanup.
    for (const payloadPath of payloadPaths) await removeDurableRecoveryPayload(payloadPath).catch(() => {})
    await removeDurableJournal(journalPath).catch(() => {})
    throw error
  }
}
