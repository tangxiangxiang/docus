import { computed, ref } from 'vue'
import * as historyApi from '../../lib/history-api'

export type HistorySnapshotStatus = 'loading' | 'ready' | 'error'

export interface HistoryRevisionSelection {
  documentPath: string
  documentTitle: string
  revisionId: string
  revisionTime: number
  summary: string
}

export interface HistorySnapshot extends HistoryRevisionSelection {
  tabId: string
  rawMarkdown: string
  status: HistorySnapshotStatus
  error: string | null
}

function historyPath(path: string): string {
  return path.endsWith('.md') ? path : `${path}.md`
}

function snapshotTabId(path: string): string {
  return `history:${path}`
}

export function useHistorySnapshots() {
  const snapshots = ref<HistorySnapshot[]>([])
  const activeSnapshotId = ref<string | null>(null)
  const requestIds = new Map<string, number>()

  const activeSnapshot = computed(() => (
    snapshots.value.find((snapshot) => snapshot.tabId === activeSnapshotId.value) ?? null
  ))

  function nextRequestId(tabId: string): number {
    const requestId = (requestIds.get(tabId) ?? 0) + 1
    requestIds.set(tabId, requestId)
    return requestId
  }

  async function openRevision(selection: HistoryRevisionSelection): Promise<HistorySnapshot> {
    const tabId = snapshotTabId(selection.documentPath)
    let snapshot = snapshots.value.find((item) => item.tabId === tabId)
    activeSnapshotId.value = tabId

    if (snapshot?.revisionId === selection.revisionId && snapshot.status === 'ready') {
      return snapshot
    }

    if (!snapshot) {
      snapshots.value.push({
        ...selection,
        tabId,
        rawMarkdown: '',
        status: 'loading',
        error: null,
      })
      // Read the item back from the ref array so subsequent async writes
      // target Vue's reactive proxy and update the mounted viewer.
      snapshot = snapshots.value.find((item) => item.tabId === tabId)!
    } else {
      Object.assign(snapshot, selection, {
        rawMarkdown: '',
        status: 'loading' as const,
        error: null,
      })
    }

    const requestId = nextRequestId(tabId)
    try {
      const response = await historyApi.getFileAt(
        historyPath(selection.documentPath),
        selection.revisionId,
      )
      if (requestIds.get(tabId) !== requestId) return snapshot
      snapshot.rawMarkdown = response.content
      snapshot.status = 'ready'
    } catch (error) {
      if (requestIds.get(tabId) !== requestId) return snapshot
      snapshot.status = 'error'
      snapshot.error = error instanceof Error && error.message ? error.message : null
    }
    return snapshot
  }

  function openCachedRevision(
    selection: HistoryRevisionSelection,
    rawMarkdown: string,
  ): HistorySnapshot {
    const tabId = snapshotTabId(selection.documentPath)
    nextRequestId(tabId)
    let snapshot = snapshots.value.find((item) => item.tabId === tabId)
    if (!snapshot) {
      snapshots.value.push({
        ...selection,
        tabId,
        rawMarkdown,
        status: 'ready',
        error: null,
      })
      snapshot = snapshots.value.find((item) => item.tabId === tabId)!
    } else {
      Object.assign(snapshot, selection, {
        rawMarkdown,
        status: 'ready' as const,
        error: null,
      })
    }
    activeSnapshotId.value = tabId
    return snapshot
  }

  function selectSnapshot(tabId: string): void {
    if (snapshots.value.some((snapshot) => snapshot.tabId === tabId)) {
      activeSnapshotId.value = tabId
    }
  }

  function viewCurrent(): void {
    activeSnapshotId.value = null
  }

  function closeSnapshot(tabId: string): void {
    nextRequestId(tabId)
    snapshots.value = snapshots.value.filter((snapshot) => snapshot.tabId !== tabId)
    if (activeSnapshotId.value === tabId) activeSnapshotId.value = null
  }

  function closeSnapshots(tabIds: string[]): void {
    const ids = new Set(tabIds)
    for (const tabId of ids) nextRequestId(tabId)
    snapshots.value = snapshots.value.filter((snapshot) => !ids.has(snapshot.tabId))
    if (activeSnapshotId.value && ids.has(activeSnapshotId.value)) {
      activeSnapshotId.value = null
    }
  }

  return {
    snapshots,
    activeSnapshotId,
    activeSnapshot,
    openRevision,
    openCachedRevision,
    selectSnapshot,
    viewCurrent,
    closeSnapshot,
    closeSnapshots,
  }
}
