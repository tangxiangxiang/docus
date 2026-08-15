// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { useI18n } from '../../../composables/useI18n'
import TagManagementDialog from '../TagManagementDialog.vue'
import type {
  ManagedTag,
  TagOperationApplyResult,
  TagOperationPreview,
} from '../../../lib/tag-management-api'
import { reconcileTagSelection, type TagSelectionSnapshot } from '../../../lib/tag-selection-reconciliation'

const mocks = vi.hoisted(() => ({
  listManagedTags: vi.fn(),
  previewTagOperation: vi.fn(),
  getTagOperationPreviewPage: vi.fn(),
  applyTagOperation: vi.fn(),
  assertApplyResultMatchesReviewedPreview: vi.fn(),
  TagManagementApiError: class extends Error {
    readonly status: number
    readonly code: string
    constructor(message: string, status: number, code: string) {
      super(message)
      this.name = 'TagManagementApiError'
      this.status = status
      this.code = code
    }
  },
}))

vi.mock('../../../lib/tag-management-api', () => mocks)

const TAGS: ManagedTag[] = [
  { id: 7, normalizedName: 'java', displayName: 'Java', documentCount: 3 },
  { id: 20, normalizedName: 'python', displayName: 'Python', documentCount: 2 },
]
const RENAMED_TAGS: ManagedTag[] = [
  { id: 7, normalizedName: 'backend', displayName: 'Backend', documentCount: 3 },
  TAGS[1]!,
]
const operation = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'Backend' }
const mergeOperation = { kind: 'merge' as const, sourceTagId: 7, destinationTagId: 20 }
const mergeDestination = { id: 20, normalizedName: 'python', displayName: 'Python' }

function makePreview(overrides: Partial<TagOperationPreview> = {}): TagOperationPreview {
  return {
    operation,
    sourceTag: { id: 7, normalizedName: 'java', displayName: 'Java' },
    destinationTag: null,
    requestedDestination: { displayName: 'Backend', normalizedName: 'backend' },
    survivorTag: { id: 7, normalizedName: 'java', displayName: 'Java' },
    displayOnly: false,
    affectedCount: 3,
    associationAdds: 0,
    associationRemoves: 0,
    duplicateCollapses: 0,
    tagCreates: 0,
    tagDeletes: 0,
    warnings: [],
    allowedToApply: true,
    planFingerprint: 'a'.repeat(64),
    healthContractVersion: 'tag-identity-v1',
    sample: [{ id: 'doc-1', path: 'inbox/one', title: 'One' }],
    nextAfterDocumentId: null,
    ...overrides,
  }
}

function makeResult(overrides: Partial<TagOperationApplyResult> = {}): TagOperationApplyResult {
  return {
    operationId: 'operation-1',
    resultId: 'operation-1',
    kind: 'rename',
    operation,
    sourceTagId: 7,
    destinationTagId: null,
    survivorTagId: 7,
    sourceTag: { id: 7, normalizedName: 'backend', displayName: 'Backend' },
    destinationTag: null,
    survivorTag: { id: 7, normalizedName: 'backend', displayName: 'Backend' },
    sourceDisplayName: 'Backend',
    sourceNormalizedName: 'backend',
    destinationDisplayName: null,
    destinationNormalizedName: null,
    survivorDisplayName: 'Backend',
    survivorNormalizedName: 'backend',
    sourceDeleted: false,
    affectedCount: 3,
    associationAdds: 0,
    associationRemoves: 0,
    duplicateCollapses: 0,
    tagCreates: 0,
    tagDeletes: 0,
    displayOnly: false,
    versionUpdateCount: 3,
    commitTimestamp: 1_700_000_000_000,
    appliedFingerprint: 'a'.repeat(64),
    ...overrides,
  }
}

