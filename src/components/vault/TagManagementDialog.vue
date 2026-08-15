<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useFocusTrap } from '../../composables/useFocusTrap'
import { useI18n } from '../../composables/useI18n'
import {
  applyTagOperation,
  assertApplyResultMatchesReviewedPreview,
  getTagOperationPreviewPage,
  listManagedTags,
  previewTagOperation,
  TagManagementApiError,
  type ManagedTag,
  type PreviewDocument,
  type TagManagementClientErrorCode,
  type TagOperationApplyResult,
  type TagOperationKind,
  type TagOperationPreview,
  type TagOperationRequest,
} from '../../lib/tag-management-api'
import {
  captureTagSelection,
  resolveManagedTagId,
  type TagSelectionSnapshot,
} from '../../lib/tag-selection-reconciliation'

type ManagerState =
  | 'loading'
  | 'ready'
  | 'editing'
  | 'previewing'
  | 'preview-ready'
  | 'applying'
  | 'syncing'
  | 'success'
  | 'sync-pending'
  | 'unavailable'
  | 'error'

type VisibleOperationKind = Exclude<TagOperationKind, 'remove'>

interface TagManagementDialogProps {
  open: boolean
  selectedTag?: string | null
  selectionEpoch?: number
  /** The VaultView-owned canonical refresh and stable-ID reconciliation seam. */
  syncAfterCommit: (
    result: TagOperationApplyResult,
    snapshot: TagSelectionSnapshot,
  ) => Promise<{
    managedTags: ManagedTag[]
    selectedTag: string | null
  }>
}

const props = withDefaults(defineProps<TagManagementDialogProps>(), {
  selectedTag: null,
  selectionEpoch: 0,
})

const emit = defineEmits<{
  close: []
  success: [result: TagOperationApplyResult]
}>()

const { t } = useI18n()
const trap = useFocusTrap()
const modalRef = ref<HTMLElement | null>(null)
const sourceSelectRef = ref<HTMLSelectElement | null>(null)
const destinationInputRef = ref<HTMLInputElement | null>(null)
const destinationSelectRef = ref<HTMLSelectElement | null>(null)
const previewHeadingRef = ref<HTMLElement | null>(null)

const state = ref<ManagerState>('loading')
const managedTags = ref<ManagedTag[]>([])
const operationKind = ref<VisibleOperationKind>('rename')
const sourceTagId = ref<number | null>(null)
const destinationName = ref('')
const tagSearch = ref('')
const destinationSearch = ref('')
const destinationTagId = ref<number | null>(null)
const preview = ref<TagOperationPreview | null>(null)
const reviewedOperation = ref<TagOperationRequest | null>(null)
const continuationPages = ref<PreviewDocument[][]>([])
const nextAfterDocumentId = ref<string | null>(null)
const pageLoading = ref(false)
const applyResult = ref<TagOperationApplyResult | null>(null)
const finalTags = ref<ManagedTag[]>([])
const destinationError = ref('')
const sourceError = ref('')
const errorMessage = ref('')
const staleMessage = ref('')
const liveMessage = ref('')
const diagnosticStage = ref('loading')
const diagnosticCode = ref<TagManagementClientErrorCode | null>(null)
const selectionSnapshot = ref<TagSelectionSnapshot | null>(null)
const reconciledSelectedTag = ref<string | null>(null)

let loadRun = 0
let previewRun = 0
let syncRun = 0
let pageRun = 0
let operationRevision = 0

const filteredManagedTags = computed(() => {
  const needle = tagSearch.value.trim().toLocaleLowerCase()
  const filtered = needle
    ? managedTags.value.filter((tag) => (
        tag.displayName.toLocaleLowerCase().includes(needle)
        || tag.normalizedName.includes(needle)
      ))
    : managedTags.value
  if (sourceTagId.value !== null && !filtered.some((tag) => tag.id === sourceTagId.value)) {
    const selected = managedTags.value.find((tag) => tag.id === sourceTagId.value)
    return selected ? [selected, ...filtered] : filtered
  }
  return filtered
})

const filteredDestinationTags = computed(() => {
  const needle = destinationSearch.value.trim().toLocaleLowerCase()
  const filtered = managedTags.value.filter((tag) => (
    tag.id !== sourceTagId.value
    && (!needle
      || tag.displayName.toLocaleLowerCase().includes(needle)
      || tag.normalizedName.includes(needle))
  ))
  if (destinationTagId.value !== null && !filtered.some((tag) => tag.id === destinationTagId.value)) {
    const selected = managedTags.value.find((tag) => (
      tag.id === destinationTagId.value && tag.id !== sourceTagId.value
    ))
    return selected ? [selected, ...filtered] : filtered
  }
  return filtered
})

const selectedDestinationTag = computed(() => (
  destinationTagId.value === null
    ? null
    : managedTags.value.find((tag) => tag.id === destinationTagId.value) ?? null
))

const selectedSourceTag = computed(() => (
  sourceTagId.value === null
    ? null
    : managedTags.value.find((tag) => tag.id === sourceTagId.value) ?? null
))

const renderedSample = computed(() => {
  const seen = new Set<string>()
  const result: PreviewDocument[] = []
  for (const document of continuationPages.value.flat()) {
    if (seen.has(document.id)) continue
    seen.add(document.id)
    result.push(document)
  }
  return result
})

const finalDisplayName = computed(() => {
  const result = applyResult.value
  if (!result) return null
  if (result.survivorTagId !== null) {
    const fresh = finalTags.value.find((tag) => tag.id === result.survivorTagId)
    if (fresh) return fresh.displayName
  }
  return result.survivorDisplayName ?? result.sourceDisplayName
})

