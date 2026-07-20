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
  /** The conflict record ids present for this identity at the moment
   *  the user confirmed the delete. A confirmed discard removes
   *  exactly these — a conflict recorded after confirmation was never
   *  part of the confirmed set and must survive. */
  expectedConflictIds: string[]
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
