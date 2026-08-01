import { computed, ref } from 'vue'
import * as historyApi from '../../lib/history-api'
import { computeFileDiff } from '../../lib/file-diff'
import type { FileDiff } from '../../lib/history-api'

export type HistoryComparisonStatus = 'loading' | 'ready' | 'error'

/**
 * A user's choice of "this document, this revision".
 *
 * Produced by the timeline components (`useHistoryTimeline`,
 * `useFileHistory`) and consumed by `useHistoryComparisons.openComparison`.
 * Kept here — instead of in a deleted snapshot module — because the
 * direct diff path is its only remaining consumer.
 */
export interface HistoryRevisionSelection {
  documentPath: string
  documentTitle: string
  revisionId: string
  revisionTime: number
  summary: string
}

export interface CurrentDocumentContent {
  raw: string
  dirty: boolean
}

interface EditorDocumentCandidate {
  path: string
  raw: string
  originalRaw: string
  loading: boolean
  loadError: string | null
}

export function getLoadedEditorDocument(
  tabs: readonly EditorDocumentCandidate[],
  path: string,
): CurrentDocumentContent | null {
  const tab = tabs.find((item) => item.path === path)
  if (!tab || tab.loading || tab.loadError) return null

  return {
    raw: tab.raw,
    dirty: tab.raw !== tab.originalRaw,
  }
}

export interface HistoryComparison {
  tabId: string
  documentPath: string
  documentTitle: string
  revisionId: string
  revisionTime: number
  summary: string
  oldRaw: string
  newRaw: string
  currentDirty: boolean
  diff: FileDiff | null
  status: HistoryComparisonStatus
  error: string | null
}

interface HistoryComparisonOptions {
  getCurrentDocument: (path: string) => CurrentDocumentContent | null
  loadCurrentDocument: (path: string) => Promise<string>
}

function comparisonTabId(path: string): string {
  return `diff:${path}`
}

function historyPath(path: string): string {
  return path.endsWith('.md') ? path : `${path}.md`
}

export function useHistoryComparisons(options: HistoryComparisonOptions) {
  const comparisons = ref<HistoryComparison[]>([])
  const activeComparisonId = ref<string | null>(null)
  const requestIds = new Map<string, number>()

  const activeComparison = computed(() => (
    comparisons.value.find((comparison) => comparison.tabId === activeComparisonId.value) ?? null
  ))

  function nextRequestId(tabId: string): number {
    const requestId = (requestIds.get(tabId) ?? 0) + 1
    requestIds.set(tabId, requestId)
    return requestId
  }

  /**
   * Open a comparison for the given selection. Loads the historical
   * revision and the current document in parallel; both sides must
   * resolve (or fail) before status flips to ready/error. The reactive
   * comparison is created before the first await so the caller can render
   * loading immediately and use `refreshComparison(tabId)` for retry.
   */
  async function openComparison(selection: HistoryRevisionSelection): Promise<HistoryComparison> {
    const tabId = comparisonTabId(selection.documentPath)
    let comparison = comparisons.value.find((item) => item.tabId === tabId)
    if (!comparison) {
      comparisons.value.push({
        tabId,
        documentPath: selection.documentPath,
        documentTitle: selection.documentTitle,
        revisionId: selection.revisionId,
        revisionTime: selection.revisionTime,
        summary: selection.summary,
        oldRaw: '',
        newRaw: '',
        currentDirty: false,
        diff: null,
        status: 'loading',
        error: null,
      })
      // Keep the local reference reactive so loading/error/ready changes
      // render immediately while asynchronous loads resolve.
      comparison = comparisons.value.find((item) => item.tabId === tabId)!
    } else {
      Object.assign(comparison, {
        documentTitle: selection.documentTitle,
        revisionId: selection.revisionId,
        revisionTime: selection.revisionTime,
        summary: selection.summary,
        oldRaw: '',
        newRaw: '',
        currentDirty: false,
        diff: null,
        status: 'loading' as const,
        error: null,
      })
    }

    activeComparisonId.value = tabId
    await loadComparisonContent(comparison, nextRequestId(tabId))
    return comparison
  }

  /**
   * Resolve a comparison's historical + current sides in parallel.
   * Honors the request-id guard so a slower obsolete load cannot
   * overwrite a newer one, and a tab close during flight cancels the
   * result write.
   */
  async function loadComparisonContent(
    comparison: HistoryComparison,
    requestId: number,
  ): Promise<void> {
    const tabId = comparison.tabId
    const documentPath = comparison.documentPath
    const revisionId = comparison.revisionId
    try {
      const currentPromise = Promise.resolve(options.getCurrentDocument(documentPath))
        .then(async (openDocument): Promise<CurrentDocumentContent> => {
          if (openDocument) return openDocument
          return {
            raw: await options.loadCurrentDocument(documentPath),
            dirty: false,
          }
        })
      const [historical, current] = await Promise.all([
        historyApi.getFileAt(
          historyPath(documentPath),
          revisionId,
        ),
        currentPromise,
      ])
      if (requestIds.get(tabId) !== requestId) return

      comparison.oldRaw = historical.content
      comparison.newRaw = current.raw
      comparison.currentDirty = current.dirty
      comparison.diff = computeFileDiff(historical.content, current.raw)
      comparison.status = 'ready'
      comparison.error = null
    } catch (error) {
      if (requestIds.get(tabId) !== requestId) return
      comparison.status = 'error'
      comparison.error = error instanceof Error && error.message
        ? error.message
        : null
    }
  }

  async function refreshComparison(tabId: string): Promise<HistoryComparison | null> {
    const comparison = comparisons.value.find((item) => item.tabId === tabId)
    if (!comparison) return null

    comparison.status = 'loading'
    comparison.error = null
    await loadComparisonContent(comparison, nextRequestId(tabId))
    return comparison
  }

  function selectComparison(tabId: string): void {
    if (!comparisons.value.some((comparison) => comparison.tabId === tabId)) return
    activeComparisonId.value = tabId
    void refreshComparison(tabId)
  }

  async function refreshDocumentComparison(path: string): Promise<boolean> {
    const comparison = comparisons.value.find((item) => item.documentPath === path)
    if (!comparison) return true
    const refreshed = await refreshComparison(comparison.tabId)
    return refreshed?.status === 'ready'
  }

  function deactivate(): void {
    activeComparisonId.value = null
  }

  function closeComparison(tabId: string): void {
    nextRequestId(tabId)
    comparisons.value = comparisons.value.filter((comparison) => comparison.tabId !== tabId)
    if (activeComparisonId.value === tabId) activeComparisonId.value = null
  }

  function closeComparisons(tabIds: string[]): void {
    const ids = new Set(tabIds)
    for (const tabId of ids) nextRequestId(tabId)
    comparisons.value = comparisons.value.filter((comparison) => !ids.has(comparison.tabId))
    if (activeComparisonId.value && ids.has(activeComparisonId.value)) {
      activeComparisonId.value = null
    }
  }

  return {
    comparisons,
    activeComparisonId,
    activeComparison,
    openComparison,
    selectComparison,
    refreshComparison,
    refreshDocumentComparison,
    deactivate,
    closeComparison,
    closeComparisons,
  }
}
