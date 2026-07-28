import { promises as fs } from 'node:fs'

import type { FolderMoveJournalV4 } from './folderMoveTransaction.js'

export function parseDurableFolderMoveJournalV4(raw: string): FolderMoveJournalV4 | null {
  try {
    const entry = JSON.parse(raw) as Partial<FolderMoveJournalV4> & {
      phase?: unknown
      entries?: unknown
      directories?: unknown
      metadataDisposition?: unknown
    }
    if (entry.version !== 4) return null
    if (entry.op !== 'folder-rename' && entry.op !== 'folder-move') return null
    if (typeof entry.srcRel !== 'string' || typeof entry.destRel !== 'string') return null
    if (typeof entry.sourceDev !== 'number' || typeof entry.sourceIno !== 'number') return null
    if (!Number.isFinite(entry.sourceDev) || entry.sourceDev < 0) return null
    if (!Number.isFinite(entry.sourceIno) || entry.sourceIno < 0) return null
    if (entry.phase !== 'prepared' && entry.phase !== 'gate-created'
      && entry.phase !== 'files-landed' && entry.phase !== 'metadata-committed') return null
    if (entry.strategy !== 'atomic-rename' && entry.strategy !== 'replayable-move') return null
    if (!Array.isArray(entry.entries) || !Array.isArray(entry.directories)) return null
    if (typeof entry.metadataDisposition !== 'object' || entry.metadataDisposition === null) return null
    const disposition = entry.metadataDisposition as { kind?: unknown }
    if (disposition.kind !== 'prefix-move' && disposition.kind !== 'snapshot-restore') return null
    return entry as FolderMoveJournalV4
  } catch {
    return null
  }
}

/** Read the journal that recovery will actually observe. Executor errors
 * carry their latest attempted in-memory phase, but an interrupted
 * rewrite may have left an older durable phase on disk. */
export async function readDurableFolderMoveJournalV4(
  journalAbs: string,
): Promise<FolderMoveJournalV4 | null> {
  try {
    return parseDurableFolderMoveJournalV4(await fs.readFile(journalAbs, 'utf8'))
  } catch {
    return null
  }
}