const diagnosticLabel = computed(() => {
  const labels: Record<string, string> = {
    loading: t('tags.manage.diagnostic_loading'),
    ready: t('tags.manage.diagnostic_ready'),
    unavailable: t('tags.manage.diagnostic_unavailable'),
    'load-failure': t('tags.manage.diagnostic_load_failure'),
    'preview-loading': t('tags.manage.diagnostic_preview_loading'),
    'preview-page-loading': t('tags.manage.diagnostic_preview_page_loading'),
    'preview-ready': t('tags.manage.diagnostic_preview_ready'),
    'preview-failure': t('tags.manage.diagnostic_preview_failure'),
    'preview-stale': t('tags.manage.diagnostic_preview_stale'),
    applying: t('tags.manage.diagnostic_applying'),
    syncing: t('tags.manage.diagnostic_syncing'),
    success: t('tags.manage.diagnostic_success'),
    'apply-failure': t('tags.manage.diagnostic_apply_failure'),
    'sync-pending': t('tags.manage.diagnostic_sync_pending'),
  }
  return labels[diagnosticStage.value] ?? diagnosticStage.value
})

const canEdit = computed(() => ![
  'loading', 'previewing', 'applying', 'syncing', 'sync-pending', 'unavailable',
].includes(state.value))

const hasValidMergeDestination = computed(() => (
  operationKind.value === 'merge'
  && selectedSourceTag.value !== null
  && destinationTagId.value !== null
  && sourceTagId.value !== destinationTagId.value
  && managedTags.value.some((tag) => tag.id === destinationTagId.value)
))

const canPreview = computed(() => (
  canEdit.value
  && selectedSourceTag.value !== null
  && (operationKind.value === 'merge'
    ? hasValidMergeDestination.value
    : destinationName.value.trim().length > 0)
))

const canApply = computed(() => (
  state.value === 'preview-ready'
  && preview.value !== null
  && reviewedOperation.value !== null
  && operationsEqual(preview.value.operation, reviewedOperation.value)
  && (() => {
    const current = operationFromForm()
    return current !== null && operationsEqual(current, reviewedOperation.value)
  })()
  && preview.value.allowedToApply
  && preview.value.planFingerprint.length === 64
  && !pageLoading.value
))

const canDismiss = computed(() => ![
  'loading', 'previewing', 'applying', 'syncing', 'sync-pending',
].includes(state.value))

function setDiagnostic(stage: string, code: TagManagementClientErrorCode | null = null): void {
  diagnosticStage.value = stage
  diagnosticCode.value = code
}

function announce(message: string): void {
  liveMessage.value = message
}

function clearPreview(): void {
  // A new Preview, an input edit, a reset, and close all invalidate every
  // outstanding continuation request. The page generation is independent of
  // the normal Preview run so an old page's finally block cannot touch a
  // newer page's loading state.
  pageRun += 1
  preview.value = null
  reviewedOperation.value = null
  continuationPages.value = []
  nextAfterDocumentId.value = null
  pageLoading.value = false
}

function operationsEqual(left: TagOperationRequest, right: TagOperationRequest): boolean {
  if (left.kind !== right.kind || left.sourceTagId !== right.sourceTagId) return false
  if (left.kind === 'rename' && right.kind === 'rename') return left.destinationName === right.destinationName
  if (left.kind === 'merge' && right.kind === 'merge') return left.destinationTagId === right.destinationTagId
  return false
}

function invalidatePreview(nextState: ManagerState = 'editing'): void {
  previewRun += 1
  clearPreview()
  if (state.value !== 'applying' && state.value !== 'syncing' && state.value !== 'sync-pending') {
    state.value = nextState
  }
}

function focusDestination(): void {
  void nextTick(() => {
    if (operationKind.value === 'merge') destinationSelectRef.value?.focus()
    else destinationInputRef.value?.focus()
  })
}

function validateForm(): boolean {
  sourceError.value = ''
  destinationError.value = ''
  errorMessage.value = ''
  if (selectedSourceTag.value === null) {
    sourceError.value = t('tags.manage.source_required')
    void nextTick(() => sourceSelectRef.value?.focus())
    return false
  }
  if (operationKind.value === 'merge') {
    if (!hasValidMergeDestination.value) {
      destinationError.value = sourceTagId.value === destinationTagId.value
        ? t('tags.manage.merge_same_tag')
        : t('tags.manage.destination_required_merge')
      focusDestination()
      return false
    }
    return true
  }
  const value = destinationName.value
  if (!value.trim()) {
    destinationError.value = t('tags.manage.destination_required')
    focusDestination()
    return false
  }
  if (value.length > 100) {
    destinationError.value = t('tags.manage.destination_too_long')
    focusDestination()
    return false
  }
  return true
}

function operationFromForm(): TagOperationRequest | null {
  const source = sourceTagId.value
  if (source === null || selectedSourceTag.value === null) return null
  if (operationKind.value === 'merge') {
    const destination = destinationTagId.value
    if (!hasValidMergeDestination.value || destination === null) return null
    return {
      kind: 'merge',
      sourceTagId: source,
      destinationTagId: destination,
    }
  }
  return {
    kind: 'rename',
    sourceTagId: source,
    destinationName: destinationName.value,
  }
}

function isHealthBlocked(code: TagManagementClientErrorCode): boolean {
  return code === 'TAG_MANAGEMENT_UNAVAILABLE' || code === 'TAG_IDENTITY_CONFLICT'
}

