import { promises as fs } from 'node:fs'

import type { FolderMoveJournalV4 } from './folderMoveTransaction.js'

function normalizeGenerationDecimal(
  value: unknown,
  options: { positive: boolean },
): string | null {
  const pattern = options.positive ? /^[1-9]\d*$/ : /^\d+$/
  if (typeof value === 'string') {
    return pattern.test(value) ? value : null
  }
  // Compatibility with v4 journals written before exact decimal
  // strings. Unsafe numbers have already lost precision and cannot
  // prove a directory generation, so they fail closed.
  if (typeof value === 'number'
    && Number.isSafeInteger(value)
    && (options.positive ? value > 0 : value >= 0)) {
    return String(value)
  }
  return null
}

export function parseFolderMoveJournalV4Object(value: unknown): FolderMoveJournalV4 | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (entry.version !== 4) return null
  if (entry.op !== 'folder-rename' && entry.op !== 'folder-move') return null
  if (typeof entry.srcRel !== 'string' || typeof entry.destRel !== 'string') return null
  const sourceDev = normalizeGenerationDecimal(entry.sourceDev, { positive: false })
  const sourceIno = normalizeGenerationDecimal(entry.sourceIno, { positive: true })
  if (sourceDev === null || sourceIno === null) return null
  if (entry.phase !== 'prepared' && entry.phase !== 'gate-created'
    && entry.phase !== 'files-landed' && entry.phase !== 'metadata-committed') return null
  if (entry.strategy !== 'atomic-rename' && entry.strategy !== 'replayable-move') return null
  if (!Array.isArray(entry.entries) || !Array.isArray(entry.directories)) return null
  if (typeof entry.metadataDisposition !== 'object' || entry.metadataDisposition === null) return null
  const disposition = entry.metadataDisposition as { kind?: unknown }
  if (disposition.kind !== 'prefix-move' && disposition.kind !== 'snapshot-restore') return null
  return {
    ...(entry as unknown as FolderMoveJournalV4),
    sourceDev,
    sourceIno,
  }
}

export function parseDurableFolderMoveJournalV4(raw: string): FolderMoveJournalV4 | null {
  try {
    return parseFolderMoveJournalV4Object(JSON.parse(raw))
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
