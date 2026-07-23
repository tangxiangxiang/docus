import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import {
  removeDurableJournal,
  removeDurableRecoveryPayload,
  sha256Hex,
  writeDurableJournal,
  writeDurableRecoveryPayload,
} from './atomicTextWrite.js'

export type RenameReferencePlan = {
  path: string
  beforeRaw: string
  afterRaw: string
}

export type PreparedRenameReferenceJournal = {
  journalPath: string
  cleanup(): Promise<void>
}

export async function prepareRenameReferenceJournal(input: {
  sourceAbs: string
  op: 'document-rename-references' | 'folder-rename-references'
  srcRel: string
  destRel: string
  documentId?: string
  references: readonly RenameReferencePlan[]
}): Promise<PreparedRenameReferenceJournal | null> {
  if (!input.references.length) return null
  const dir = path.dirname(input.sourceAbs)
  const base = path.basename(input.sourceAbs)
  const payloadPaths: string[] = []
  const references: Array<Record<string, string>> = []
  try {
    for (const reference of input.references) {
      const beforePayload = `.${base}.docus-ref-before-${randomUUID()}`
      const afterPayload = `.${base}.docus-ref-after-${randomUUID()}`
      const beforeAbs = path.join(dir, beforePayload)
      const afterAbs = path.join(dir, afterPayload)
      await writeDurableRecoveryPayload(beforeAbs, reference.beforeRaw)
      payloadPaths.push(beforeAbs)
      await writeDurableRecoveryPayload(afterAbs, reference.afterRaw)
      payloadPaths.push(afterAbs)
      references.push({
        path: reference.path,
        beforeHash: sha256Hex(reference.beforeRaw),
        afterHash: sha256Hex(reference.afterRaw),
        beforePayload,
        afterPayload,
      })
    }
    const journalPath = path.join(dir, `.${base}.docus-journal-${randomUUID()}`)
    const sourceStat = input.op === 'folder-rename-references' ? await fs.stat(input.sourceAbs) : null
    await writeDurableJournal(journalPath, {
      version: 1,
      op: input.op,
      srcRel: input.srcRel,
      destRel: input.destRel,
      documentId: input.documentId,
      sourceDev: sourceStat?.dev,
      sourceIno: sourceStat?.ino,
      references,
    })
    return {
      journalPath,
      async cleanup() {
        for (const payloadPath of payloadPaths) await removeDurableRecoveryPayload(payloadPath).catch(() => {})
        await removeDurableJournal(journalPath).catch(() => {})
      },
    }
  } catch (error) {
    for (const payloadPath of payloadPaths) await removeDurableRecoveryPayload(payloadPath).catch(() => {})
    throw error
  }
}
