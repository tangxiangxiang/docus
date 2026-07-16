import { ref, type Ref } from 'vue'
import type { Tab } from '../../components/vault/tabs'
import * as historyApi from '../../lib/history-api'
import type { VaultFileChanges } from './context/fileChanges'
import { getLoadedEditorDocument } from './useHistoryComparisons'
import { useI18n } from '../useI18n'

export interface HistoryRestoreSource {
  documentPath: string
  documentTitle: string
  revisionId: string
  revisionTime: number
  historicalRaw: string
}

export interface HistoryRestoreRequest extends HistoryRestoreSource {
  currentDirty: boolean
}

interface HistoryRestoreOptions {
  tabs: Ref<Tab[]>
  fileChanges: VaultFileChanges
  confirm: (request: HistoryRestoreRequest) => Promise<boolean>
  prepareEditorRestore: (path: string) => Promise<void>
  refreshVault: () => Promise<void>
  refreshComparison: (path: string) => Promise<boolean | void>
  acquireMutation?: (paths: readonly string[]) => (() => void) | null
  onConflict?: (request: HistoryRestoreRequest) => void
  restoreFile?: typeof historyApi.restoreFile
  onSuccess: (request: HistoryRestoreRequest, result: { refreshFailed: boolean }) => void
  onError: (request: HistoryRestoreRequest, error: unknown) => void
}

function historyPath(path: string): string {
  return path.endsWith('.md') ? path : `${path}.md`
}

function applyRestoredContent(tab: Tab, raw: string, mtime: number): void {
  tab.raw = raw
  tab.originalRaw = raw
  tab.revision += 1
  tab.savedRevision = tab.revision
  tab.savingRevision = null
  tab.saveStatus = 'idle'
  tab.error = null
  tab.loadError = null
  tab.loading = false
  tab.externalRaw = null
  tab.serverMtime = mtime
}

export function useHistoryRestore(options: HistoryRestoreOptions) {
  const { t } = useI18n()
  const restoring = ref(false)
  const restoringPath = ref<string | null>(null)
  const error = ref<string | null>(null)
  let pending = false

  function buildRequest(source: HistoryRestoreSource): HistoryRestoreRequest {
    return {
      ...source,
      currentDirty: getLoadedEditorDocument(options.tabs.value, source.documentPath)?.dirty ?? false,
    }
  }

  async function restore(source: HistoryRestoreSource): Promise<boolean> {
    if (pending) return false
    pending = true

    // Capture every mutable value before the confirmation opens. Navigating
    // to another revision cannot change the operation the user confirms.
    const request = buildRequest({ ...source })
    let confirmed = false
    try {
      confirmed = await options.confirm(request)
    } catch (cause) {
      error.value = cause instanceof Error && cause.message ? cause.message : null
      options.onError(request, cause)
      pending = false
      return false
    }
    if (!confirmed) {
      pending = false
      return false
    }

    const releaseMutation = options.acquireMutation?.([historyPath(request.documentPath)])
    if (options.acquireMutation && !releaseMutation) {
      error.value = t('history.document_mutation_in_progress')
      options.onConflict?.(request)
      pending = false
      return false
    }

    restoring.value = true
    restoringPath.value = request.documentPath
    error.value = null
    try {
      await options.prepareEditorRestore(request.documentPath)
      const result = await (options.restoreFile ?? historyApi.restoreFile)(
        historyPath(request.documentPath),
        request.revisionId,
      )

      const tab = options.tabs.value.find((item) => item.path === request.documentPath)
      if (tab) applyRestoredContent(tab, request.historicalRaw, result.mtime)

      options.fileChanges.publish({
        path: request.documentPath,
        kind: 'write',
        newMtime: result.mtime,
        newRaw: request.historicalRaw,
        source: 'history-restore',
      })
      const refreshResults = await Promise.allSettled([
        options.refreshVault(),
        options.refreshComparison(request.documentPath),
      ])
      const refreshFailed = refreshResults.some((refreshResult) => (
        refreshResult.status === 'rejected'
        || (refreshResult.status === 'fulfilled' && refreshResult.value === false)
      ))
      options.onSuccess(request, { refreshFailed })
      return true
    } catch (cause) {
      error.value = cause instanceof Error && cause.message ? cause.message : null
      options.onError(request, cause)
      return false
    } finally {
      restoring.value = false
      restoringPath.value = null
      pending = false
      releaseMutation?.()
    }
  }

  return {
    restoring,
    restoringPath,
    error,
    buildRequest,
    restore,
  }
}
