export type MetadataContext = 'document' | 'history' | 'diff' | 'recovery'

export interface MetadataBase {
  title: string
  summary: string
  tags: string[]
  updatedAt: number
}

export interface MetadataDraft {
  documentId: string
  path: string
  title: string
  summary: string
  tagsText: string
  base: MetadataBase
  dirty: boolean
  revision: number
}

/** Session-only drafts. Deliberately not persisted or connected to recovery. */
export const draftsByDocumentId = new Map<string, MetadataDraft>()

export function clearMetadataDraftForPath(path: string): void {
  for (const [id, draft] of draftsByDocumentId) {
    if (draft.path === path) draftsByDocumentId.delete(id)
  }
}

export function updateMetadataDraftPath(oldPath: string, newPath: string): void {
  for (const draft of draftsByDocumentId.values()) {
    if (draft.path === oldPath) draft.path = newPath
  }
}