function mapError(error: unknown, stage: 'preview' | 'apply' | 'load'): string {
  const code = error instanceof TagManagementApiError ? error.code : 'CLIENT_PROTOCOL_ERROR'
  diagnosticCode.value = code
  if (code === 'TAG_MANAGEMENT_UNAVAILABLE') return t('tags.manage.error_unavailable')
  if (code === 'TAG_IDENTITY_CONFLICT') return t('tags.manage.error_identity_conflict')
  if (code === 'TAG_NOT_FOUND') return t('tags.manage.error_not_found')
  if (code === 'DESTINATION_EXISTS') {
    return operationKind.value === 'merge'
      ? t('tags.manage.conflict_generic')
      : t('tags.manage.conflict_destination_exists')
  }
  if (code === 'INVALID_OPERATION' || code === 'SOURCE_DESTINATION_SAME') {
    return stage === 'preview' ? t('tags.manage.conflict_generic') : t('tags.manage.error_generic')
  }
  if (code === 'INVALID_TAG_NAME') return t('tags.manage.destination_invalid')
  if (code === 'PREVIEW_STALE' || code === 'PREVIEW_REQUIRED') return t('tags.manage.preview_stale')
  if (code === 'TRANSACTION_FAILED') return t('tags.manage.error_transaction')
  if (stage === 'load') return t('tags.manage.error_unavailable')
  return stage === 'preview' ? t('tags.manage.preview_failed') : t('tags.manage.error_generic')
}

function selectInitialSource(tags: ManagedTag[]): void {
  const fromSelected = resolveManagedTagId(props.selectedTag, tags)
  if (fromSelected !== null) {
    sourceTagId.value = fromSelected
    return
  }
  if (sourceTagId.value !== null && tags.some((tag) => tag.id === sourceTagId.value)) return
  sourceTagId.value = null
}

function reconcileDestinationWithTags(tags: ManagedTag[]): void {
  if (destinationTagId.value === null) return
  if (!tags.some((tag) => tag.id === destinationTagId.value && tag.id !== sourceTagId.value)) {
    destinationTagId.value = null
    destinationError.value = ''
  }
}

async function fetchManagedTagsForOpening(): Promise<void> {
  const run = ++loadRun
  state.value = 'loading'
  setDiagnostic('loading')
  errorMessage.value = ''
  staleMessage.value = ''
  announce(t('tags.manage.loading'))
  try {
    const tags = await listManagedTags()
    if (run !== loadRun || !props.open) return
    managedTags.value = tags
    finalTags.value = tags
    selectInitialSource(tags)
    reconcileDestinationWithTags(tags)
    state.value = 'ready'
    setDiagnostic('ready')
    announce(t('tags.manage.preview_required'))
    await nextTick()
    sourceSelectRef.value?.focus()
  } catch (error) {
    if (run !== loadRun || !props.open) return
    const code = error instanceof TagManagementApiError ? error.code : 'CLIENT_PROTOCOL_ERROR'
    state.value = isHealthBlocked(code) ? 'unavailable' : 'error'
    setDiagnostic(isHealthBlocked(code) ? 'unavailable' : 'load-failure', code)
    errorMessage.value = mapError(error, 'load')
    announce(errorMessage.value)
    await nextTick()
    modalRef.value?.querySelector<HTMLButtonElement>('[data-action="reload"]')?.focus()
  }
}

/** Recover a missing stable source without reusing a stale Preview. */
async function refreshManagedTagsAfterTagNotFound(): Promise<void> {
  const run = ++loadRun
  ++previewRun
  clearPreview()
  state.value = 'loading'
  setDiagnostic('loading', 'TAG_NOT_FOUND')
  staleMessage.value = ''
  errorMessage.value = t('tags.manage.error_not_found')
  announce(errorMessage.value)
  try {
    const tags = await listManagedTags()
    if (run !== loadRun || !props.open) return
    managedTags.value = tags
    finalTags.value = tags
    if (sourceTagId.value !== null && !tags.some((tag) => tag.id === sourceTagId.value)) {
      sourceTagId.value = null
      sourceError.value = ''
    }
    reconcileDestinationWithTags(tags)
    state.value = 'editing'
    setDiagnostic('ready', 'TAG_NOT_FOUND')
    errorMessage.value = t('tags.manage.error_not_found')
    announce(errorMessage.value)
    await nextTick()
    if (sourceTagId.value === null) sourceSelectRef.value?.focus()
  } catch (error) {
    if (run !== loadRun || !props.open) return
    const code = error instanceof TagManagementApiError ? error.code : 'CLIENT_PROTOCOL_ERROR'
    state.value = isHealthBlocked(code) ? 'unavailable' : 'error'
    setDiagnostic(isHealthBlocked(code) ? 'unavailable' : 'load-failure', code)
    errorMessage.value = mapError(error, 'load')
    announce(errorMessage.value)
    await nextTick()
    modalRef.value?.querySelector<HTMLButtonElement>('[data-action="reload"]')?.focus()
  }
}

function resetForOpen(): void {
  state.value = 'loading'
  ++previewRun
  ++syncRun
  clearPreview()
  managedTags.value = []
  finalTags.value = []
  operationKind.value = 'rename'
  sourceTagId.value = null
  destinationName.value = ''
  tagSearch.value = ''
  destinationSearch.value = ''
  destinationTagId.value = null
  applyResult.value = null
  selectionSnapshot.value = null
  sourceError.value = ''
  destinationError.value = ''
  errorMessage.value = ''
  staleMessage.value = ''
  reconciledSelectedTag.value = null
}

