import { isProtectedRoot } from '../shared/archiveProtocol.js'

export type DocumentMutation =
  | { operation: 'create'; destinationPath: string }
  | { operation: 'write'; destinationPath: string; destinationExists: boolean }
  | { operation: 'delete'; sourcePath: string }
  | { operation: 'rename'; sourcePath: string; destinationPath: string }

/** The server-side root contract shared by REST and AI mutations. */
export function validateDocumentMutation(mutation: DocumentMutation): void {
  const protectedPath = mutation.operation === 'create' || mutation.operation === 'write'
    ? mutation.destinationPath
    : mutation.operation === 'delete'
      ? mutation.sourcePath
      : null
  if (protectedPath && isProtectedRoot(protectedPath)) {
    throw new Error('protected root cannot be modified')
  }

  if (mutation.operation === 'rename'
    && (isProtectedRoot(mutation.sourcePath) || isProtectedRoot(mutation.destinationPath))) {
    throw new Error('protected root cannot be modified')
  }

  // Archive descendants are intentionally ordinary content. This validator
  // still runs for every REST/AI mutation, but only reserves the root names;
  // path traversal and filesystem confinement remain enforced by paths.ts.
}
