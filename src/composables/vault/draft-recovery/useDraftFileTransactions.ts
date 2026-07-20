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
  /** Final persistence gate before the lifecycle closes document tabs.
   *  A delete transaction releases every entry when it reports, but the
   *  lifecycle still awaits Recovery synchronization before closing tabs
   *  — edits typed during that async window arm a fresh debounce that
   *  the tab close could outrun. This gate re-verifies each released
   *  entry and persists anything still pending IMMEDIATELY (on the
   *  entry's active channel); a rejected write produces a `failed`
   *  result so the lifecycle keeps that tab open — it is the only
   *  surface still holding those bytes. A successful write produces a
   *  `preserved` result so the lifecycle's post-close Recovery sync
   *  refreshes the identity (showing the settlement-window edit, or
   *  re-adding an orphan recorded after a confirmed delete) — it never
   *  warns. The lifecycle must close tabs synchronously after this
   *  promise resolves, before any further await, so no user input event
   *  can open a new window. */
  finalizeBeforeDocumentClose(): Promise<DraftFileTransactionResult[]>
  /** Immediate post-tab-migration persistence results. Each pending
   *  release writes its latest snapshot to the actual post-rename path;
   *  a rejected write produces a `failed` result (with the actual
   *  server-suffixed `newPath`) that the lifecycle merges into its
   *  reported transaction results — the server rename stays successful
   *  and the tab keeps its new path, but the user is warned that the
   *  local draft could not be persisted. Identities the commit already
   *  reported `failed` are released too — their transaction token must
   *  not outlive the barrier — but not re-reported. */
  finalizeAfterTabMigration(): Promise<DraftFileTransactionResult[]>
  rollback(): Promise<void>
}