async function onPreview(): Promise<void> {
  if (!validateForm()) return
  const operation = operationFromForm()
  if (!operation || state.value === 'unavailable') return
  const run = ++previewRun
  const revision = operationRevision
  clearPreview()
  applyResult.value = null
  errorMessage.value = ''
  staleMessage.value = ''
  state.value = 'previewing'
  setDiagnostic('preview-loading')
  announce(t('tags.manage.previewing'))
  try {
    const result = await previewTagOperation(operation)
    if (run !== previewRun || revision !== operationRevision || !props.open) return
    preview.value = result
    reviewedOperation.value = result.operation
    continuationPages.value = [result.sample]
    nextAfterDocumentId.value = result.nextAfterDocumentId
    state.value = 'preview-ready'
    setDiagnostic('preview-ready')
    announce(t('tags.manage.preview_ready', { count: result.affectedCount }))
    await nextTick()
    previewHeadingRef.value?.focus()
  } catch (error) {
    if (run !== previewRun || revision !== operationRevision || !props.open) return
    const code = error instanceof TagManagementApiError ? error.code : 'CLIENT_PROTOCOL_ERROR'
    if (code === 'TAG_NOT_FOUND') {
      await refreshManagedTagsAfterTagNotFound()
      return
    }
    errorMessage.value = mapError(error, 'preview')
    setDiagnostic(code === 'PREVIEW_STALE' ? 'preview-stale' : 'preview-failure', code)
    if (code === 'PREVIEW_STALE') {
      staleMessage.value = t('tags.manage.preview_stale')
      invalidatePreview('editing')
    } else if (isHealthBlocked(code)) {
      clearPreview()
      state.value = 'unavailable'
      setDiagnostic('unavailable', code)
    } else {
      state.value = 'error'
    }
    if (code === 'INVALID_TAG_NAME') focusDestination()
    announce(errorMessage.value)
  }
}

async function loadMore(): Promise<void> {
  if (!preview.value || !reviewedOperation.value || !nextAfterDocumentId.value || pageLoading.value) return
  const fingerprint = preview.value.planFingerprint
  const cursor = nextAfterDocumentId.value
  const operation = reviewedOperation.value
  const previewGeneration = previewRun
  const run = ++pageRun
  pageLoading.value = true
  setDiagnostic('preview-page-loading')
  try {
    const page = await getTagOperationPreviewPage(operation, fingerprint, cursor, 100)
    if (
      run !== pageRun
      || previewGeneration !== previewRun
      || !props.open
      || !preview.value
      || preview.value.planFingerprint !== fingerprint
      || reviewedOperation.value !== operation
      || nextAfterDocumentId.value !== cursor
    ) {
      // A page belonging to an obsolete Preview is intentionally ignored.
      // In particular, it must not turn a newer Preview into PREVIEW_STALE.
      return
    }
    if (page.planFingerprint !== fingerprint) {
      throw new TagManagementApiError(
        t('tags.manage.preview_stale'),
        409,
        'PREVIEW_STALE',
      )
    }
    continuationPages.value.push(page.sample)
    nextAfterDocumentId.value = page.nextAfterDocumentId
    setDiagnostic('preview-ready')
  } catch (error) {
    if (run !== pageRun || previewGeneration !== previewRun || !props.open) return
    const code = error instanceof TagManagementApiError ? error.code : 'CLIENT_PROTOCOL_ERROR'
    if (code === 'PREVIEW_STALE') {
      staleMessage.value = t('tags.manage.preview_stale')
      errorMessage.value = staleMessage.value
      invalidatePreview('editing')
      setDiagnostic('preview-stale', code)
    } else if (code === 'TAG_NOT_FOUND') {
      await refreshManagedTagsAfterTagNotFound()
      return
    } else if (isHealthBlocked(code)) {
      clearPreview()
      state.value = 'unavailable'
      errorMessage.value = mapError(error, 'preview')
      setDiagnostic('unavailable', code)
    } else {
      errorMessage.value = mapError(error, 'preview')
      state.value = 'error'
      setDiagnostic('preview-failure', code)
    }
    announce(errorMessage.value)
  } finally {
    if (run === pageRun) pageLoading.value = false
  }
}

async function runSynchronization(result: TagOperationApplyResult): Promise<void> {
  const run = syncRun
  state.value = 'syncing'
  setDiagnostic('syncing')
  announce(t('tags.manage.syncing'))
  try {
    const snapshot = selectionSnapshot.value
    if (!snapshot || typeof props.syncAfterCommit !== 'function') {
      // A missing ownership seam is a synchronization failure, never a
      // successful Apply. The committed result remains available for a
      // retry, but Apply is not repeated.
      state.value = 'sync-pending'
      setDiagnostic('sync-pending', 'CLIENT_PROTOCOL_ERROR')
      errorMessage.value = t('tags.manage.sync_pending')
      announce(errorMessage.value)
      return
    }
    const synchronized = await props.syncAfterCommit(result, snapshot)
    if (run !== syncRun || !props.open) return
    finalTags.value = synchronized.managedTags
    managedTags.value = synchronized.managedTags
    reconciledSelectedTag.value = synchronized.selectedTag
    state.value = 'success'
    setDiagnostic('success')
    announce(finalDisplayName.value
      ? t('tags.manage.success', { name: finalDisplayName.value })
      : t('tags.manage.success_generic'))
    emit('success', result)
  } catch (error) {
    if (run !== syncRun || !props.open) return
    const code = error instanceof TagManagementApiError ? error.code : 'CLIENT_PROTOCOL_ERROR'
    state.value = 'sync-pending'
    setDiagnostic('sync-pending', code)
    errorMessage.value = t('tags.manage.sync_pending')
    announce(errorMessage.value)
  }
}

