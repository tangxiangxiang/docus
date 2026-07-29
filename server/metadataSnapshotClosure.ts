import {
  hasValidSnapshotRowSchema,
  isSerializedMetadataSnapshot,
} from './folderMoveTransaction.js'
import type { SerializedMetadataSnapshot } from './folderMoveTransaction.js'

export type MetadataSnapshotValidationMode = 'row-schema-only' | 'closed-graph'

/**
 * Unified metadata snapshot validator for the four durable snapshot
 * sites (parser, prefix preparedSnapshot, prefix committedSnapshot,
 * snapshot-restore snapshot + expectedCurrentSnapshot).
 *
 *   'row-schema-only' -> hasValidSnapshotRowSchema (cheap; rows typed)
 *   'closed-graph'    -> isSerializedMetadataSnapshot (top-level ID
 *                        set + row set equality + cross-row references
 *                        + duplicate detection). Equivalent to the
 *                        combination of isSerializedMetadataSnapshot
 *                        plus the latent validateSnapshotClosure set
 *                        equality that round-17 was missing.
 *
 * Mode 'closed-graph' is what durable sites require; the
 * row-schema-only mode is kept for diagnostic / non-persistence
 * callers that want the cheaper check.
 */
export async function validateSerializedMetadataSnapshot(
  snapshot: SerializedMetadataSnapshot,
  options: { mode: MetadataSnapshotValidationMode },
): Promise<SerializedMetadataSnapshot | null> {
  if (options.mode === 'row-schema-only') {
    return hasValidSnapshotRowSchema(snapshot) ? snapshot : null
  }
  return isSerializedMetadataSnapshot(snapshot) ? snapshot : null
}