function makeMergePreview(overrides: Partial<TagOperationPreview> = {}): TagOperationPreview {
  return makePreview({
    operation: mergeOperation,
    sourceTag: { id: 7, normalizedName: 'java', displayName: 'Java' },
    destinationTag: mergeDestination,
    requestedDestination: null,
    survivorTag: mergeDestination,
    displayOnly: false,
    affectedCount: 3,
    associationAdds: 2,
    associationRemoves: 3,
    duplicateCollapses: 1,
    tagCreates: 0,
    tagDeletes: 1,
    warnings: ['DESTRUCTIVE'],
    ...overrides,
  })
}

function makeMergeResult(overrides: Partial<TagOperationApplyResult> = {}): TagOperationApplyResult {
  return {
    operationId: 'merge-operation-1',
    resultId: 'merge-operation-1',
    kind: 'merge',
    operation: mergeOperation,
    sourceTagId: 7,
    destinationTagId: 20,
    survivorTagId: 20,
    sourceTag: null,
    destinationTag: mergeDestination,
    survivorTag: mergeDestination,
    sourceDisplayName: null,
    sourceNormalizedName: null,
    destinationDisplayName: 'Python',
    destinationNormalizedName: 'python',
    survivorDisplayName: 'Python',
    survivorNormalizedName: 'python',
    sourceDeleted: true,
    affectedCount: 3,
    associationAdds: 2,
    associationRemoves: 3,
    duplicateCollapses: 1,
    tagCreates: 0,
    tagDeletes: 1,
    displayOnly: false,
    versionUpdateCount: 3,
    commitTimestamp: 1_700_000_000_000,
    appliedFingerprint: 'a'.repeat(64),
    ...overrides,
  }
}

function mountDialog(options: {
  selectedTag?: string | null
  selectionEpoch?: number
  refreshPosts?: () => void | Promise<void>
  syncAfterCommit?: (
    result: TagOperationApplyResult,
    snapshot: TagSelectionSnapshot,
  ) => Promise<{ managedTags: ManagedTag[]; selectedTag: string | null }>
} = {}): VueWrapper {
  const syncAfterCommit = options.syncAfterCommit ?? (async (
    result: TagOperationApplyResult,
    snapshot: TagSelectionSnapshot,
  ) => {
    const [, tags] = await Promise.all([
      options.refreshPosts?.(),
      mocks.listManagedTags(),
    ])
    const managedTags = tags as ManagedTag[]
    return {
      managedTags,
      selectedTag: reconcileTagSelection({
        snapshot,
        currentSelectedTag: options.selectedTag ?? null,
        currentSelectionEpoch: options.selectionEpoch ?? 0,
        operation: result.operation,
        result,
        managedTags,
      }),
    }
  })
  return mount(TagManagementDialog, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
    props: {
      open: true,
      selectedTag: options.selectedTag ?? null,
      selectionEpoch: options.selectionEpoch ?? 0,
      syncAfterCommit,
    },
  })
}

async function settle(): Promise<void> {
  await flushPromises()
  await flushPromises()
}