async function onApply(): Promise<void> {
  if (!canApply.value || !preview.value || !reviewedOperation.value) return
  const currentPreview = preview.value
  const operation = reviewedOperation.value
  selectionSnapshot.value = captureTagSelection(
    props.selectedTag,
    managedTags.value,
    props.selectionEpoch,
  )
  const run = ++syncRun
  errorMessage.value = ''
  staleMessage.value = ''
  state.value = 'applying'
  setDiagnostic('applying')
  announce(t('tags.manage.applying'))
  try {
    const result = await applyTagOperation(operation, currentPreview.planFingerprint)
    if (run !== syncRun || !props.open) return
    assertApplyResultMatchesReviewedPreview(result, currentPreview)
    applyResult.value = result
    clearPreview()
    await runSynchronization(result)
  } catch (error) {
    if (run !== syncRun || !props.open) return
    const code = error instanceof TagManagementApiError ? error.code : 'CLIENT_PROTOCOL_ERROR'
    if (code === 'PREVIEW_STALE' || code === 'PREVIEW_REQUIRED') {
      staleMessage.value = t('tags.manage.preview_stale')
      errorMessage.value = staleMessage.value
      invalidatePreview('editing')
      setDiagnostic('preview-stale', code)
      announce(errorMessage.value)
      return
    }
    if (code === 'TAG_NOT_FOUND') {
      await refreshManagedTagsAfterTagNotFound()
      return
    }
    clearPreview()
    state.value = isHealthBlocked(code) ? 'unavailable' : 'error'
    errorMessage.value = mapError(error, 'apply')
    setDiagnostic(isHealthBlocked(code) ? 'unavailable' : 'apply-failure', code)
    if (code === 'INVALID_TAG_NAME') focusDestination()
    announce(errorMessage.value)
  }
}

async function retrySynchronization(): Promise<void> {
  if (!applyResult.value || state.value !== 'sync-pending') return
  ++syncRun
  await runSynchronization(applyResult.value)
}

async function reloadManagedTags(): Promise<void> {
  ++previewRun
  clearPreview()
  applyResult.value = null
  destinationTagId.value = null
  destinationError.value = ''
  await fetchManagedTagsForOpening()
}

function close(): void {
  if (!canDismiss.value) return
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'Tab') trap.onTab(() => modalRef.value, event)
}

function onBackdropClick(): void {
  close()
}

function onSourceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  sourceTagId.value = value ? Number(value) : null
  if (sourceTagId.value !== null && sourceTagId.value === destinationTagId.value) {
    destinationTagId.value = null
  }
}

function onDestinationChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  destinationTagId.value = value ? Number(value) : null
}

function setOperationKind(kind: VisibleOperationKind): void {
  if (operationKind.value === kind) return
  operationKind.value = kind
  destinationTagId.value = null
  destinationSearch.value = ''
  operationRevision += 1
  invalidatePreview('editing')
  sourceError.value = ''
  destinationError.value = ''
  announce(kind === 'merge' ? t('tags.manage.merge_selected') : t('tags.manage.rename_selected'))
}

watch([operationKind, sourceTagId, destinationTagId, destinationName], (next, previous) => {
  if (next.every((value, index) => value === previous[index])) return
  operationRevision += 1
  sourceError.value = ''
  destinationError.value = ''
  if (state.value === 'preview-ready' || state.value === 'previewing' || state.value === 'error') {
    invalidatePreview('editing')
  }
  if (state.value === 'success') state.value = 'editing'
})

