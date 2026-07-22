import path from 'node:path'
import { isInArchive } from '../src/composables/archiveProtocol.js'

export type DocumentMutation =
  | { operation: 'create'; destinationPath: string }
  | { operation: 'write'; destinationPath: string; destinationExists: boolean }
  | { operation: 'delete'; sourcePath: string }
  | { operation: 'rename'; sourcePath: string; destinationPath: string }

/** The server-side Archive protocol shared by REST and AI mutations. */
export function validateDocumentMutation(mutation: DocumentMutation): void {
  if (mutation.operation === 'create'
    || (mutation.operation === 'write' && !mutation.destinationExists)) {
    if (isInArchive(mutation.destinationPath)) {
      throw new Error('archive notes must be created through archive flow')
    }
    return
  }

  if (mutation.operation === 'write') return

  if (mutation.operation === 'delete') {
    if (isInArchive(mutation.sourcePath)) {
      throw new Error('archive notes cannot be deleted')
    }
    return
  }

  const sourceInArchive = isInArchive(mutation.sourcePath)
  const destinationInArchive = isInArchive(mutation.destinationPath)
  if (sourceInArchive && !destinationInArchive) {
    throw new Error('archive notes can only be moved within archive')
  }
  if (sourceInArchive && destinationInArchive) {
    if (path.posix.dirname(mutation.sourcePath) === path.posix.dirname(mutation.destinationPath)) {
      throw new Error('archive notes cannot be renamed')
    }
    return
  }
  if (destinationInArchive) {
    const archiveable = mutation.sourcePath === 'inbox'
      || mutation.sourcePath.startsWith('inbox/')
      || mutation.sourcePath === 'literature'
      || mutation.sourcePath.startsWith('literature/')
    if (!archiveable) {
      throw new Error('only inbox/ and literature/ notes can be archived to archive')
    }
  }
}
