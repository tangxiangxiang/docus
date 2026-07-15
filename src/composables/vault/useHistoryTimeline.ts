import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { PostSummary } from '../../lib/api'
import * as historyApi from '../../lib/history-api'
import type { CommitRecord } from '../../lib/history-api'
import type { HistoryRevisionSelection } from './useHistorySnapshots'

export interface TimelineRevision {
  id: string
  path: string
  modifiedAt: number
  summary: string
}

export interface DocumentHistory {
  path: string
  title: string
  modifiedAt: number
  revisionCount: number
  revisions: TimelineRevision[]
}

export interface TimelineGroup<T> {
  key: string
  label: string
  items: T[]
}

export interface TimelineLoadError {
  message: string | null
}

export function toHistoryRevisionSelection(
  document: DocumentHistory,
  revision: TimelineRevision,
): HistoryRevisionSelection {
  return {
    documentPath: document.path,
    documentTitle: document.title,
    revisionId: revision.id,
    revisionTime: revision.modifiedAt,
    summary: revision.summary,
  }
}

interface HistoryTimelineSource {
  log: Ref<CommitRecord[]>
  logLoading: Ref<boolean>
  logLoaded: Ref<boolean>
}

interface TimelineLabels {
  today: string
  yesterday: string
  lastWeek: string
  earlier: string
}

function appPath(path: string): string {
  return path.endsWith('.md') ? path.slice(0, -3) : path
}

function historyPath(path: string): string {
  return path.endsWith('.md') ? path : `${path}.md`
}

function fallbackTitle(path: string): string {
  const name = appPath(path).split('/').pop() ?? path
  return name
    .replace(/^\d+[-_]/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function groupTimelineItems<T>(
  items: T[],
  getTimestamp: (item: T) => number,
  locale: string,
  labels: TimelineLabels,
  now = Date.now(),
): TimelineGroup<T>[] {
  const today = startOfDay(now)
  const groups = new Map<string, TimelineGroup<T>>()

  for (const item of items) {
    const timestamp = getTimestamp(item)
    const date = new Date(timestamp)
    const dayDelta = Math.max(0, Math.floor((today - startOfDay(timestamp)) / 86_400_000))
    let key: string
    let label: string

    if (dayDelta === 0) {
      key = 'today'
      label = labels.today
    } else if (dayDelta === 1) {
      key = 'yesterday'
      label = labels.yesterday
    } else if (dayDelta <= 6) {
      key = `weekday-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      label = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
    } else if (dayDelta <= 13) {
      key = 'last-week'
      label = labels.lastWeek
    } else if (date.getFullYear() === new Date(now).getFullYear()) {
      key = `month-${date.getMonth()}`
      label = new Intl.DateTimeFormat(locale, { month: 'long' }).format(date)
    } else {
      key = 'earlier'
      label = labels.earlier
    }

    const group = groups.get(key) ?? { key, label, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }

  return [...groups.values()]
}

function toRevisions(commits: CommitRecord[], path: string): TimelineRevision[] {
  const target = historyPath(path)
  return commits
    .filter((commit) => commit.files.includes(target))
    .map((commit) => ({
      id: commit.sha,
      path: appPath(target),
      modifiedAt: Date.parse(commit.date),
      summary: commit.subject,
    }))
    .filter((revision) => Number.isFinite(revision.modifiedAt))
}

export function useHistoryTimeline(
  source: HistoryTimelineSource,
  posts: Ref<PostSummary[]>,
  locale: Ref<string>,
  labels: ComputedRef<TimelineLabels>,
) {
  const selectedDocument = ref<DocumentHistory | null>(null)
  const selectedRevisionId = ref<string | null>(null)
  const revisionsLoading = ref(false)
  const revisionsError = ref<TimelineLoadError | null>(null)
  let revisionRequestId = 0

  const documents = computed<DocumentHistory[]>(() => {
    const titles = new Map(posts.value.map((post) => [post.path, post.title]))
    const revisionsByPath = new Map<string, TimelineRevision[]>()

    for (const commit of source.log.value) {
      const modifiedAt = Date.parse(commit.date)
      if (!Number.isFinite(modifiedAt)) continue
      for (const rawPath of commit.files) {
        if (!rawPath.endsWith('.md')) continue
        const path = appPath(rawPath)
        const revision: TimelineRevision = {
          id: commit.sha,
          path,
          modifiedAt,
          summary: commit.subject,
        }
        const revisions = revisionsByPath.get(path) ?? []
        revisions.push(revision)
        revisionsByPath.set(path, revisions)
      }
    }

    return [...revisionsByPath.entries()]
      .map(([path, revisions]) => ({
        path,
        title: titles.get(path) ?? fallbackTitle(path),
        modifiedAt: revisions[0]?.modifiedAt ?? 0,
        revisionCount: revisions.length,
        revisions,
      }))
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  })

  const documentGroups = computed(() => groupTimelineItems(
    documents.value,
    (document) => document.modifiedAt,
    locale.value,
    labels.value,
  ))

  const revisionGroups = computed(() => groupTimelineItems(
    selectedDocument.value?.revisions ?? [],
    (revision) => revision.modifiedAt,
    locale.value,
    labels.value,
  ))

  async function selectDocument(document: DocumentHistory): Promise<void> {
    const requestId = ++revisionRequestId
    selectedDocument.value = { ...document, revisions: [...document.revisions] }
    selectedRevisionId.value = null
    revisionsLoading.value = true
    revisionsError.value = null
    try {
      const response = await historyApi.getLog({ path: historyPath(document.path), limit: 200 })
      if (requestId !== revisionRequestId) return
      const revisions = toRevisions(response.commits ?? [], document.path)
      selectedDocument.value = {
        ...document,
        revisionCount: revisions.length,
        revisions,
      }
    } catch (error) {
      if (requestId !== revisionRequestId) return
      revisionsError.value = {
        message: error instanceof Error && error.message ? error.message : null,
      }
    } finally {
      if (requestId === revisionRequestId) revisionsLoading.value = false
    }
  }

  function selectRevision(revision: TimelineRevision): void {
    selectedRevisionId.value = revision.id
  }

  async function retrySelectedDocument(): Promise<void> {
    const document = selectedDocument.value
    if (document) await selectDocument(document)
  }

  function showDocuments(): void {
    revisionRequestId++
    selectedDocument.value = null
    selectedRevisionId.value = null
    revisionsLoading.value = false
    revisionsError.value = null
  }

  return {
    documents,
    documentGroups,
    selectedDocument,
    selectedRevisionId,
    revisionGroups,
    loading: computed(() => source.logLoading.value || !source.logLoaded.value),
    revisionsLoading,
    revisionsError,
    selectDocument,
    selectRevision,
    retrySelectedDocument,
    showDocuments,
  }
}
