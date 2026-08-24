import { DIARY_ROOT, isManagedDiaryPath } from '../shared/diaryProtocol.js'
import { isProtectedRoot } from '../shared/archiveProtocol.js'

export type DocumentMutation =
  | { operation: 'create'; destinationPath: string }
  | { operation: 'recover'; destinationPath: string }
  | { operation: 'write'; destinationPath: string; destinationExists: boolean }
  | { operation: 'delete'; sourcePath: string }
  | { operation: 'rename'; sourcePath: string; destinationPath: string }

export type FolderMutation =
  | { operation: 'create'; path: string }
  | { operation: 'delete'; path: string }
  | { operation: 'rename'; sourcePath: string; destinationPath: string }

export class DocumentMutationPolicyError extends Error {
  readonly code = 'DOCUMENT_MUTATION_BLOCKED'

  constructor(message: string) {
    super(message)
    this.name = 'DocumentMutationPolicyError'
  }
}

function rejectMutation(message: string): never {
  throw new DocumentMutationPolicyError(message)
}

function isDiaryPath(path: string): boolean {
  return path === DIARY_ROOT || path.startsWith(`${DIARY_ROOT}/`)
}

function isDiaryDescendant(path: string): boolean {
  return path.startsWith(`${DIARY_ROOT}/`)
}

/** The server-side root contract shared by REST and AI mutations. */
export function validateDocumentMutation(mutation: DocumentMutation): void {
  const protectedPath = mutation.operation === 'create'
    || mutation.operation === 'recover'
    || mutation.operation === 'write'
    ? mutation.destinationPath
    : mutation.operation === 'delete'
      ? mutation.sourcePath
      : null
  if (protectedPath && isProtectedRoot(protectedPath)) {
    rejectMutation('protected root cannot be modified')
  }

  if (mutation.operation === 'rename'
    && (isProtectedRoot(mutation.sourcePath) || isProtectedRoot(mutation.destinationPath))) {
    rejectMutation('protected root cannot be modified')
  }

  if (mutation.operation === 'create' && isDiaryPath(mutation.destinationPath)) {
    rejectMutation('Diary documents must be created through the Diary date command')
  }

  if (mutation.operation === 'recover'
    && isDiaryPath(mutation.destinationPath)
    && !isManagedDiaryPath(mutation.destinationPath)) {
    rejectMutation('Diary recovery requires an existing managed date identity')
  }

  if (mutation.operation === 'write'
    && !mutation.destinationExists
    && isDiaryPath(mutation.destinationPath)) {
    rejectMutation('Diary documents must be created through the Diary date command')
  }

  if (mutation.operation === 'rename'
    && (isManagedDiaryPath(mutation.sourcePath) || isManagedDiaryPath(mutation.destinationPath))) {
    rejectMutation('managed Diary documents cannot change identity')
  }

  // Archive descendants are intentionally ordinary content. This validator
  // still runs for every REST/AI mutation, but only reserves the root names;
  // path traversal and filesystem confinement remain enforced by paths.ts.
}

/** Folder lifecycle guard kept next to the shared document policy. */
export function validateFolderMutation(mutation: FolderMutation): void {
  if (mutation.operation === 'create') {
    if (isProtectedRoot(mutation.path)) rejectMutation('protected root cannot be modified')
    if (isDiaryDescendant(mutation.path)) rejectMutation('folders cannot be created under diary')
    return
  }

  if (mutation.operation === 'delete' && isProtectedRoot(mutation.path)) {
    rejectMutation('protected root cannot be modified')
  }

  if (mutation.operation === 'rename'
    && (isProtectedRoot(mutation.sourcePath) || isProtectedRoot(mutation.destinationPath))) {
    rejectMutation('protected root cannot be modified')
  }
}
