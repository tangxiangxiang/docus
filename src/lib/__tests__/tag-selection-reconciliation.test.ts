// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  captureTagSelection,
  reconcileTagSelection,
  resolveManagedTagId,
} from '../tag-selection-reconciliation'
import type { ManagedTag, TagOperationApplyResult, TagOperationRequest } from '../tag-management-api'

const tags: ManagedTag[] = [
  { id: 7, normalizedName: 'java', displayName: 'Java', documentCount: 4 },
  { id: 9, normalizedName: 'backend', displayName: 'Backend', documentCount: 4 },
  { id: 20, normalizedName: 'python', displayName: 'Python', documentCount: 2 },
]

function result(operation: TagOperationRequest, overrides: Partial<TagOperationApplyResult> = {}): TagOperationApplyResult {
  return {
    operationId: 'op',
    resultId: 'op',
    kind: operation.kind,
    operation,
    sourceTagId: operation.sourceTagId,
    destinationTagId: operation.kind === 'merge' ? operation.destinationTagId : null,
    survivorTagId: operation.kind === 'remove' ? null : operation.kind === 'merge' ? operation.destinationTagId : operation.sourceTagId,
    sourceTag: null,
    destinationTag: null,
    survivorTag: null,
    sourceDisplayName: null,
    sourceNormalizedName: null,
    destinationDisplayName: null,
    destinationNormalizedName: null,
    survivorDisplayName: null,
    survivorNormalizedName: null,
    sourceDeleted: operation.kind !== 'rename',
    affectedCount: 1,
    associationAdds: 0,
    associationRemoves: 0,
    duplicateCollapses: 0,
    tagCreates: 0,
    tagDeletes: 0,
    displayOnly: false,
    versionUpdateCount: 1,
    commitTimestamp: 1,
    appliedFingerprint: 'a'.repeat(64),
    ...overrides,
  }
}

describe('tag selection reconciliation', () => {
  it('resolves identity by normalized list value but never by an arbitrary string after Apply', () => {
    expect(resolveManagedTagId(' #JAVA ', tags)).toBe(7)
    expect(resolveManagedTagId('Missing', tags)).toBeNull()
  })

  it('keeps Rename source id selected and follows the fresh survivor display', () => {
    const operation = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'Backend' }
    const snapshot = captureTagSelection('Java', tags, 12)
    expect(reconcileTagSelection({
      snapshot,
      currentSelectedTag: 'Java',
      currentSelectionEpoch: 12,
      operation,
      result: result(operation),
      managedTags: [{ ...tags[0]!, displayName: 'Backend' }, tags[1]!, tags[2]!],
    })).toBe('Backend')
  })

  it('keeps the same stable id for Display Rename', () => {
    const operation = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'JAVA' }
    const snapshot = captureTagSelection('Java', tags, 1)
    expect(reconcileTagSelection({
      snapshot,
      currentSelectedTag: 'Java',
      currentSelectionEpoch: 1,
      operation,
      result: result(operation, { displayOnly: true }),
      managedTags: [{ ...tags[0]!, displayName: 'JAVA' }, tags[1]!, tags[2]!],
    })).toBe('JAVA')
  })

  it('maps Merge source and destination selection to the survivor, and Remove to null', () => {
    const merge = { kind: 'merge' as const, sourceTagId: 7, destinationTagId: 9 }
    expect(reconcileTagSelection({
      snapshot: captureTagSelection('Java', tags, 1),
      currentSelectedTag: 'Java',
      currentSelectionEpoch: 1,
      operation: merge,
      result: result(merge),
      managedTags: tags,
    })).toBe('Backend')
    expect(reconcileTagSelection({
      snapshot: captureTagSelection('Backend', tags, 1),
      currentSelectedTag: 'Backend',
      currentSelectionEpoch: 1,
      operation: merge,
      result: result(merge),
      managedTags: tags,
    })).toBe('Backend')

    const remove = { kind: 'remove' as const, sourceTagId: 7 }
    expect(reconcileTagSelection({
      snapshot: captureTagSelection('Java', tags, 1),
      currentSelectedTag: 'Java',
      currentSelectionEpoch: 1,
      operation: remove,
      result: result(remove),
      managedTags: tags.filter((tag) => tag.id !== 7),
    })).toBeNull()
  })

  it('preserves an unrelated stable selection and an actual mid-Apply user change', () => {
    const operation = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'Backend' }
    expect(reconcileTagSelection({
      snapshot: captureTagSelection('Python', tags, 12),
      currentSelectedTag: 'Python',
      currentSelectionEpoch: 12,
      operation,
      result: result(operation),
      managedTags: tags,
    })).toBe('Python')

    expect(reconcileTagSelection({
      snapshot: captureTagSelection('Java', tags, 12),
      currentSelectedTag: 'Python',
      currentSelectionEpoch: 13,
      operation,
      result: result(operation),
      managedTags: [{ ...tags[0]!, displayName: 'Backend' }, tags[1]!, tags[2]!],
    })).toBe('Python')
  })

  it('does not attach an unresolved pre-Apply string to a refreshed row by display coincidence', () => {
    const operation = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'Backend' }
    expect(reconcileTagSelection({
      snapshot: captureTagSelection('Backend', [tags[0]!], 12),
      currentSelectedTag: 'Backend',
      currentSelectionEpoch: 12,
      operation,
      result: result(operation),
      managedTags: [{ ...tags[0]!, displayName: 'Backend' }],
    })).toBeNull()
  })
})
