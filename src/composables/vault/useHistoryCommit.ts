import { computed, ref, watch } from 'vue'
import { createCommit, HistoryApiError, type CommitResult } from '../../lib/history-api'
import { useI18n } from '../useI18n'
import { useToast } from '../useToast'
import type { HistoryState } from './useHistory'

export interface HistoryCommitOptions {
  history: HistoryState
  saveSelected(paths: readonly string[]): Promise<void>
  refreshSelectedDocument?(committedPaths: readonly string[]): Promise<void>
}

export function useHistoryCommit(options: HistoryCommitOptions) {
  const { t } = useI18n()
  const toast = useToast()
  const selectedPaths = ref<Set<string>>(new Set())
  const message = ref('')
  const busy = ref(false)
  const error = ref<string | null>(null)
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
    selectedCount.value > 0 && trimmedMessage.value.length > 0 && !busy.value
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
    await options.refreshSelectedDocument?.(paths)
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

    busy.value = true
    try {
      await options.saveSelected(paths)
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : t('common.unknown_error')
      error.value = t('history.commit_save_failed', { error: detail })
      toast.error(error.value)
      busy.value = false
      return null
    }

    try {
      const result = await createCommit(paths, versionMessage)
      await refreshAfterCommit(result.filesCommitted)
      selectedPaths.value = new Set(
        [...selectedPaths.value].filter((path) => !result.filesCommitted.includes(path)),
      )
      message.value = ''
      const success = result.filesCommitted.length === 1
        ? t('history.commit_success')
        : t('history.commit_success_count', { count: result.filesCommitted.length })
      toast.success(success)
      return result
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : t('common.unknown_error')
      if (cause instanceof HistoryApiError && cause.status === 409) {
        await options.history.refreshStatus()
        error.value = t('history.commit_stale', { error: detail })
      } else {
        error.value = t('history.commit_failed', { error: detail })
      }
      toast.error(error.value)
      return null
    } finally {
      busy.value = false
    }
  }

  return {
    selectedPaths,
    selectedCount,
    message,
    busy,
    error,
    canCommit,
    toggle,
    selectAll,
    clearSelection,
    submit,
  }
}
