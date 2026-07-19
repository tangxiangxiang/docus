import { hashDraftBaseline } from './draftHash'
import { createDraftStore, type DraftStore } from './draftStore'
import {
  UNSAVED_DRAFT_VERSION,
  draftsEqual,
  isUnsavedDraft,
  type UnsavedDraft,
} from './draftTypes'

export const DRAFT_PERSIST_DEBOUNCE_MS = 800

export interface DraftBufferSnapshot {
  vaultId: string
  documentId: string
  documentPath: string
  content: string
  authoritativeContent: string
  baseContentHash: string | null
  baseModifiedAt: number | null
  revision: number
  loaded?: boolean
}

export interface DraftOwner {
  vaultId: string
  documentId: string
  generation: number
}

export interface UnsavedDraftPersistence {
  schedule(snapshot: DraftBufferSnapshot): DraftOwner | null
  flush(vaultId: string, documentId: string): Promise<boolean>
  flushAll(): Promise<void>
  markClean(owner: DraftOwner, acknowledgedRevision: number): Promise<void>
  returnedToBaseline(vaultId: string, documentId: string): Promise<void>
  discard(owner: DraftOwner): Promise<boolean>
  discardIdentity(vaultId: string, documentId: string): Promise<boolean>
  discardIdentityIfUnchanged(expected: UnsavedDraft): Promise<boolean>
  adoptRecoveredDraft(
    expected: UnsavedDraft,
    snapshot: DraftBufferSnapshot,
  ): Promise<DraftOwner | null>
  invalidateOwner(owner: DraftOwner): void
  invalidate(vaultId: string, documentId: string): void
  dispose(): Promise<void>
}

interface DraftEntry {
  generation: number
  timer: ReturnType<typeof setTimeout> | null
  latestSnapshot: DraftBufferSnapshot | null
  latestSnapshotNeedsWrite: boolean
  pendingWrite: Promise<boolean> | null
  previousUpdatedAt: number
  createdAt: number | null
}

