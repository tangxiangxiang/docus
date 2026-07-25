import path from 'node:path'
import type { FolderMoveJournalV4 } from './folderMoveTransaction.js'

function validRelative(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

/**
 * Validate v4 provenance at the filesystem trust boundary. Structural path
 * checks alone are insufficient: every resolved endpoint and declared
 * physical path must remain below the vault root, including empty trees.
 */
export function validateFolderMoveJournalV4Provenance(
  journal: FolderMoveJournalV4,
  contentDir: string,
): string | null {
  if (journal.srcRel === journal.destRel) return 'srcRel must not equal destRel'
  if (!validRelative(journal.srcRel)) return `invalid srcRel: ${journal.srcRel}`
  if (!validRelative(journal.destRel)) return `invalid destRel: ${journal.destRel}`

  const root = path.resolve(contentDir)
  const contained = (rel: string): boolean => {
    const resolved = path.resolve(root, rel)
    return resolved === root || resolved.startsWith(`${root}${path.sep}`)
  }
  if (!contained(journal.srcRel) || !contained(journal.destRel)) return 'journal endpoint escapes contentDir'

  for (const entry of journal.entries) {
    if (!validRelative(entry.relativeFilePath)) return `invalid entry path: ${entry.relativeFilePath}`
    if (!contained(path.join(journal.srcRel, entry.relativeFilePath))
      || !contained(path.join(journal.destRel, entry.relativeFilePath))) {
      return `entry escapes contentDir: ${entry.relativeFilePath}`
    }
  }
  for (const directory of journal.directories) {
    if (!validRelative(directory)) return `invalid directory entry: ${directory}`
    if (!contained(path.join(journal.srcRel, directory))
      || !contained(path.join(journal.destRel, directory))) {
      return `directory escapes contentDir: ${directory}`
    }
  }
  return null
}
