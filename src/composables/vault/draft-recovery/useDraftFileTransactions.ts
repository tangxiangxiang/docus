import type { UnsavedDraft } from './draftTypes'
import type { DraftBufferSnapshot } from './useUnsavedDraftPersistence'

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

export interface DraftDeleteConfirmation extends DraftDocumentIdentity {
  revision: number
  ownerGeneration: number
  expectedDraft: UnsavedDraft | null
  expectedSnapshot: DraftBufferSnapshot | null
}

export interface DraftDeleteRequest extends DraftDocumentIdentity {
  policy: DraftDeletePolicy
  confirmation?: DraftDeleteConfirmation | null
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
    preserved?: readonly DraftDocumentIdentity[],
  ): Promise<DraftFileTransactionResult[]>
  commitDeletes(
    deletions: readonly DraftDeleteRequest[],
  ): Promise<DraftFileTransactionResult[]>
  finalizeAfterTabMigration(): Promise<void>
  rollback(): Promise<void>
}
