import { normalizeTag } from './tags'
import type {
  ManagedTag,
  TagOperationApplyResult,
  TagOperationRequest,
} from './tag-management-api'

export interface TagSelectionSnapshot {
  selectedTag: string | null
  selectedTagId: number | null
  selectionEpoch: number
}

export interface ReconcileTagSelectionInput {
  snapshot: TagSelectionSnapshot
  currentSelectedTag: string | null
  currentSelectionEpoch: number
  operation: TagOperationRequest
  result: TagOperationApplyResult
  managedTags: readonly ManagedTag[]
}

/** Resolve a Phase 1 display value to management identity once, at the
 * authoritative list boundary. A display string is never used as a
 * post-Apply identity fallback. */
export function resolveManagedTagId(
  selectedTag: string | null | undefined,
  managedTags: readonly Pick<ManagedTag, 'id' | 'normalizedName'>[],
): number | null {
  const normalized = normalizeTag(selectedTag)
  if (!normalized) return null
  return managedTags.find((tag) => tag.normalizedName === normalized)?.id ?? null
}

export function captureTagSelection(
  selectedTag: string | null,
  managedTags: readonly Pick<ManagedTag, 'id' | 'normalizedName'>[],
  selectionEpoch: number,
): TagSelectionSnapshot {
  return {
    selectedTag,
    selectedTagId: resolveManagedTagId(selectedTag, managedTags),
    selectionEpoch,
  }
}

function displayForId(id: number | null, managedTags: readonly ManagedTag[]): string | null {
  if (id === null) return null
  return managedTags.find((tag) => tag.id === id)?.displayName ?? null
}

function reconciledId(
  snapshot: TagSelectionSnapshot,
  operation: TagOperationRequest,
  result: TagOperationApplyResult,
): number | null {
  const selectedId = snapshot.selectedTagId
  if (selectedId === null) return null

  if (operation.kind === 'rename' && selectedId === operation.sourceTagId) {
    return result.survivorTagId ?? result.sourceTagId
  }
  if (operation.kind === 'merge') {
    if (selectedId === operation.sourceTagId || selectedId === operation.destinationTagId) {
      return result.survivorTagId ?? result.destinationTagId
    }
  }
  if (operation.kind === 'remove' && selectedId === operation.sourceTagId) {
    return null
  }
  return selectedId
}

/**
 * Reconcile only when the user did not change selection during Apply. The
 * epoch is the race detector; elapsed time and display-string equality are
 * deliberately irrelevant.
 */
export function reconcileTagSelection(input: ReconcileTagSelectionInput): string | null {
  if (input.currentSelectionEpoch !== input.snapshot.selectionEpoch) {
    return input.currentSelectedTag
  }

  const id = reconciledId(input.snapshot, input.operation, input.result)
  // An unresolved pre-Apply string must not become attached to a refreshed
  // row merely because that row now has the same display value.
  return displayForId(id, input.managedTags)
}
