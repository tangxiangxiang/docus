import {
  computed,
  readonly,
  ref,
  type ComputedRef,
  type DeepReadonly,
  type Ref,
} from 'vue'
import { getPost, type PostDetail } from '../../../lib/api'
import {
  decideDraftRecovery,
  type DraftRecoveryDecision,
  type RecoveryDiskSnapshot,
} from './draftRecoveryDecision'
import { createDraftStore, type DraftStore } from './draftStore'
import type { UnsavedDraft } from './draftTypes'

export type DraftRecoveryItemStatus =
  | 'unresolved'
  | 'loading'
  | 'ready'
  | 'error'
  | 'dismissed'

export interface DraftRecoveryItem {
  recoveryId: string
  draft: UnsavedDraft
  decision: DraftRecoveryDecision | null
  status: DraftRecoveryItemStatus
  error: string | null
}

export interface UnsavedDraftRecovery {
  items: DeepReadonly<Ref<DraftRecoveryItem[]>>
  pendingItem: ComputedRef<DeepReadonly<DraftRecoveryItem> | null>
  activeRecoveryId: DeepReadonly<Ref<string | null>>
  discover(vaultId: string): Promise<void>
  retry(recoveryId: string): Promise<void>
  dismissForSession(recoveryId: string): void
  selectRecovery(recoveryId: string | null): void
  dispose(): void
}

interface RecoveryOptions {
  store?: DraftStore
  loadPost?: (path: string) => Promise<PostDetail>
  concurrency?: number
}

interface OwnedItem extends DraftRecoveryItem {
  discoverGeneration: number
  classifyGeneration: number
}

export interface OpenDraftDocumentState {
  documentId?: string | null
  raw: string
  originalRaw: string
  savingRevision: number | null
  saveStatus: string
  externalRaw?: string | null
}

export function hasUnsafeOpenDraftDocument(
  documents: readonly OpenDraftDocumentState[],
  documentId: string,
): boolean {
  const document = documents.find((candidate) => candidate.documentId === documentId)
  return Boolean(document && (
    document.raw !== document.originalRaw
    || document.savingRevision !== null
    || document.externalRaw != null
    || !['idle', 'saved'].includes(document.saveStatus)
  ))
}

function recoveryId(draft: UnsavedDraft): string {
  return JSON.stringify([draft.vaultId, draft.documentId])
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unreadable'
}

export function createUnsavedDraftRecovery(
  options: RecoveryOptions = {},
): UnsavedDraftRecovery {
  const store = options.store ?? createDraftStore()
  const loadPost = options.loadPost ?? getPost
  const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 4)))
  const mutableItems = ref<OwnedItem[]>([])
  const activeRecoveryId = ref<string | null>(null)
  let discoverGeneration = 0
  let disposed = false

  const pendingItem = computed(() =>
    mutableItems.value.find((item) => item.status !== 'dismissed') ?? null,
  )

  function currentItem(
    id: string,
    itemDiscoverGeneration: number,
    generation: number,
  ): OwnedItem | null {
    if (disposed) return null
    const item = mutableItems.value.find((candidate) => candidate.recoveryId === id)
    return item?.discoverGeneration === itemDiscoverGeneration
      && item.classifyGeneration === generation
      ? item
      : null
  }

  async function readDisk(draft: UnsavedDraft): Promise<RecoveryDiskSnapshot> {
    try {
      const post = await loadPost(draft.documentPath)
      return {
        status: 'ready',
        documentPath: post.path,
        documentId: post.metadata?.id ?? null,
        raw: post.raw,
        mtime: post.mtime,
      }
    } catch (error) {
      if (errorStatus(error) === 404) {
        return { status: 'missing', documentPath: draft.documentPath }
      }
      return {
        status: 'unreadable',
        documentPath: draft.documentPath,
        error: errorMessage(error),
      }
    }
  }

  async function classify(item: OwnedItem): Promise<void> {
    const itemDiscoverGeneration = item.discoverGeneration
    const generation = ++item.classifyGeneration
    item.status = 'loading'
    item.error = null
    const disk = await readDisk(item.draft)
    if (!currentItem(item.recoveryId, itemDiscoverGeneration, generation)) return
    try {
      const decision = await decideDraftRecovery(item.draft, disk)
      const current = currentItem(item.recoveryId, itemDiscoverGeneration, generation)
      if (!current) return
      current.decision = decision
      current.status = 'ready'
      current.error = null
    } catch (error) {
      const current = currentItem(item.recoveryId, itemDiscoverGeneration, generation)
      if (!current) return
      current.decision = null
      current.status = 'error'
      current.error = errorMessage(error)
    }
  }

  async function discover(vaultId: string): Promise<void> {
    const generation = ++discoverGeneration
    activeRecoveryId.value = null
    if (disposed || vaultId.trim().length === 0) {
      mutableItems.value = []
      return
    }
    const drafts = await store.listDrafts(vaultId)
    if (disposed || generation !== discoverGeneration) return
    mutableItems.value = drafts.map((draft) => ({
      recoveryId: recoveryId(draft),
      draft,
      decision: null,
      status: 'unresolved',
      error: null,
      discoverGeneration: generation,
      classifyGeneration: 0,
    }))

    let cursor = 0
    const workers = Array.from(
      { length: Math.min(concurrency, mutableItems.value.length) },
      async () => {
        while (!disposed && generation === discoverGeneration) {
          const index = cursor++
          const item = mutableItems.value[index]
          if (!item) return
          await classify(item)
        }
      },
    )
    await Promise.all(workers)
  }

  async function retry(id: string): Promise<void> {
    if (disposed) return
    const item = mutableItems.value.find((candidate) => candidate.recoveryId === id)
    if (!item) return
    const itemDiscoverGeneration = item.discoverGeneration
    const refreshGeneration = ++item.classifyGeneration
    item.status = 'loading'
    item.error = null
    const latest = await store.getDraft(item.draft.vaultId, item.draft.documentId)
    const current = currentItem(id, itemDiscoverGeneration, refreshGeneration)
    if (!current) return
    if (!latest) {
      current.decision = null
      current.status = 'error'
      current.error = 'draft-unavailable'
      return
    }
    current.draft = latest
    await classify(item)
  }

  function dismissForSession(id: string): void {
    if (disposed) return
    const item = mutableItems.value.find((candidate) => candidate.recoveryId === id)
    if (!item) return
    item.status = 'dismissed'
    if (activeRecoveryId.value === id) activeRecoveryId.value = null
  }

  function selectRecovery(id: string | null): void {
    if (disposed) return
    activeRecoveryId.value = id !== null
      && mutableItems.value.some((item) => item.recoveryId === id)
      ? id
      : null
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    discoverGeneration += 1
    for (const item of mutableItems.value) item.classifyGeneration += 1
    activeRecoveryId.value = null
  }

  return {
    items: readonly(mutableItems),
    pendingItem,
    activeRecoveryId: readonly(activeRecoveryId),
    discover,
    retry,
    dismissForSession,
    selectRecovery,
    dispose,
  }
}