describe('TagManagementDialog', () => {
  let wrappers: VueWrapper[] = []

  beforeEach(() => {
    useI18n().setLocale('en')
    mocks.listManagedTags.mockReset().mockResolvedValue(TAGS)
    mocks.previewTagOperation.mockReset().mockResolvedValue(makePreview())
    mocks.getTagOperationPreviewPage.mockReset().mockResolvedValue(makePreview({
      sample: [{ id: 'doc-2', path: 'inbox/two', title: 'Two' }],
      nextAfterDocumentId: 'doc-2',
    }))
    mocks.applyTagOperation.mockReset().mockResolvedValue(makeResult())
    mocks.assertApplyResultMatchesReviewedPreview.mockReset()
  })

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount()
    wrappers = []
    document.body.innerHTML = ''
    useI18n().setLocale('zh')
  })

  function mountTracked(options: Parameters<typeof mountDialog>[0] = {}): VueWrapper {
    const wrapper = mountDialog(options)
    wrappers.push(wrapper)
    return wrapper
  }

  it('loads the authoritative stable-ID list and keeps the production trigger absent', async () => {
    const wrapper = mountTracked()
    await settle()
    expect(mocks.listManagedTags).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('ready')
    expect(wrapper.get('#tag-management-source').findAll('option')).toHaveLength(3)
    expect(wrapper.text()).toContain('Manage tags')
    expect(wrapper.text()).not.toContain('Remove')
    expect(wrapper.find('[data-operation="merge"]').exists()).toBe(true)
  })

  it('renders a safe unavailable state and makes Preview/Apply impossible', async () => {
    mocks.listManagedTags.mockRejectedValueOnce(new mocks.TagManagementApiError('unavailable', 503, 'TAG_MANAGEMENT_UNAVAILABLE'))
    const wrapper = mountTracked()
    await settle()
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('unavailable')
    expect(wrapper.text()).toContain('temporarily unavailable')
    expect(wrapper.find('[data-action="reload"]').exists()).toBe(true)
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)
  })

  it('refreshes the authoritative list and discards Preview on preview TAG_NOT_FOUND', async () => {
    mocks.previewTagOperation.mockRejectedValueOnce(new mocks.TagManagementApiError('missing', 404, 'TAG_NOT_FOUND'))
    mocks.listManagedTags
      .mockReset()
      .mockResolvedValueOnce(TAGS)
      .mockResolvedValueOnce([TAGS[1]!])
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(mocks.listManagedTags).toHaveBeenCalledTimes(2)
    expect(mocks.previewTagOperation).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('editing')
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)
    expect((wrapper.get('#tag-management-destination').element as HTMLInputElement).value).toBe('Backend')
    expect((wrapper.get('#tag-management-source').element as HTMLSelectElement).value).toBe('')
    expect(wrapper.text()).toContain('source tag no longer exists')
  })

  it('refreshes the authoritative list on Apply TAG_NOT_FOUND without re-Applying', async () => {
    mocks.applyTagOperation.mockRejectedValueOnce(new mocks.TagManagementApiError('missing', 404, 'TAG_NOT_FOUND'))
    mocks.listManagedTags
      .mockReset()
      .mockResolvedValueOnce(TAGS)
      .mockResolvedValueOnce([TAGS[1]!])
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    expect(mocks.listManagedTags).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('editing')
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)
    expect((wrapper.get('#tag-management-destination').element as HTMLInputElement).value).toBe('Backend')
    expect((wrapper.get('#tag-management-source').element as HTMLSelectElement).value).toBe('')
    expect(wrapper.text()).toContain('source tag no longer exists')
  })

  it('clears a deleted Merge destination after Apply TAG_NOT_FOUND and requires a new Preview', async () => {
    mocks.previewTagOperation.mockResolvedValueOnce(makeMergePreview())
    mocks.applyTagOperation.mockRejectedValueOnce(new mocks.TagManagementApiError('missing', 404, 'TAG_NOT_FOUND'))
    mocks.listManagedTags
      .mockReset()
      .mockResolvedValueOnce(TAGS)
      .mockResolvedValueOnce([TAGS[0]!])
    const wrapper = mountTracked({ selectedTag: 'Java' })
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('20')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.find('.tag-management-preview').exists()).toBe(true)

    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    expect(mocks.listManagedTags).toHaveBeenCalledTimes(2)
    expect(mocks.previewTagOperation).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('editing')
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)
    expect((wrapper.get('#tag-management-source').element as HTMLSelectElement).value).toBe('7')
    expect((wrapper.get('#tag-management-destination').element as HTMLSelectElement).value).toBe('')
    expect(wrapper.get('#tag-management-destination').findAll('option').map((option) => option.attributes('value'))).toEqual([''])
    expect(wrapper.text()).toContain('source tag no longer exists')

    await wrapper.get('form').trigger('submit')
    await settle()
    expect(mocks.previewTagOperation).toHaveBeenCalledTimes(1)
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
  })

  it('health-blocks management on TAG_IDENTITY_CONFLICT', async () => {
    mocks.previewTagOperation.mockRejectedValueOnce(new mocks.TagManagementApiError('identity conflict', 409, 'TAG_IDENTITY_CONFLICT'))
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('unavailable')
    expect(wrapper.text()).toContain('Tag identity health failed')
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)
    expect(mocks.applyTagOperation).not.toHaveBeenCalled()
  })

  it('offers Merge without Remove and binds an existing destination by stable ID', async () => {
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')

    const destination = wrapper.get('#tag-management-destination')
    expect(destination.findAll('option').map((option) => option.attributes('value'))).toEqual(['', '20'])
    expect(wrapper.text()).not.toContain('Remove')

    await wrapper.get('#tag-management-destination-search').setValue('python')
    expect(destination.findAll('option').map((option) => option.attributes('value'))).toEqual(['', '20'])
    await destination.setValue('20')
    expect((destination.element as HTMLSelectElement).value).toBe('20')
    expect(wrapper.find('[data-selected-destination]').text()).toContain('Python')

    await wrapper.get('#tag-management-destination-search').setValue('java')
    expect((destination.element as HTMLSelectElement).value).toBe('20')
    expect(wrapper.find('[data-selected-destination]').text()).toContain('Python')
    expect(destination.findAll('option').map((option) => option.attributes('value'))).toEqual(['', '20'])
  })

  it('requires a current Merge Preview and renders overlap, survivor, and deletion evidence', async () => {
    mocks.previewTagOperation.mockResolvedValueOnce(makeMergePreview())
    mocks.applyTagOperation.mockResolvedValueOnce(makeMergeResult())
    mocks.listManagedTags
      .mockReset()
      .mockResolvedValueOnce(TAGS)
      .mockResolvedValueOnce([TAGS[1]!])
    const wrapper = mountTracked({ selectedTag: 'Java', selectionEpoch: 12 })
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('20')
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)

    await wrapper.get('form').trigger('submit')
    await settle()
    expect(mocks.previewTagOperation).toHaveBeenCalledWith(mergeOperation)
    expect(wrapper.findAll('.tag-management-summary dd')[0]?.text()).toBe('Merge')
    expect(wrapper.text()).toContain('Duplicate associations collapsed')
    expect(wrapper.text()).toContain('Source-only documents receive the destination tag')
    expect(wrapper.text()).toContain('The destination tag will survive')
    expect(wrapper.text()).toContain('will be deleted')
    expect(wrapper.text()).toContain('1')
    expect(wrapper.get('.tag-management-preview .primary').text()).toContain('Apply Merge')

    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(mocks.applyTagOperation).toHaveBeenCalledWith(mergeOperation, 'a'.repeat(64))
    expect(wrapper.get('.tag-management-state-success').attributes('data-selected-tag')).toBe('Python')
    expect(wrapper.text()).toContain('Surviving destination tag: Python')
  })

  it('fails closed before synchronization when Merge Apply changes the reviewed destination display identity', async () => {
    const reviewedPreview = makeMergePreview()
    const changedResult = makeMergeResult({
      destinationTag: { id: 20, normalizedName: 'python', displayName: 'Changed' },
      survivorTag: { id: 20, normalizedName: 'python', displayName: 'Changed' },
      destinationDisplayName: 'Changed',
      survivorDisplayName: 'Changed',
    })
    mocks.previewTagOperation.mockResolvedValueOnce(reviewedPreview)
    mocks.applyTagOperation.mockResolvedValueOnce(changedResult)
    mocks.assertApplyResultMatchesReviewedPreview.mockImplementationOnce((result: TagOperationApplyResult, preview: TagOperationPreview) => {
      expect(result).toBe(changedResult)
      expect(preview).toBe(reviewedPreview)
      throw new mocks.TagManagementApiError('invalid response', 200, 'CLIENT_PROTOCOL_ERROR')
    })
    const syncAfterCommit = vi.fn(async () => ({ managedTags: TAGS, selectedTag: 'Python' }))
    const wrapper = mountTracked({ syncAfterCommit })
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('20')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()

    expect(mocks.assertApplyResultMatchesReviewedPreview).toHaveBeenCalledTimes(1)
    expect(syncAfterCommit).not.toHaveBeenCalled()
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('error')
    expect(wrapper.get('[role="dialog"]').attributes('data-diagnostic-code')).toBe('CLIENT_PROTOCOL_ERROR')
    expect(wrapper.find('.tag-management-state-success').exists()).toBe(false)
    expect(wrapper.text()).toContain('Preview again before retrying')
  })

  it('clears a destination when the source changes to that stable ID and invalidates Preview', async () => {
    mocks.previewTagOperation.mockResolvedValueOnce(makeMergePreview())
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('20')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.find('.tag-management-preview').exists()).toBe(true)

    await wrapper.get('#tag-management-source').setValue('20')
    await settle()
    expect((wrapper.get('#tag-management-destination').element as HTMLSelectElement).value).toBe('')
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)
    expect(mocks.applyTagOperation).not.toHaveBeenCalled()
  })

  it('invalidates a Merge Preview when switching back to Rename', async () => {
    mocks.previewTagOperation.mockResolvedValueOnce(makeMergePreview())
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('20')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.find('.tag-management-preview').exists()).toBe(true)

    await wrapper.get('[data-operation="rename"]').trigger('click')
    await settle()
    expect(wrapper.find('.tag-management-preview').exists()).toBe(false)
    expect(wrapper.find('#tag-management-destination-search').exists()).toBe(false)
    expect(wrapper.find('#tag-management-destination').element.tagName).toBe('INPUT')
  })

  it('does not route an impossible Merge DESTINATION_EXISTS error into Rename guidance', async () => {
    mocks.previewTagOperation.mockRejectedValueOnce(new mocks.TagManagementApiError('collision', 409, 'DESTINATION_EXISTS'))
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('20')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).not.toContain('Use Merge instead')
    expect(wrapper.text()).toContain('This Preview cannot be applied')
  })

  it('keeps a committed Merge in sync-pending and retries sync without applying again', async () => {
    mocks.previewTagOperation.mockResolvedValueOnce(makeMergePreview())
    mocks.applyTagOperation.mockResolvedValueOnce(makeMergeResult())
    let syncAttempts = 0
    const syncAfterCommit = vi.fn(async () => {
      syncAttempts += 1
      if (syncAttempts === 1) throw new Error('sync unavailable')
      return { managedTags: [TAGS[1]!], selectedTag: 'Python' }
    })
    const wrapper = mountTracked({ syncAfterCommit })
    await settle()
    await wrapper.get('[data-operation="merge"]').trigger('click')
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('20')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('sync-pending')
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    await wrapper.get('.tag-management-state-error .primary').trigger('click')
    await settle()
    expect(syncAfterCommit).toHaveBeenCalledTimes(2)
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('success')
  })

  it('previews and applies a normal Rename with exact server counts and one sync cycle', async () => {
    const events: string[] = []
    const refreshPosts = vi.fn(async () => { events.push('posts-refresh') })
    mocks.listManagedTags
      .mockReset()
      .mockResolvedValueOnce(TAGS)
      .mockImplementationOnce(async () => { events.push('tag-list-refresh'); return RENAMED_TAGS })
    const wrapper = mountTracked({ selectedTag: 'Java', selectionEpoch: 12, refreshPosts })
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('Affected documents')
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('Associations added')
    expect(wrapper.text()).toContain('Affected document sample')
    expect(wrapper.findAll('[data-state="preview-ready"]').length).toBe(1)
    expect(wrapper.get('.tag-management-live').text()).toContain('Preview ready')

    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(mocks.applyTagOperation).toHaveBeenCalledWith(operation, 'a'.repeat(64))
    expect(refreshPosts).toHaveBeenCalledTimes(1)
    expect(mocks.listManagedTags).toHaveBeenCalledTimes(2)
    expect(events).toEqual(['posts-refresh', 'tag-list-refresh'])
    expect(wrapper.text()).toContain('The tag operation was committed')
    expect(wrapper.text()).toContain('Final display name: Backend')
    expect(wrapper.get('.tag-management-live').text()).toContain('Tags are synchronized')
    expect(wrapper.get('.tag-management-state-success').attributes('data-selected-tag')).toBe('Backend')
  })

  it('labels server-authoritative Display Rename and explains identity preservation', async () => {
    const displayOperation = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'JAVA' }
    mocks.previewTagOperation.mockResolvedValueOnce(makePreview({
      operation: displayOperation,
      requestedDestination: { displayName: 'JAVA', normalizedName: 'java' },
      displayOnly: true,
      associationAdds: 0,
      associationRemoves: 0,
    }))
    mocks.applyTagOperation.mockResolvedValueOnce(makeResult({
      operation: displayOperation,
      displayOnly: true,
    }))
    const wrapper = mountTracked({ selectedTag: 'Java', selectionEpoch: 1 })
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('JAVA')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('Display Rename')
    expect(wrapper.text()).toContain('preserves the stable tag identity')
    const summaryValues = wrapper.findAll('.tag-management-summary dd').map((entry) => entry.text())
    expect(summaryValues[4]).toBe('0')
    expect(summaryValues[5]).toBe('0')
    expect(summaryValues[7]).toBe('0')
    expect(mocks.applyTagOperation).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'merge' }), expect.anything())
  })

  it('shows destination conflicts as a blocked Rename without exposing another operation', async () => {
    mocks.previewTagOperation.mockResolvedValueOnce(makePreview({
      allowedToApply: false,
      conflictCode: 'DESTINATION_EXISTS',
      destinationTag: { id: 20, normalizedName: 'backend', displayName: 'Backend' },
    }))
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('already belongs to another tag')
    expect(wrapper.text()).toContain('Use Merge instead')
    expect(wrapper.find('[data-operation="merge"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some((button) => /merge/i.test(button.text()))).toBe(true)
    expect(wrapper.find('.tag-management-preview .primary').attributes('disabled')).toBeDefined()
    expect(mocks.applyTagOperation).not.toHaveBeenCalled()
  })

  it('does not let a late Preview response overwrite a newer operation', async () => {
    let resolveFirst: ((value: TagOperationPreview) => void) | undefined
    let resolveSecond: ((value: TagOperationPreview) => void) | undefined
    mocks.previewTagOperation
      .mockReset()
      .mockReturnValueOnce(new Promise<TagOperationPreview>((resolve) => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise<TagOperationPreview>((resolve) => { resolveSecond = resolve }))
    const secondOperation = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'Later' }
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('First')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#tag-management-destination').setValue('Later')
    await wrapper.get('form').trigger('submit')
    await settle()
    resolveSecond?.(makePreview({
      operation: secondOperation,
      requestedDestination: { displayName: 'Later', normalizedName: 'later' },
    }))
    await settle()
    resolveFirst?.(makePreview({
      requestedDestination: { displayName: 'First', normalizedName: 'first' },
    }))
    await settle()
    expect(wrapper.text()).toContain('#Later')
    expect(wrapper.text()).not.toContain('#First')
    expect(mocks.applyTagOperation).not.toHaveBeenCalled()
  })

  it('ignores a late Preview page from an obsolete generation and preserves newer loading state', async () => {
    let resolvePageA: ((value: TagOperationPreview) => void) | undefined
    let resolvePageB: ((value: TagOperationPreview) => void) | undefined
    const operationB = { kind: 'rename' as const, sourceTagId: 7, destinationName: 'Later' }
    const fingerprintA = 'a'.repeat(64)
    const fingerprintB = 'b'.repeat(64)
    mocks.previewTagOperation
      .mockReset()
      .mockResolvedValueOnce(makePreview({
        planFingerprint: fingerprintA,
        nextAfterDocumentId: 'a-cursor',
      }))
      .mockResolvedValueOnce(makePreview({
        operation: operationB,
        requestedDestination: { displayName: 'Later', normalizedName: 'later' },
        planFingerprint: fingerprintB,
        sample: [{ id: 'doc-b', path: 'inbox/b', title: 'Preview B' }],
        nextAfterDocumentId: 'b-cursor',
      }))
    mocks.getTagOperationPreviewPage
      .mockReset()
      .mockReturnValueOnce(new Promise<TagOperationPreview>((resolve) => { resolvePageA = resolve }))
      .mockReturnValueOnce(new Promise<TagOperationPreview>((resolve) => { resolvePageB = resolve }))

    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('First')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-sample .secondary').trigger('click')
    await settle()

    await wrapper.get('#tag-management-destination').setValue('Later')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('Preview B')
    await wrapper.get('.tag-management-sample .secondary').trigger('click')
    await settle()
    expect(wrapper.get('.tag-management-sample .secondary').attributes('disabled')).toBeDefined()

    resolvePageA?.(makePreview({
      planFingerprint: fingerprintA,
      sample: [{ id: 'doc-a-old', path: 'inbox/a-old', title: 'Old A page' }],
      nextAfterDocumentId: 'a-next',
    }))
    await settle()
    expect(wrapper.text()).toContain('Preview B')
    expect(wrapper.text()).not.toContain('Old A page')
    expect(wrapper.get('.tag-management-sample .secondary').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('Tags changed after this Preview')

    resolvePageB?.(makePreview({
      operation: operationB,
      requestedDestination: { displayName: 'Later', normalizedName: 'later' },
      planFingerprint: fingerprintB,
      sample: [{ id: 'doc-b-page', path: 'inbox/b-page', title: 'New B page' }],
      nextAfterDocumentId: null,
    }))
    await settle()
    expect(wrapper.text()).toContain('New B page')
    expect(wrapper.find('.tag-management-sample .secondary').exists()).toBe(false)
    expect(wrapper.get('[role="dialog"]').attributes('data-state')).toBe('preview-ready')
  })

  it('invalidates the reviewed Preview as soon as an operation field changes', async () => {
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.findAll('[data-state="preview-ready"]').length).toBe(1)
    await wrapper.get('#tag-management-destination').setValue('New name')
    await settle()
    expect(wrapper.findAll('.tag-management-preview').length).toBe(0)
    expect(wrapper.findAll('[data-state="editing"]').length).toBe(1)
    expect(mocks.applyTagOperation).not.toHaveBeenCalled()
  })

  it('requires an explicit fresh Preview after a stale Apply and never retries automatically', async () => {
    mocks.applyTagOperation.mockRejectedValueOnce(new mocks.TagManagementApiError('stale', 409, 'PREVIEW_STALE'))
    const refreshPosts = vi.fn()
    const wrapper = mountTracked({ refreshPosts })
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Tags changed after this Preview')
    expect(wrapper.get('.tag-management-live').text()).toContain('Tags changed after this Preview')
    expect(wrapper.findAll('.tag-management-preview').length).toBe(0)
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    expect(refreshPosts).not.toHaveBeenCalled()
  })

  it('uses the originating fingerprint for pagination and invalidates pages on stale continuation', async () => {
    mocks.previewTagOperation.mockResolvedValueOnce(makePreview({
      nextAfterDocumentId: 'doc-1',
    }))
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-sample .secondary').trigger('click')
    await settle()
    expect(mocks.getTagOperationPreviewPage).toHaveBeenCalledWith(operation, 'a'.repeat(64), 'doc-1', 100)
    expect(wrapper.text()).toContain('Two')

    mocks.getTagOperationPreviewPage.mockRejectedValueOnce(new mocks.TagManagementApiError('stale', 409, 'PREVIEW_STALE'))
    mocks.previewTagOperation.mockResolvedValueOnce(makePreview({ nextAfterDocumentId: 'doc-1' }))
    await wrapper.get('.tag-management-sample .secondary').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Tags changed after this Preview')
    expect(wrapper.findAll('.tag-management-preview').length).toBe(0)
  })

  it('enters sync-pending after commit when refresh fails and retries sync without Apply', async () => {
    const refreshPosts = vi.fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(undefined)
    const wrapper = mountTracked({ refreshPosts })
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(wrapper.findAll('[data-state="sync-pending"]').length).toBe(1)
    expect(wrapper.text()).toContain('operation succeeded')
    expect(wrapper.get('.tag-management-live').text()).toContain('operation succeeded')
    await wrapper.get('.tag-management-backdrop').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    await wrapper.get('.tag-management-state-error .primary').trigger('click')
    await settle()
    expect(refreshPosts).toHaveBeenCalledTimes(2)
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[data-state="success"]').length).toBe(1)
  })

  it('preserves a newer user selection when Apply resolves', async () => {
    let resolveApply: ((value: TagOperationApplyResult) => void) | undefined
    let reconciledSelection = 'Java'
    mocks.applyTagOperation.mockReturnValueOnce(new Promise<TagOperationApplyResult>((resolve) => { resolveApply = resolve }))
    const refreshPosts = vi.fn().mockResolvedValue(undefined)
    const syncAfterCommit = vi.fn(async (_result: TagOperationApplyResult, _snapshot: TagSelectionSnapshot) => ({
      managedTags: RENAMED_TAGS,
      selectedTag: reconciledSelection,
    }))
    const wrapper = mountTracked({ selectedTag: 'Java', selectionEpoch: 12, refreshPosts, syncAfterCommit })
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    await wrapper.setProps({ selectedTag: 'Python', selectionEpoch: 13 })
    reconciledSelection = 'Python'
    resolveApply?.(makeResult())
    await settle()
    expect(syncAfterCommit).toHaveBeenCalledTimes(1)
    expect(syncAfterCommit.mock.calls[0]?.[1]).toMatchObject({ selectedTag: 'Java', selectionEpoch: 12 })
    expect(wrapper.get('.tag-management-state-success').attributes('data-selected-tag')).toBe('Python')
  })

  it('focuses invalid controls and blocks Escape while Apply is pending', async () => {
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(document.activeElement).toBe(wrapper.get('#tag-management-source').element)
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(document.activeElement).toBe(wrapper.get('#tag-management-destination').element)

    let resolveApply: ((value: TagOperationApplyResult) => void) | undefined
    mocks.applyTagOperation.mockReturnValueOnce(new Promise<TagOperationApplyResult>((resolve) => { resolveApply = resolve }))
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    await wrapper.get('.tag-management-backdrop').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toBeUndefined()
    resolveApply?.(makeResult())
  })

  it('focuses the source on open, wraps Tab in both directions, closes on Escape, and returns focus', async () => {
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.textContent = 'Open manager'
    document.body.append(trigger)
    trigger.focus()
    const offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
    try {
      const wrapper = mountTracked()
      await settle()
      expect(document.activeElement).toBe(wrapper.get('#tag-management-source').element)
      await wrapper.get('#tag-management-source').setValue('7')
      await wrapper.get('#tag-management-destination').setValue('Backend')
      await settle()

      const focusables = wrapper.findAll('button, input, select')
      const first = focusables[0]!.element as HTMLElement
      const last = focusables.at(-1)!.element as HTMLElement
      last.focus()
      await wrapper.get('.tag-management-backdrop').trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(first)
      first.focus()
      await wrapper.get('.tag-management-backdrop').trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)

      await wrapper.get('.tag-management-backdrop').trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('close')).toEqual([[]])
      await wrapper.setProps({ open: false })
      await settle()
      expect(document.activeElement).toBe(trigger)
    } finally {
      offsetParent.mockRestore()
      trigger.remove()
    }
  })

  it('keeps critical management copy available in both supported locales', async () => {
    useI18n().setLocale('zh')
    const wrapper = mountTracked()
    await settle()
    expect(wrapper.text()).toContain('管理标签')
    expect(wrapper.text()).toContain('重命名')
    expect(useI18n().t('tags.manage.conflict_destination_exists')).toContain('合并标签')
    useI18n().setLocale('en')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Manage tags')
    expect(wrapper.text()).toContain('Rename')
    expect(useI18n().t('tags.manage.conflict_destination_exists')).toContain('Use Merge instead')
  })
})
