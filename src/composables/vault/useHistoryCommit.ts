import { computed, ref, watch } from 'vue'
import {
  createCommit,
  getContentHashes,
  HistoryApiError,
  repairIndex,
  type CommitResult,
} from '../../lib/history-api'
import { useI18n } from '../useI18n'
import { useToast } from '../useToast'
import type { HistoryState } from './useHistory'

export interface HistoryCommitOptions {
  history: HistoryState
  saveSelected(paths: readonly string[]): Promise<void | ((
    options?: { flushPending?: boolean }
  ) => Promise<void>)>
  refreshComparisons?(committedPaths: readonly string[]): Promise<void>
  acquireMutation?(paths: readonly string[]): (() => void) | null
  canMutate?(paths: readonly string[]): boolean
}

export function useHistoryCommit(options: HistoryCommitOptions) {
  const { t } = useI18n()
  const toast = useToast()
  const selectedPaths = ref<Set<string>>(new Set())
  const message = ref('')
  const busy = ref(false)
  const busyPaths = ref<Set<string>>(new Set())
  const error = ref<string | null>(null)
  const lastCommittedPaths = ref<readonly string[]>([])
  const completionId = ref(0)
  const repositoryChangeId = ref(0)
  const indexRepairPaths = ref<readonly string[]>([])
  const indexRepairBusy = ref(false)
  let initializedSelection = false

  watch(
    () => options.history.status.value.map((entry) => entry.path),
    (paths) => {
      const available = new Set(paths)
      if (!initializedSelection) {
        if (paths.length === 0) return
        initializedSelection = true
        selectedPaths.value = new Set(paths)
        return
      }
      selectedPaths.value = new Set(
        [...selectedPaths.value].filter((path) => available.has(path)),
      )
    },
    { immediate: true },
  )

  const selectedCount = computed(() => selectedPaths.value.size)
  const trimmedMessage = computed(() => message.value.trim())
  const canCommit = computed(() => (
    selectedCount.value > 0
    && trimmedMessage.value.length > 0
    && !busy.value
    && (options.canMutate?.([...selectedPaths.value]) ?? true)
  ))

  function toggle(path: string): void {
    if (busy.value) return
    const next = new Set(selectedPaths.value)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    selectedPaths.value = next
  }

  function selectAll(): void {
    if (busy.value) return
    selectedPaths.value = new Set(options.history.status.value.map((entry) => entry.path))
  }

  function clearSelection(): void {
    if (busy.value) return
    selectedPaths.value = new Set()
  }

  async function refreshAfterCommit(paths: readonly string[]): Promise<void> {
    await Promise.all([
      options.history.refreshStatus(),
      options.history.refreshLog(),
    ])
    await options.refreshComparisons?.(paths)
  }

  async function submit(): Promise<CommitResult | null> {
    if (busy.value) return null
    error.value = null
    const paths = [...selectedPaths.value]
    const versionMessage = trimmedMessage.value
    if (paths.length === 0) {
      error.value = t('history.commit_no_selection')
      return null
    }
    if (!versionMessage) {
      error.value = t('history.commit_empty_message')
      return null
    }

    const releaseMutation = options.acquireMutation?.(paths)
    if (options.acquireMutation && !releaseMutation) {
      error.value = t('history.document_mutation_in_progress')
      toast.info(error.value)
      return null
    }
    busy.value = true
    busyPaths.value = new Set(paths)
    let releaseBarrier: ((options?: { flushPending?: boolean }) => Promise<void>) | null = null
    try {
      releaseBarrier = await options.saveSelected(paths) ?? null
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : t('common.unknown_error')
      error.value = t('history.commit_save_failed', { error: detail })
      toast.error(error.value)
      busy.value = false
      busyPaths.value = new Set()
      releaseMutation?.()
      return null
    }

    try {
      const expected = await getContentHashes(paths)
      const result = await createCommit(paths, versionMessage, expected)
      await releaseBarrier?.()
      releaseBarrier = null
      await refreshAfterCommit(result.filesCommitted)
      selectedPaths.value = new Set(
        [...selectedPaths.value].filter((path) => !result.filesCommitted.includes(path)),
      )
      message.value = ''
      lastCommittedPaths.value = result.filesCommitted
      completionId.value += 1
      const success = result.filesCommitted.length === 1
        ? t('history.commit_success')
        : t('history.commit_success_count', { count: result.filesCommitted.length })
      if (result.indexRefreshFailed) {
        indexRepairPaths.value = result.filesCommitted
        toast.info(t('history.commit_index_refresh_failed'), 5000)
      } else {
        indexRepairPaths.value = []
        toast.success(success)
      }
      return result
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : t('common.unknown_error')
      if (cause instanceof HistoryApiError && cause.status === 409) {
        if (/repository changed before commit/i.test(detail)) {
          await Promise.all([options.history.refreshStatus(), options.history.refreshLog()])
          repositoryChangeId.value += 1
          error.value = t('history.commit_repository_changed')
        } else if (/repository operation in progress/i.test(detail)) {
          await options.history.refreshStatus()
          error.value = t('history.repository_operation_in_progress')
        } else {
          await options.history.refreshStatus()
          error.value = t('history.commit_stale', { error: detail })
        }
      } else {
        error.value = t('history.commit_failed', { error: detail })
      }
      toast.error(error.value)
      return null
    } finally {
      await releaseBarrier?.()
      busy.value = false
      busyPaths.value = new Set()
      releaseMutation?.()
    }
  }

  async function retryIndexRepair(): Promise<boolean> {
    if (indexRepairBusy.value || indexRepairPaths.value.length === 0) return false
    indexRepairBusy.value = true
    error.value = null
    try {
      await repairIndex([...indexRepairPaths.value])
      await options.history.refreshStatus()
      indexRepairPaths.value = []
      toast.success(t('history.index_repair_success'))
      return true
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : t('common.unknown_error')
      error.value = t('history.index_repair_failed', { error: detail })
      toast.error(error.value)
      return false
    } finally {
      indexRepairBusy.value = false
    }
  }

  return {
    selectedPaths,
    selectedCount,
    message,
    busy,
    busyPaths,
    error,
    lastCommittedPaths,
    completionId,
    repositoryChangeId,
    indexRepairPaths,
    indexRepairBusy,
    canCommit,
    toggle,
    selectAll,
    clearSelection,
    submit,
    retryIndexRepair,
  }
}

export type HistoryCommitState = ReturnType<typeof useHistoryCommit>
