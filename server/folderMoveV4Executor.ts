import { promises as fs } from 'node:fs'

import {
  createDestinationGate,
  rewriteDurableJournal,
} from './atomicTextWrite.js'
import {
  moveFolderEntriesIntoExistingGate,
  RenameDestinationOccupiedError,
  UnsupportedDirectoryMoveError,
  verifyFolderMoveDestinationV4,
  type FolderMoveJournalStrategy,
} from './documentFileLifecycle.js'
import type { FolderMoveJournalV4 } from './folderMoveTransaction.js'

export class AtomicRenameLandedGenerationReadError extends Error {
  constructor(destinationAbs: string, options?: ErrorOptions) {
    super(`atomic rename landed but destination generation could not be read: ${destinationAbs}`, options)
    this.name = 'AtomicRenameLandedGenerationReadError'
  }
}

export class FolderMoveGenerationMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FolderMoveGenerationMismatchError'
  }
}

export class FolderMoveExactParityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FolderMoveExactParityError'
  }
}

export type ExecuteFolderMoveV4Input = {
  contentDir: string
  journalAbs: string
  journal: FolderMoveJournalV4 & { phase: 'prepared' }
  srcAbs: string
  destAbs: string
  strategy: FolderMoveJournalStrategy
  afterGateCreated?: (
    destinationAbs: string,
    generation: { dev: string; ino: string },
  ) => void | Promise<void>
  afterAtomicRenameBeforeParity?: (
    sourceAbs: string,
    destinationAbs: string,
  ) => void | Promise<void>
  afterFilesLanded?: (destinationAbs: string) => void | Promise<void>
}

export type ExecuteFolderMoveV4Result = {
  journal: FolderMoveJournalV4 & { phase: 'files-landed' }
}

/** Run the one physical state machine used by routes and recovery
 * companions. The prepared journal already exists. Every transition is
 * durable; no error path removes the journal. */
export async function executeFolderMoveV4Physical(
  input: ExecuteFolderMoveV4Input,
): Promise<ExecuteFolderMoveV4Result> {
  const {
    contentDir,
    journalAbs,
    srcAbs,
    destAbs,
    strategy,
  } = input
  let journal: FolderMoveJournalV4 = input.journal

  const gate = await createDestinationGate(destAbs)
  if (!gate) {
    throw new RenameDestinationOccupiedError(destAbs)
  }
  journal = {
    ...journal,
    phase: 'gate-created',
    destDev: gate.dev,
    destIno: gate.ino,
  }
  await rewriteDurableJournal(journalAbs, journal)
  await input.afterGateCreated?.(destAbs, gate)

  if (strategy === 'atomic-rename') {
    try {
      await fs.rename(srcAbs, destAbs)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOTEMPTY' || code === 'EEXIST') {
        throw new RenameDestinationOccupiedError(destAbs)
      }
      if (code === 'EPERM' || code === 'EOPNOTSUPP' || code === 'ENOTSUP') {
        throw new UnsupportedDirectoryMoveError(
          `atomic directory rename failed; the platform needs the replayable strategy`,
          { cause: error },
        )
      }
      throw error
    }
    await input.afterAtomicRenameBeforeParity?.(srcAbs, destAbs)

    let finalStat: Awaited<ReturnType<typeof fs.stat>>
    try {
      finalStat = await fs.stat(destAbs, { bigint: true })
    } catch (error) {
      throw new AtomicRenameLandedGenerationReadError(destAbs, { cause: error })
    }
    const finalGeneration = {
      dev: finalStat.dev.toString(),
      ino: finalStat.ino.toString(),
    }
    if (finalGeneration.dev !== String(journal.sourceDev)
      || finalGeneration.ino !== String(journal.sourceIno)) {
      throw new FolderMoveGenerationMismatchError(
        'atomic destination generation does not equal original source generation',
      )
    }
    if (await verifyFolderMoveDestinationV4(destAbs, {
      destDev: finalGeneration.dev,
      destIno: finalGeneration.ino,
      entries: journal.entries,
      directories: journal.directories,
    })) {
      throw new FolderMoveExactParityError('atomic destination exact parity failed')
    }
    journal = {
      ...journal,
      phase: 'files-landed',
      destDev: finalGeneration.dev,
      destIno: finalGeneration.ino,
    }
  } else {
    await moveFolderEntriesIntoExistingGate(srcAbs, destAbs, {
      vaultRoot: contentDir,
      entries: journal.entries,
      directories: journal.directories,
    })
    if (await verifyFolderMoveDestinationV4(destAbs, journal)) {
      throw new FolderMoveExactParityError('replayable destination exact parity failed')
    }
    journal = {
      ...journal,
      phase: 'files-landed',
    }
  }

  await rewriteDurableJournal(journalAbs, journal)
  await input.afterFilesLanded?.(destAbs)
  return {
    journal: journal as FolderMoveJournalV4 & { phase: 'files-landed' },
  }
}