watch(() => props.open, (open) => {
  if (open) {
    resetForOpen()
    trap.activate()
    void fetchManagedTagsForOpening()
    void nextTick(() => {
      const closeButton = modalRef.value?.querySelector<HTMLButtonElement>('[data-action="close"]')
      closeButton?.focus()
    })
  } else {
    ++loadRun
    ++previewRun
    ++syncRun
    clearPreview()
    void trap.deactivate()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  ++loadRun
  ++previewRun
  ++syncRun
  ++pageRun
  void trap.deactivate()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="tag-management-backdrop"
      role="presentation"
      tabindex="-1"
      @click.self="onBackdropClick"
      @keydown="onKeydown"
    >
      <section
        ref="modalRef"
        class="tag-management-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('tags.manage.title')"
        aria-labelledby="tag-management-title"
        aria-describedby="tag-management-description"
        :data-state="state"
        :data-diagnostic-stage="diagnosticStage"
        :data-diagnostic-code="diagnosticCode ?? undefined"
      >
        <header class="tag-management-header">
          <div>
            <h2 id="tag-management-title">{{ t('tags.manage.title') }}</h2>
            <p id="tag-management-description">{{ t('tags.manage.description') }}</p>
          </div>
          <button
            type="button"
            class="tag-management-close"
            data-action="close"
            :aria-label="t('tags.manage.close')"
            :title="t('tags.manage.close')"
            :disabled="!canDismiss"
            @click="close"
          >×</button>
        </header>

        <div class="tag-management-body">
          <p class="tag-management-live" role="status" aria-live="polite">{{ liveMessage }}</p>

          <div v-if="state === 'loading'" class="tag-management-state" aria-busy="true">
            {{ t('tags.manage.loading') }}
          </div>

          <div v-else-if="state === 'unavailable'" class="tag-management-state tag-management-state-error">
            <p>{{ t('tags.manage.unavailable') }}</p>
            <button type="button" data-action="reload" class="tag-management-button primary" @click="reloadManagedTags">
              {{ t('tags.manage.reload') }}
            </button>
          </div>

          <template v-else>
            <form class="tag-management-form" @submit.prevent="onPreview">
              <fieldset class="tag-management-mode" :disabled="!canEdit">
                <legend>{{ t('tags.manage.operation') }}</legend>
                <div class="tag-management-mode-buttons" role="group" :aria-label="t('tags.manage.operation')">
                  <button
                    type="button"
                    class="tag-management-mode-button"
                    data-operation="rename"
                    :aria-pressed="operationKind === 'rename'"
                    @click="setOperationKind('rename')"
                  >{{ t('tags.manage.rename') }}</button>
                  <button
                    type="button"
                    class="tag-management-mode-button"
                    data-operation="merge"
                    :aria-pressed="operationKind === 'merge'"
                    @click="setOperationKind('merge')"
                  >{{ t('tags.manage.merge') }}</button>
                </div>
              </fieldset>

              <div class="tag-management-field">
                <label for="tag-management-search">{{ t('tags.manage.search') }}</label>
                <input
                  id="tag-management-search"
                  v-model="tagSearch"
                  type="search"
                  class="tag-management-input"
                  :placeholder="t('tags.manage.search')"
                  :disabled="!canEdit"
                />
              </div>

              <div class="tag-management-field">
                <label for="tag-management-source">{{ t('tags.manage.source') }}</label>
                <select
                  id="tag-management-source"
                  ref="sourceSelectRef"
                  class="tag-management-input"
                  :value="sourceTagId ?? ''"
                  :disabled="!canEdit || managedTags.length === 0"
                  :aria-invalid="sourceError ? 'true' : undefined"
                  :aria-describedby="sourceError ? 'tag-management-source-error' : undefined"
                  @change="onSourceChange"
                >
                  <option value="">{{ t('tags.manage.source_placeholder') }}</option>
                  <option v-for="tag in filteredManagedTags" :key="tag.id" :value="tag.id">
                    #{{ tag.displayName }} · {{ tag.documentCount }}
                  </option>
                </select>
                <p v-if="sourceError" id="tag-management-source-error" class="tag-management-error" role="alert">{{ sourceError }}</p>
              </div>

              <template v-if="operationKind === 'merge'">
                <div class="tag-management-field">
                  <label for="tag-management-destination-search">{{ t('tags.manage.destination_search') }}</label>
                  <input
                    id="tag-management-destination-search"
                    v-model="destinationSearch"
                    type="search"
                    class="tag-management-input"
                    :placeholder="t('tags.manage.destination_search_placeholder')"
                    :disabled="!canEdit"
                    @input="destinationError = ''"
                  />
                </div>

                <div class="tag-management-field">
                  <label for="tag-management-destination">{{ t('tags.manage.destination_tag') }}</label>
                  <select
                    id="tag-management-destination"
                    ref="destinationSelectRef"
                    class="tag-management-input"
                    :value="destinationTagId ?? ''"
                    :disabled="!canEdit || managedTags.length === 0"
                    :aria-invalid="destinationError ? 'true' : undefined"
                    :aria-describedby="destinationError ? 'tag-management-destination-error tag-management-destination-help' : 'tag-management-destination-help'"
                    @change="onDestinationChange"
                  >
                    <option value="">{{ t('tags.manage.destination_placeholder') }}</option>
                    <option v-for="tag in filteredDestinationTags" :key="tag.id" :value="tag.id">
                      #{{ tag.displayName }} · {{ tag.documentCount }}
                    </option>
                  </select>
                  <p id="tag-management-destination-help" class="tag-management-help">{{ t('tags.manage.destination_help_merge') }}</p>
                  <p v-if="selectedDestinationTag" class="tag-management-selected" data-selected-destination>
                    {{ t('tags.manage.destination_selected', { name: selectedDestinationTag.displayName }) }}
                  </p>
                  <p v-if="destinationSearch.trim() && filteredDestinationTags.length === 0" class="tag-management-help">
                    {{ t('tags.manage.destination_no_matches') }}
                  </p>
                  <p v-if="destinationError" id="tag-management-destination-error" class="tag-management-error" role="alert">{{ destinationError }}</p>
                </div>
              </template>

              <div v-else class="tag-management-field">
                <label for="tag-management-destination">{{ t('tags.manage.destination') }}</label>
                <input
                  id="tag-management-destination"
                  ref="destinationInputRef"
                  v-model="destinationName"
                  type="text"
                  class="tag-management-input"
                  :disabled="!canEdit"
                  :aria-invalid="destinationError ? 'true' : undefined"
                  :aria-describedby="destinationError ? 'tag-management-destination-error tag-management-destination-help' : 'tag-management-destination-help'"
                />
                <p id="tag-management-destination-help" class="tag-management-help">{{ t('tags.manage.destination_help') }}</p>
                <p v-if="destinationError" id="tag-management-destination-error" class="tag-management-error" role="alert">{{ destinationError }}</p>
              </div>

              <div class="tag-management-actions">
                <button type="submit" class="tag-management-button primary" :disabled="!canPreview">
                  {{ state === 'previewing' ? t('tags.manage.previewing') : t('tags.manage.preview') }}
                </button>
              </div>
            </form>

            <p v-if="state === 'error' || errorMessage" class="tag-management-error tag-management-banner" role="alert">{{ errorMessage }}</p>
            <p v-if="staleMessage" class="tag-management-error tag-management-banner" role="alert">{{ staleMessage }}</p>

            <section v-if="preview" class="tag-management-preview" aria-live="polite" :aria-busy="state === 'previewing'">
              <h3 ref="previewHeadingRef" tabindex="-1">{{ t('tags.manage.preview_ready', { count: preview.affectedCount }) }}</h3>
              <dl class="tag-management-summary">
                <div><dt>{{ t('tags.manage.preview_operation') }}</dt><dd>{{ preview.operation.kind === 'merge' ? t('tags.manage.merge') : t('tags.manage.rename') }}</dd></div>
                <div><dt>{{ t('tags.manage.source') }}</dt><dd>#{{ preview.sourceTag.displayName }}</dd></div>
                <div><dt>{{ preview.operation.kind === 'merge' ? t('tags.manage.destination_tag') : t('tags.manage.requested_destination') }}</dt><dd>#{{ preview.operation.kind === 'merge' ? preview.destinationTag?.displayName : (preview.requestedDestination?.displayName ?? destinationName) }}</dd></div>
                <div><dt>{{ t('tags.manage.affected_documents') }}</dt><dd>{{ preview.affectedCount }}</dd></div>
                <div><dt>{{ t('tags.manage.association_adds') }}</dt><dd>{{ preview.associationAdds }}</dd></div>
                <div><dt>{{ t('tags.manage.association_removes') }}</dt><dd>{{ preview.associationRemoves }}</dd></div>
                <div><dt>{{ t('tags.manage.duplicate_collapses') }}</dt><dd>{{ preview.duplicateCollapses }}</dd></div>
                <div><dt>{{ t('tags.manage.tag_creates') }}</dt><dd>{{ preview.tagCreates }}</dd></div>
                <div><dt>{{ t('tags.manage.tag_deletes') }}</dt><dd>{{ preview.tagDeletes }}</dd></div>
              </dl>

              <div v-if="preview.displayOnly" class="tag-management-display-only">
                <strong>{{ t('tags.manage.display_rename') }}</strong>
                <span>{{ t('tags.manage.display_rename_detail') }}</span>
              </div>

              <div v-if="preview.operation.kind === 'merge'" class="tag-management-merge-guidance">
                <strong>{{ t('tags.manage.merge_destination_survives') }}</strong>
                <span>{{ t('tags.manage.merge_destination_survives_detail', { destination: preview.destinationTag?.displayName ?? '', source: preview.sourceTag.displayName }) }}</span>
                <span>{{ t('tags.manage.merge_source_deletion', { source: preview.sourceTag.displayName, destination: preview.destinationTag?.displayName ?? '' }) }}</span>
                <span>{{ t('tags.manage.merge_overlap_detail') }}</span>
              </div>

              <div v-if="preview.conflictCode" class="tag-management-conflict" role="alert">
                {{ preview.operation.kind === 'merge'
                  ? preview.conflictCode === 'SOURCE_DESTINATION_SAME'
                    ? t('tags.manage.merge_same_tag')
                    : t('tags.manage.conflict_generic')
                  : preview.conflictCode === 'DESTINATION_EXISTS'
                  ? t('tags.manage.conflict_destination_exists')
                  : preview.conflictCode === 'INVALID_OPERATION'
                    ? t('tags.manage.conflict_noop')
                    : t('tags.manage.conflict_generic') }}
              </div>

              <div v-if="preview.warnings.length" class="tag-management-warnings">
                <h4>{{ t('tags.manage.warnings') }}</h4>
                <ul>
                  <li v-for="warning in preview.warnings" :key="warning">
                    {{ warning === 'HIGH_IMPACT' ? t('tags.manage.warning_high_impact') : t('tags.manage.warning_destructive') }}
                  </li>
                </ul>
              </div>

              <div class="tag-management-sample">
                <h4>{{ t('tags.manage.sample') }}</h4>
                <ul v-if="renderedSample.length">
                  <li v-for="document in renderedSample" :key="document.id">
                    <strong>{{ document.title || document.path }}</strong>
                    <span>{{ document.path }}</span>
                  </li>
                </ul>
                <p v-else>{{ t('tags.manage.sample_empty') }}</p>
                <button
                  v-if="nextAfterDocumentId"
                  type="button"
                  class="tag-management-button secondary"
                  :disabled="pageLoading"
                  @click="loadMore"
                >
                  {{ pageLoading ? t('tags.manage.loading_more') : t('tags.manage.load_more') }}
                </button>
              </div>

              <div class="tag-management-actions">
                <button type="button" class="tag-management-button primary" :disabled="!canApply" @click="onApply">
                  {{ state === 'applying' ? t('tags.manage.applying') : (operationKind === 'merge' ? t('tags.manage.apply_merge') : t('tags.manage.apply')) }}
                </button>
              </div>
            </section>

            <section v-if="state === 'syncing'" class="tag-management-state" aria-busy="true">
              {{ t('tags.manage.syncing') }}
            </section>

            <section v-if="state === 'sync-pending'" class="tag-management-state tag-management-state-error" role="alert">
              <p>{{ t('tags.manage.sync_pending') }}</p>
              <button type="button" class="tag-management-button primary" @click="retrySynchronization">
                {{ t('tags.manage.retry_sync') }}
              </button>
            </section>

            <section
              v-if="state === 'success'"
              class="tag-management-state tag-management-state-success"
              role="status"
              :data-selected-tag="reconciledSelectedTag ?? undefined"
            >
              <p>{{ t('tags.manage.committed') }}</p>
              <p>{{ finalDisplayName
                ? (applyResult?.operation.kind === 'merge'
                  ? t('tags.manage.merge_success', { name: finalDisplayName })
                  : t('tags.manage.success', { name: finalDisplayName }))
                : t('tags.manage.success_generic') }}</p>
            </section>

            <p v-if="managedTags.length === 0 && state !== 'sync-pending' && state !== 'success'" class="tag-management-empty">
              {{ t('tags.manage.no_tags') }}
            </p>
          </template>

          <p class="tag-management-diagnostic" :data-code="diagnosticCode ?? undefined">
            {{ t('tags.manage.diagnostic', { stage: diagnosticLabel }) }}
          </p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.tag-management-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 42%);
}
.tag-management-dialog {
  width: min(720px, 100%);
  max-height: min(820px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 90%, var(--text-muted));
  border-radius: 10px;
  background: var(--bg);
  color: var(--text-h);
  box-shadow: 0 18px 54px rgb(0 0 0 / 34%);
}
.tag-management-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border);
}
.tag-management-header h2 { margin: 0; font-size: 1.12rem; }
.tag-management-header p { margin: 5px 0 0; color: var(--text-muted); font-size: 0.78rem; }
.tag-management-close {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 1.25rem;
  cursor: pointer;
}
.tag-management-close:hover:not(:disabled) { background: var(--bg-soft); color: var(--text); }
.tag-management-close:disabled { cursor: not-allowed; opacity: 0.45; }
.tag-management-body { max-height: calc(100vh - 140px); overflow-y: auto; padding: 18px 20px 20px; }
.tag-management-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tag-management-form { display: grid; gap: 14px; }
.tag-management-mode { display: grid; gap: 7px; margin: 0; padding: 0; border: 0; }
.tag-management-mode legend { padding: 0; color: var(--text-h); font-size: 0.78rem; font-weight: 600; }
.tag-management-mode-buttons { display: flex; flex-wrap: wrap; gap: 7px; }
.tag-management-mode-button { min-height: 32px; padding: 5px 12px; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--text); font: inherit; font-size: 0.78rem; cursor: pointer; }
.tag-management-mode-button[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--text-h); }
.tag-management-mode-button:hover:not(:disabled) { background: var(--bg-soft); }
.tag-management-mode:disabled .tag-management-mode-button { cursor: not-allowed; opacity: 0.55; }
.tag-management-field { display: grid; gap: 5px; }
.tag-management-field label { color: var(--text-h); font-size: 0.78rem; font-weight: 600; }
.tag-management-input {
  min-height: 34px;
  box-sizing: border-box;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-soft);
  color: var(--text);
  font: inherit;
  font-size: 0.84rem;
}
.tag-management-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.tag-management-input:disabled { cursor: not-allowed; opacity: 0.55; }
.tag-management-help { margin: 0; color: var(--text-muted); font-size: 0.72rem; line-height: 1.4; }
.tag-management-selected { margin: 0; color: var(--text); font-size: 0.76rem; font-weight: 600; }
.tag-management-error { margin: 0; color: var(--danger, #c94f4f); font-size: 0.76rem; line-height: 1.45; }
.tag-management-banner { margin-top: 14px; padding: 9px 10px; border: 1px solid color-mix(in srgb, var(--danger, #c94f4f) 35%, var(--border)); border-radius: 5px; background: color-mix(in srgb, var(--danger, #c94f4f) 8%, transparent); }
.tag-management-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
.tag-management-button { min-height: 32px; padding: 5px 12px; border: 1px solid var(--border); border-radius: 5px; background: transparent; color: var(--text); font: inherit; font-size: 0.78rem; cursor: pointer; }
.tag-management-button:hover:not(:disabled) { background: var(--bg-soft); }
.tag-management-button.primary { border-color: var(--accent); background: var(--accent); color: var(--bg); }
.tag-management-button.primary:hover:not(:disabled) { background: var(--accent-hover, var(--accent)); }
.tag-management-button.secondary { margin-top: 8px; }
.tag-management-button:disabled { cursor: not-allowed; opacity: 0.48; }
.tag-management-state { display: grid; justify-items: center; gap: 12px; min-height: 150px; padding: 36px 12px; color: var(--text-muted); text-align: center; }
.tag-management-state-error { color: var(--text); }
.tag-management-state-success { color: var(--text); }
.tag-management-state p { max-width: 540px; margin: 0; line-height: 1.55; }
.tag-management-preview { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border); }
.tag-management-preview h3 { margin: 0 0 12px; font-size: 0.9rem; }
.tag-management-preview h3:focus { outline: 2px solid var(--accent); outline-offset: 3px; }
.tag-management-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin: 0; }
.tag-management-summary div { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent); font-size: 0.76rem; }
.tag-management-summary dt { color: var(--text-muted); }
.tag-management-summary dd { margin: 0; color: var(--text); font-variant-numeric: tabular-nums; text-align: right; }
.tag-management-display-only { display: grid; gap: 4px; margin-top: 14px; padding: 10px 12px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); font-size: 0.78rem; line-height: 1.45; }
.tag-management-display-only span { color: var(--text-muted); }
.tag-management-merge-guidance { display: grid; gap: 5px; margin-top: 14px; padding: 10px 12px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); font-size: 0.78rem; line-height: 1.45; }
.tag-management-merge-guidance span { color: var(--text-muted); }
.tag-management-conflict { margin-top: 14px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--danger, #c94f4f) 35%, var(--border)); border-radius: 5px; color: var(--danger, #c94f4f); font-size: 0.78rem; line-height: 1.45; }
.tag-management-warnings { margin-top: 14px; padding: 10px 12px; border-left: 3px solid var(--warning, #d97706); background: color-mix(in srgb, var(--warning, #d97706) 8%, transparent); font-size: 0.76rem; }
.tag-management-warnings h4, .tag-management-sample h4 { margin: 0 0 7px; font-size: 0.78rem; }
.tag-management-warnings ul, .tag-management-sample ul { display: grid; gap: 5px; margin: 0; padding-left: 18px; }
.tag-management-sample { margin-top: 16px; }
.tag-management-sample li { display: flex; flex-wrap: wrap; gap: 5px 10px; color: var(--text); font-size: 0.76rem; }
.tag-management-sample li span { color: var(--text-muted); font-family: var(--mono); font-size: 0.7rem; }
.tag-management-sample > p { margin: 0; color: var(--text-muted); font-size: 0.76rem; }
.tag-management-empty { margin: 18px 0 0; color: var(--text-muted); font-size: 0.78rem; }
.tag-management-diagnostic { margin: 18px 0 0; color: var(--text-muted); font-size: 0.68rem; }
@media (max-width: 600px) {
  .tag-management-backdrop { align-items: end; padding: 0; }
  .tag-management-dialog { width: 100%; max-height: 90vh; border-radius: 9px 9px 0 0; }
  .tag-management-summary { grid-template-columns: minmax(0, 1fr); }
}
</style>