interface CreateOptions {
  store?: DraftStore
  debounceMs?: number
  now?: () => number
  targetWindow?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

export function createUnsavedDraftPersistence(
  options: CreateOptions = {},
): UnsavedDraftPersistence {
  const store = options.store ?? createDraftStore()
  const debounceMs = options.debounceMs ?? DRAFT_PERSIST_DEBOUNCE_MS
  const now = options.now ?? Date.now
  const targetWindow = options.targetWindow
    ?? (typeof window === 'undefined' ? undefined : window)
  const entries = new Map<string, DraftEntry>()
  let disposed = false
  let disposePromise: Promise<void> | null = null

  function key(vaultId: string, documentId: string): string {
    return JSON.stringify([vaultId, documentId])
  }

  function validIdentity(vaultId: string, documentId: string): boolean {
    return vaultId.trim().length > 0 && documentId.trim().length > 0
  }

  function entryFor(vaultId: string, documentId: string): DraftEntry {
    const identity = key(vaultId, documentId)
    let entry = entries.get(identity)
    if (!entry) {
      entry = {
        generation: 0,
        timer: null,
        latestSnapshot: null,
        latestSnapshotNeedsWrite: false,
        pendingWrite: null,
        previousUpdatedAt: -1,
        createdAt: null,
      }
      entries.set(identity, entry)
    }
    return entry
  }

  function clearTimer(entry: DraftEntry): void {
    if (entry.timer === null) return
    clearTimeout(entry.timer)
    entry.timer = null
  }

  function safeTimestamp(entry: DraftEntry): number {
    const requested = Math.max(0, Math.floor(now()))
    const next = Math.max(requested, entry.previousUpdatedAt + 1)
    const value = Math.min(Number.MAX_SAFE_INTEGER, next)
    entry.previousUpdatedAt = value
    if (entry.createdAt === null) entry.createdAt = value
    return value
  }

  function cloneSnapshot(snapshot: DraftBufferSnapshot): DraftBufferSnapshot {
    return { ...snapshot }
  }

  function current(
    owner: DraftOwner,
    entry: DraftEntry | undefined,
  ): entry is DraftEntry {
    return Boolean(entry && entry.generation === owner.generation)
  }

  async function buildDraft(
    snapshot: DraftBufferSnapshot,
    owner: DraftOwner,
    entry: DraftEntry,
  ): Promise<UnsavedDraft | null> {
    const baseContentHash = snapshot.baseContentHash
      ?? await hashDraftBaseline(snapshot.authoritativeContent)
    if (!current(owner, entry) || entry.latestSnapshot?.revision !== snapshot.revision) {
      return null
    }
    const updatedAt = safeTimestamp(entry)
    const draft: UnsavedDraft = {
      version: UNSAVED_DRAFT_VERSION,
      vaultId: snapshot.vaultId,
      documentId: snapshot.documentId,
      documentPath: snapshot.documentPath,
      content: snapshot.content,
      baseContentHash,
      baseModifiedAt: snapshot.baseModifiedAt,
      createdAt: entry.createdAt ?? updatedAt,
      updatedAt,
    }
    return isUnsavedDraft(draft) ? draft : null
  }

  function queueWrite(
    owner: DraftOwner,
    snapshot: DraftBufferSnapshot,
    allowDisposed = false,
  ): Promise<boolean> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!entry || (!allowDisposed && disposed)) return Promise.resolve(false)
    const previous = entry.pendingWrite
    const task = (async () => {
      if (previous) await previous.catch(() => false)
      if ((!allowDisposed && disposed) || !current(owner, entry)) return false
      const draft = await buildDraft(snapshot, owner, entry)
      if (!draft || (!allowDisposed && disposed) || !current(owner, entry)) return false
      try {
        const saved = await store.saveDraft(draft)
        if (saved && current(owner, entry)
          && entry.latestSnapshot?.revision === snapshot.revision) {
          entry.latestSnapshotNeedsWrite = false
        }
        return saved
      } catch {
        return false
      }
    })()
    entry.pendingWrite = task
    void task.finally(() => {
      if (entry.pendingWrite === task) entry.pendingWrite = null
    })
    return task
  }

  function schedule(snapshot: DraftBufferSnapshot): DraftOwner | null {
    if (disposed
      || snapshot.loaded === false
      || !validIdentity(snapshot.vaultId, snapshot.documentId)
      || snapshot.documentPath.trim().length === 0) {
      return null
    }
    const captured = cloneSnapshot(snapshot)
    const entry = entryFor(captured.vaultId, captured.documentId)
    clearTimer(entry)
    entry.generation += 1
    entry.latestSnapshot = captured
    entry.latestSnapshotNeedsWrite = true
    const owner: DraftOwner = {
      vaultId: captured.vaultId,
      documentId: captured.documentId,
      generation: entry.generation,
    }
    entry.timer = setTimeout(() => {
      entry.timer = null
      void queueWrite(owner, captured)
    }, debounceMs)
    return owner
  }

  async function flush(
    vaultId: string,
    documentId: string,
    allowDisposed = false,
  ): Promise<boolean> {
    const entry = entries.get(key(vaultId, documentId))
    if (!entry || (!allowDisposed && disposed)) return false
    clearTimer(entry)
    const snapshot = entry.latestSnapshot
    if (!snapshot) return false
    if (!entry.latestSnapshotNeedsWrite) return true
    const owner = { vaultId, documentId, generation: entry.generation }
    return queueWrite(owner, cloneSnapshot(snapshot), allowDisposed)
  }

  async function flushAllInternal(allowDisposed = false): Promise<void> {
    await Promise.all([...entries.entries()].map(async ([serialized, entry]) => {
      if (!entry.latestSnapshot) return
      const [vaultId, documentId] = JSON.parse(serialized) as [string, string]
      await flush(vaultId, documentId, allowDisposed)
    }))
  }

  async function deleteOwned(
    owner: DraftOwner,
    expected?: UnsavedDraft,
  ): Promise<boolean> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!current(owner, entry)) return false
    clearTimer(entry)
    const deleteGeneration = ++entry.generation
    entry.latestSnapshot = null
    entry.latestSnapshotNeedsWrite = false
    const previous = entry.pendingWrite
    const task = (async () => {
      if (previous) await previous.catch(() => false)
      if (entry.generation !== deleteGeneration || entry.latestSnapshot !== null) {
        return false
      }
      try {
        const result = expected
          ? await store.deleteDraftIfUnchanged(expected)
          : await store.deleteDraft(owner.vaultId, owner.documentId)
        return result.status === 'deleted' || result.status === 'missing'
      } catch {
        return false
      }
    })()
    entry.pendingWrite = task
    void task.finally(() => {
      if (entry.pendingWrite === task) entry.pendingWrite = null
    })
    return task
  }

  async function markClean(
    owner: DraftOwner,
    acknowledgedRevision: number,
  ): Promise<void> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!current(owner, entry)
      || entry.latestSnapshot?.revision !== acknowledgedRevision) {
      return
    }
    await deleteOwned(owner)
  }

  async function returnedToBaseline(vaultId: string, documentId: string): Promise<void> {
    if (!validIdentity(vaultId, documentId)) return
    const entry = entryFor(vaultId, documentId)
    const owner = { vaultId, documentId, generation: entry.generation }
    await deleteOwned(owner)
  }

  function invalidate(vaultId: string, documentId: string): void {
    if (!validIdentity(vaultId, documentId)) return
    const entry = entryFor(vaultId, documentId)
    clearTimer(entry)
    entry.generation += 1
    entry.latestSnapshot = null
    entry.latestSnapshotNeedsWrite = false
  }

  function invalidateOwner(owner: DraftOwner): void {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!current(owner, entry)) return
    clearTimer(entry)
    entry.generation += 1
    entry.latestSnapshot = null
    entry.latestSnapshotNeedsWrite = false
  }

  async function discard(owner: DraftOwner): Promise<boolean> {
    if (disposed) return false
    return deleteOwned(owner)
  }

  async function discardIdentity(vaultId: string, documentId: string): Promise<boolean> {
    if (disposed || !validIdentity(vaultId, documentId)) return false
    const entry = entryFor(vaultId, documentId)
    return deleteOwned({ vaultId, documentId, generation: entry.generation })
  }

  async function discardIdentityIfUnchanged(expected: UnsavedDraft): Promise<boolean> {
    if (disposed || !isUnsavedDraft(expected)) return false
    const entry = entryFor(expected.vaultId, expected.documentId)
    return deleteOwned({
      vaultId: expected.vaultId,
      documentId: expected.documentId,
      generation: entry.generation,
    }, expected)
  }

  async function adoptRecoveredDraft(
    expected: UnsavedDraft,
    snapshot: DraftBufferSnapshot,
  ): Promise<DraftOwner | null> {
    if (disposed
      || !isUnsavedDraft(expected)
      || snapshot.loaded === false
      || expected.vaultId !== snapshot.vaultId
      || expected.documentId !== snapshot.documentId
      || !validIdentity(snapshot.vaultId, snapshot.documentId)) {
      return null
    }
    const entry = entryFor(expected.vaultId, expected.documentId)
    if (entry.timer !== null
      || entry.pendingWrite !== null
      || entry.latestSnapshotNeedsWrite
      || entry.latestSnapshot !== null) {
      return null
    }
    const expectedGeneration = entry.generation
    const expectedTimer = entry.timer
    const expectedPendingWrite = entry.pendingWrite
    const expectedSnapshot = entry.latestSnapshot
    const entryIsUnchanged = () =>
      entry.generation === expectedGeneration
      && entry.timer === expectedTimer
      && entry.pendingWrite === expectedPendingWrite
      && entry.latestSnapshot === expectedSnapshot
      && !entry.latestSnapshotNeedsWrite

    let stored: UnsavedDraft | null
    try {
      stored = await store.getDraft(expected.vaultId, expected.documentId)
    } catch {
      return null
    }
    if (disposed
      || !entryIsUnchanged()
      || !stored
      || !draftsEqual(stored, expected)) {
      return null
    }

    // Recheck the stored record across a second asynchronous boundary. Local
    // entry state is observed, never cleared: concurrent edits own their timer
    // and generation and make this adoption fail closed.
    try {
      stored = await store.getDraft(expected.vaultId, expected.documentId)
    } catch {
      return null
    }
    if (disposed
      || !entryIsUnchanged()
      || !stored
      || !draftsEqual(stored, expected)) {
      return null
    }
    entry.generation += 1
    entry.latestSnapshot = cloneSnapshot(snapshot)
    entry.latestSnapshotNeedsWrite = false
    entry.previousUpdatedAt = expected.updatedAt
    entry.createdAt = expected.createdAt
    return {
      vaultId: expected.vaultId,
      documentId: expected.documentId,
      generation: entry.generation,
    }
  }

  function onPageHide(): void {
    void flushAllInternal().catch(() => {})
  }

  targetWindow?.addEventListener('pagehide', onPageHide)

  async function dispose(): Promise<void> {
    if (disposePromise) return disposePromise
    targetWindow?.removeEventListener('pagehide', onPageHide)
    disposePromise = (async () => {
      disposed = true
      for (const entry of entries.values()) clearTimer(entry)
      await flushAllInternal(true)
    })()
    return disposePromise
  }

  return {
    schedule,
    flush,
    flushAll: () => flushAllInternal(),
    markClean,
    returnedToBaseline,
    discard,
    discardIdentity,
    discardIdentityIfUnchanged,
    adoptRecoveredDraft,
    invalidateOwner,
    invalidate,
    dispose,
  }
}
