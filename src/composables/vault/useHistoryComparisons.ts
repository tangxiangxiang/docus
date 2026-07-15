import { computed, ref } from 'vue'
import type { HistorySnapshot } from './useHistorySnapshots'
import { computeFileDiff } from '../../lib/file-diff'
import type { FileDiff } from '../../lib/history-api'

export type HistoryComparisonStatus = 'loading' | 'ready' | 'error'

export interface CurrentDocumentContent {
  raw: string
  dirty: boolean
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

  async function refreshComparison(tabId: string): Promise<HistoryComparison | null> {
    const comparison = comparisons.value.find((item) => item.tabId === tabId)
    if (!comparison) return null

    comparison.status = 'loading'
    comparison.error = null
    const requestId = nextRequestId(tabId)

    try {
      const openDocument = options.getCurrentDocument(comparison.documentPath)
      const current = openDocument ?? {
        raw: await options.loadCurrentDocument(comparison.documentPath),
        dirty: false,
      }
      if (requestIds.get(tabId) !== requestId) return comparison

      comparison.newRaw = current.raw
      comparison.currentDirty = current.dirty
      comparison.diff = computeFileDiff(comparison.oldRaw, current.raw)
      comparison.status = 'ready'
    } catch (error) {
      if (requestIds.get(tabId) !== requestId) return comparison
      comparison.status = 'error'
      comparison.error = error instanceof Error && error.message ? error.message : null
    }
    return comparison
  }

  async function openComparison(snapshot: HistorySnapshot): Promise<HistoryComparison | null> {
    if (snapshot.status !== 'ready') return null

    const tabId = comparisonTabId(snapshot.documentPath)
    let comparison = comparisons.value.find((item) => item.tabId === tabId)
    if (!comparison) {
      comparisons.value.push({
        tabId,
        documentPath: snapshot.documentPath,
        documentTitle: snapshot.documentTitle,
        revisionId: snapshot.revisionId,
        revisionTime: snapshot.revisionTime,
        summary: snapshot.summary,
        oldRaw: snapshot.rawMarkdown,
        newRaw: '',
        currentDirty: false,
        diff: null,
        status: 'loading',
        error: null,
      })
      // Keep the local reference reactive so loading/error/ready changes
      // render immediately while asynchronous current content resolves.
      comparison = comparisons.value.find((item) => item.tabId === tabId)!
    } else {
      Object.assign(comparison, {
        documentTitle: snapshot.documentTitle,
        revisionId: snapshot.revisionId,
        revisionTime: snapshot.revisionTime,
        summary: snapshot.summary,
        oldRaw: snapshot.rawMarkdown,
        diff: null,
      })
    }

    activeComparisonId.value = tabId
    return refreshComparison(tabId)
  }

  function selectComparison(tabId: string): void {
    if (!comparisons.value.some((comparison) => comparison.tabId === tabId)) return
    activeComparisonId.value = tabId
    void refreshComparison(tabId)
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
    deactivate,
    closeComparison,
    closeComparisons,
  }
}
