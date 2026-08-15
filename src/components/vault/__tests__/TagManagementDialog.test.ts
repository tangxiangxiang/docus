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

const mocks = vi.hoisted(() => ({
  listManagedTags: vi.fn(),
  previewTagOperation: vi.fn(),
  getTagOperationPreviewPage: vi.fn(),
  applyTagOperation: vi.fn(),
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
    tagCreates: 1,
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
    tagCreates: 1,
    tagDeletes: 0,
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
} = {}): VueWrapper {
  return mount(TagManagementDialog, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
    props: {
      open: true,
      selectedTag: options.selectedTag ?? null,
      selectionEpoch: options.selectionEpoch ?? 0,
      refreshPosts: options.refreshPosts,
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
    expect(wrapper.text()).not.toContain('Merge')
    expect(wrapper.text()).not.toContain('Remove')
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

    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    expect(mocks.applyTagOperation).toHaveBeenCalledWith(operation, 'a'.repeat(64))
    expect(refreshPosts).toHaveBeenCalledTimes(1)
    expect(mocks.listManagedTags).toHaveBeenCalledTimes(2)
    expect(events).toEqual(['posts-refresh', 'tag-list-refresh'])
    expect(wrapper.text()).toContain('The tag operation was committed')
    expect(wrapper.text()).toContain('Final display name: Backend')
    expect(wrapper.emitted('selection-reconciled')).toEqual([['Backend']])
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
    expect(wrapper.text()).toContain('Associations added')
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
    expect(wrapper.text()).not.toContain('Merge')
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
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    await wrapper.get('.tag-management-state-error .primary').trigger('click')
    await settle()
    expect(refreshPosts).toHaveBeenCalledTimes(2)
    expect(mocks.applyTagOperation).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[data-state="success"]').length).toBe(1)
  })

  it('preserves a newer user selection when Apply resolves', async () => {
    let resolveApply: ((value: TagOperationApplyResult) => void) | undefined
    mocks.applyTagOperation.mockReturnValueOnce(new Promise<TagOperationApplyResult>((resolve) => { resolveApply = resolve }))
    const refreshPosts = vi.fn().mockResolvedValue(undefined)
    const wrapper = mountTracked({ selectedTag: 'Java', selectionEpoch: 12, refreshPosts })
    await settle()
    await wrapper.get('#tag-management-source').setValue('7')
    await wrapper.get('#tag-management-destination').setValue('Backend')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.tag-management-preview .primary').trigger('click')
    await settle()
    await wrapper.setProps({ selectedTag: 'Python', selectionEpoch: 13 })
    resolveApply?.(makeResult())
    await settle()
    expect(wrapper.emitted('selection-reconciled')).toEqual([['Python']])
  })

  it('focuses invalid controls and blocks Escape while Apply is pending', async () => {
    const wrapper = mountTracked()
    await settle()
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(document.activeElement).toBe(wrapper.get('#tag-management-source').element)

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

  it('keeps critical management copy available in both supported locales', async () => {
    useI18n().setLocale('zh')
    const wrapper = mountTracked()
    await settle()
    expect(wrapper.text()).toContain('管理标签')
    expect(wrapper.text()).toContain('重命名')
    useI18n().setLocale('en')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Manage tags')
    expect(wrapper.text()).toContain('Rename')
  })
})
