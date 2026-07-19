export type DraftDeletePolicy = 'preserve' | 'discard-confirmed'

export interface DraftDocumentIdentity {
  vaultId: string
  documentId: string
  documentPath: string
}

export interface DraftPathMapping {
  vaultId: string
  documentId: string
  fromPath: string
  toPath: string
}

export interface DraftDeleteRequest extends DraftDocumentIdentity {
  policy: DraftDeletePolicy
  confirmedRevision?: number | null
}

export type DraftFileTransactionStatus =
  | 'moved'
  | 'deleted'
  | 'missing'
  | 'preserved'
  | 'stale'
  | 'identity-mismatch'
  | 'conflict'
  | 'unsupported'
  | 'failed'

export interface DraftFileTransactionResult {
  documentId: string
  oldPath: string
  newPath?: string
  status: DraftFileTransactionStatus
}

export interface DraftFileMutationBarrier {
  commitMoves(
    mappings: readonly DraftPathMapping[],
  ): Promise<DraftFileTransactionResult[]>
  commitDeletes(
    deletions: readonly DraftDeleteRequest[],
  ): Promise<DraftFileTransactionResult[]>
  rollback(): Promise<void>
}
