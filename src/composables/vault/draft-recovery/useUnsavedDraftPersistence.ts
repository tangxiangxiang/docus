import { hashDraftBaseline } from './draftHash'
import { createDraftStore, type DraftStore } from './draftStore'
import {
  UNSAVED_DRAFT_VERSION,
  draftsEqual,
  isUnsavedDraft,
  type DraftConflictRecord,
  type UnsavedDraft,
} from './draftTypes'
import type {
  DraftDeleteRequest,
  DraftDeleteConfirmation,
  DraftDocumentIdentity,
  DraftFileMutationBarrier,
  DraftFileTransactionResult,
  DraftPathMapping,
} from './useDraftFileTransactions'

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
  discardConflict(
    vaultId: string,
    documentId: string,
    conflictId: string,
  ): Promise<boolean>
  adoptRecoveredDraft(
    expected: UnsavedDraft,
    snapshot: DraftBufferSnapshot,
  ): Promise<DraftOwner | null>
  prepareFileMutation(
    identities: readonly DraftDocumentIdentity[],
  ): Promise<DraftFileMutationBarrier>
  captureDeleteConfirmation(
    identity: DraftDocumentIdentity,
    revision: number,
    expectedDraft?: UnsavedDraft | null,
  ): DraftDeleteConfirmation
  findTrackedIdentitiesByPaths(
    paths: readonly string[],
  ): DraftDocumentIdentity[]
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
  persistedDraft: UnsavedDraft | null
  fileTransaction: symbol | null
  /** Set when the local snapshot has been promoted to a separate
   *  conflict record (stale + post-CAS edit). `flushAll` and
   *  `dispose` MUST skip this entry — otherwise `safeTimestamp()`
   *  would mint a fresh `updatedAt` that overwrites the cross-
   *  context record. */
  pendingConflictId: string | null
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

  function conflictId(documentId: string, generation: number): string {
    const uuid = typeof crypto !== 'undefined'
      && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    return `delete-conflict:${documentId}:${generation}:${uuid}`
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
        persistedDraft: null,
        fileTransaction: null,
        pendingConflictId: null,
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

  function snapshotMatches(
    current: DraftBufferSnapshot | null,
    expected: DraftBufferSnapshot | null,
  ): boolean {
    if (!current || !expected) return current === expected
    return current.vaultId === expected.vaultId
      && current.documentId === expected.documentId
      && current.documentPath === expected.documentPath
      && current.content === expected.content
      && current.authoritativeContent === expected.authoritativeContent
      && current.baseContentHash === expected.baseContentHash
      && current.baseModifiedAt === expected.baseModifiedAt
      && current.revision === expected.revision
      && current.loaded === expected.loaded
  }

  function draftMatchesSnapshot(
    draft: UnsavedDraft,
    snapshot: DraftBufferSnapshot,
  ): boolean {
    return draft.vaultId === snapshot.vaultId
      && draft.documentId === snapshot.documentId
      && draft.documentPath === snapshot.documentPath
      && draft.content === snapshot.content
      && draft.baseModifiedAt === snapshot.baseModifiedAt
      && (snapshot.baseContentHash === null
        || draft.baseContentHash === snapshot.baseContentHash)
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
          // DraftStore preserves an existing record's original createdAt.
          // Read back the exact stored value before claiming delete ownership;
          // a concurrent context with a different payload makes this fail
          // closed instead of granting ownership over its record.
          const stored = await store.getDraft(draft.vaultId, draft.documentId)
          if (stored
            && current(owner, entry)
            && entry.latestSnapshot?.revision === snapshot.revision
            && draftsEqual(stored, { ...draft, createdAt: stored.createdAt })) {
            entry.persistedDraft = stored
          }
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
    // A fresh schedule after a conflict-pinned entry means the user
    // has typed new edits that supersede the orphaned conflict
    // record. Clear `pendingConflictId` so `flushAll` / `dispose`
    // start treating the entry as a normal draft again — the
    // conflict record remains in IndexedDB as a parallel candidate.
    entry.pendingConflictId = null
    entry.generation += 1
    entry.latestSnapshot = captured
    entry.latestSnapshotNeedsWrite = true
    const owner: DraftOwner = {
      vaultId: captured.vaultId,
      documentId: captured.documentId,
      generation: entry.generation,
    }
    if (!entry.fileTransaction) {
      entry.timer = setTimeout(() => {
        entry.timer = null
        void queueWrite(owner, captured)
      }, debounceMs)
    }
    return owner
  }

  async function flush(
    vaultId: string,
    documentId: string,
    allowDisposed = false,
  ): Promise<boolean> {
    const entry = entries.get(key(vaultId, documentId))
    if (!entry || (!allowDisposed && disposed)) return false
    if (entry.fileTransaction) return false
    // Conflict-pinned entries must not be flushed back to the
    // primary IndexedDB record. The conflict path already
    // persisted the snapshot under a fresh conflictId.
    if (entry.pendingConflictId !== null) return false
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
      // Entries promoted to a separate conflict record must NEVER
      // be flushed back to the primary IndexedDB record. The
      // conflict path has already persisted the snapshot under a
      // fresh conflictId; re-flushing would mint a new safeTimestamp
      // and overwrite the cross-context record.
      if (entry.pendingConflictId !== null) return
      const [vaultId, documentId] = JSON.parse(serialized) as [string, string]
      await flush(vaultId, documentId, allowDisposed)
    }))
  }

  async function deleteOwned(
    owner: DraftOwner,
    explicitExpected?: UnsavedDraft,
  ): Promise<boolean> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!current(owner, entry)) return false
    clearTimer(entry)
    const previous = entry.pendingWrite
    if (previous) await previous.catch(() => false)
    // Waiting for an in-flight write must not invalidate its ownership before
    // it can record the exact persisted draft. Conversely, any schedule that
    // occurs while waiting advances the generation and owns all newer work.
    if (!current(owner, entry)) return false
    const expected = explicitExpected ?? entry.persistedDraft

    const deleteGeneration = ++entry.generation
    entry.latestSnapshot = null
    entry.latestSnapshotNeedsWrite = false
    // A clean/discarded buffer must still relinquish its in-memory snapshot
    // when no record was persisted. It simply has no cross-context authority
    // to delete anything from the store.
    if (!expected) return false
    const task = (async () => {
      if (entry.generation !== deleteGeneration || entry.latestSnapshot !== null) {
        return false
      }
      // Runtime ownership is not enough to delete a cross-context record.
      // Only the exact draft this coordinator persisted or adopted may be
      // removed; an absent ownership record fails closed.
      if (!expected) return false
      try {
        const result = await store.deleteDraftIfUnchanged(expected)
        const deleted = result.status === 'deleted' || result.status === 'missing'
        if (deleted
          && entry.generation === deleteGeneration
          && entry.persistedDraft
          && draftsEqual(entry.persistedDraft, expected)) {
          entry.persistedDraft = null
        }
        return deleted
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

  async function discardConflict(
    vaultId: string,
    documentId: string,
    conflictId: string,
  ): Promise<boolean> {
    if (disposed || !validIdentity(vaultId, documentId) || conflictId.trim().length === 0) {
      return false
    }
    const result = await store.deleteConflictDraft(vaultId, documentId, conflictId)
    return result === 'deleted' || result === 'missing'
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
    entry.persistedDraft = expected
    return {
      vaultId: expected.vaultId,
      documentId: expected.documentId,
      generation: entry.generation,
    }
  }

  async function prepareFileMutation(
    identities: readonly DraftDocumentIdentity[],
  ): Promise<DraftFileMutationBarrier> {
    const token = Symbol('draft-file-transaction')
    const held = new Map<string, {
      identity: DraftDocumentIdentity
      entry: DraftEntry
      confirmedDraft: UnsavedDraft | null
      preparedGeneration: number
    }>()

    for (const identity of identities) {
      if (!validIdentity(identity.vaultId, identity.documentId)) continue
      const entry = entryFor(identity.vaultId, identity.documentId)
      if (entry.fileTransaction) continue
      clearTimer(entry)
      entry.fileTransaction = token
      held.set(key(identity.vaultId, identity.documentId), {
        identity: { ...identity },
        entry,
        confirmedDraft: null,
        preparedGeneration: entry.generation,
      })
    }
    await Promise.all([...held.values()].map(async ({ entry }) => {
      if (entry.pendingWrite) await entry.pendingWrite.catch(() => false)
    }))
    for (const state of held.values()) {
      if (state.entry.fileTransaction !== token) continue
      state.confirmedDraft = state.entry.persistedDraft
        ?? await store.getDraft(
          state.identity.vaultId,
          state.identity.documentId,
        ).catch(() => null)
      state.preparedGeneration = state.entry.generation
    }

    let settled = false
    let finalized = false
    const pendingReleases = new Map<string, { path: string; writeLatest: boolean }>()

    async function releaseEntry(
      state: typeof held extends Map<string, infer V> ? V : never,
      path: string,
      writeLatest: boolean,
      immediate = false,
    ): Promise<void> {
      const { entry, identity } = state
      if (entry.fileTransaction !== token) return
      entry.fileTransaction = null
      if (entry.latestSnapshot) {
        entry.latestSnapshot = {
          ...entry.latestSnapshot,
          documentPath: path,
        }
      }
      if (!writeLatest || !entry.latestSnapshot || !entry.latestSnapshotNeedsWrite) return
      entry.generation += 1
      const owner = {
        vaultId: identity.vaultId,
        documentId: identity.documentId,
        generation: entry.generation,
      }
      const captured = cloneSnapshot(entry.latestSnapshot)
      if (immediate) {
        await queueWrite(owner, captured)
      } else {
        entry.timer = setTimeout(() => {
          entry.timer = null
          void queueWrite(owner, captured)
        }, debounceMs)
      }
    }

    /**
     * Promote a CAS-confirmed-then-superseded local snapshot into a
     * separate conflict record so the in-memory entry cannot later
     * be flushed back to the primary record (which would overwrite
     * the cross-context source via a fresh `safeTimestamp()`).
     *
     * This is the dual-source conflict storage the spec demands: the
     * IndexedDB primary keeps the cross-context draft, the conflict
     * record holds the local orphan, and the entry is marked
     * `pendingConflictId` so `flushAll` / `dispose` skip it.
     */
    async function persistLocalAsConflict(
      state: typeof held extends Map<string, infer V> ? V : never,
      entry: DraftEntry,
      outcome: string,
      crossContextUpdatedAt: number | null,
    ): Promise<void> {
      const snapshot = entry.latestSnapshot
      const { identity } = state
      // If the entry has no snapshot, there's nothing to preserve —
      // release the file transaction lock and let the cross-context
      // record stand alone.
      if (!snapshot) {
        await releaseEntry(state, identity.documentPath, false, true)
        return
      }
      const localConflictId = conflictId(identity.documentId, entry.generation)
      // safeTimestamp would have us mint a strictly-greater-than-
      // previousUpdatedAt timestamp; conflict records live under a
      // separate key, so the previousUpdatedAt constraint that
      // protects the primary record doesn't apply. We just need a
      // monotonically-increasing timestamp that's newer than the
      // cross-context source so the recovery UI can sort candidates.
      const recordedAt = Math.max(safeTimestamp(entry), (crossContextUpdatedAt ?? 0) + 1)
      entry.previousUpdatedAt = recordedAt
      if (entry.createdAt === null) entry.createdAt = recordedAt
      const record: DraftConflictRecord = {
        version: UNSAVED_DRAFT_VERSION,
        conflictId: localConflictId,
        vaultId: identity.vaultId,
        documentId: identity.documentId,
        documentPath: snapshot.documentPath,
        content: snapshot.content,
        baseContentHash: snapshot.baseContentHash,
        baseModifiedAt: snapshot.baseModifiedAt,
        createdAt: entry.createdAt,
        updatedAt: recordedAt,
        origin: 'delete-conflict',
        crossContextUpdatedAt,
        recordedAt,
      }
      try {
        const result = await store.saveConflictDraft(record)
        if (result.status !== 'saved') {
          // Never let pagehide/dispose flush this local candidate
          // over the cross-context primary record, even if the
          // separate conflict store is unavailable.
          entry.pendingConflictId = `failed:${localConflictId}`
          clearTimer(entry)
          console.warn(`[commitDeletes] Conflict record save failed for ${identity.documentPath} (${outcome}): ${result.status}`)
          await releaseEntry(state, identity.documentPath, false, true)
          return
        }
      } catch (error) {
        entry.pendingConflictId = `failed:${localConflictId}`
        clearTimer(entry)
        console.warn(`[commitDeletes] Conflict record save threw for ${identity.documentPath}:`, error)
        await releaseEntry(state, identity.documentPath, false, true)
        return
      }
      // Mark the entry so flushAll/dispose skip it.
      entry.pendingConflictId = localConflictId
      clearTimer(entry)
      // Drop the in-memory snapshot — it now lives in IndexedDB under
      // the conflictId. Holding it would risk another schedule()
      // bumping the generation and re-running the CAS path against
      // an already-conflicting state.
      entry.latestSnapshot = null
      entry.latestSnapshotNeedsWrite = false
      // Release the file transaction. writeLatest=false because the
      // snapshot has already been persisted as a conflict record;
      // flushing it back to the primary would overwrite the cross-
      // context source.
      await releaseEntry(state, identity.documentPath, false, true)
    }

    async function commitMoves(
      mappings: readonly DraftPathMapping[],
      preserved: readonly DraftDocumentIdentity[] = [],
    ): Promise<DraftFileTransactionResult[]> {
      if (settled) return []
      settled = true
      const results: DraftFileTransactionResult[] = []
      const mappedKeys = new Set<string>()
      void preserved
      for (const mapping of mappings) {
        const identityKey = key(mapping.vaultId, mapping.documentId)
        const state = held.get(identityKey)
        if (!state
          || state.entry.fileTransaction !== token
          || state.identity.documentPath !== mapping.fromPath) {
          results.push({
            documentId: mapping.documentId,
            oldPath: mapping.fromPath,
            newPath: mapping.toPath,
            status: 'identity-mismatch',
          })
          continue
        }
        mappedKeys.add(identityKey)
        const outcome = await store.moveDraft(
          mapping.vaultId,
          mapping.documentId,
          mapping.documentId,
          mapping.toPath,
        )
        const status = outcome.status
        if (status === 'moved') {
          state.entry.persistedDraft = await store.getDraft(
            mapping.vaultId,
            mapping.documentId,
          )
        }
        pendingReleases.set(identityKey, {
          path: status === 'moved' || status === 'missing'
            ? mapping.toPath
            : state.identity.documentPath,
          writeLatest: true,
        })
        results.push({
          documentId: mapping.documentId,
          oldPath: mapping.fromPath,
          newPath: mapping.toPath,
          status,
        })
      }
      for (const [identityKey, state] of held) {
        if (mappedKeys.has(identityKey)) continue
        pendingReleases.set(identityKey, {
          path: state.identity.documentPath,
          // Identity mismatch preserves the record at its old identity, but
          // transaction-time edits must also be persisted as orphan recovery.
          writeLatest: true,
        })
      }
      return results
    }

    async function commitDeletes(
      deletions: readonly DraftDeleteRequest[],
    ): Promise<DraftFileTransactionResult[]> {
      if (settled) return []
      settled = true
      const results: DraftFileTransactionResult[] = []
      const deletedKeys = new Set<string>()
      for (const deletion of deletions) {
        const identityKey = key(deletion.vaultId, deletion.documentId)
        const state = held.get(identityKey)
        if (!state || state.entry.fileTransaction !== token) {
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            status: 'identity-mismatch',
          })
          continue
        }
        deletedKeys.add(identityKey)
        if (deletion.policy === 'preserve') {
          await releaseEntry(state, deletion.documentPath, true, true)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            status: 'preserved',
          })
          continue
        }
        const confirmation = deletion.confirmation
        if (!confirmation
          || confirmation.vaultId !== deletion.vaultId
          || confirmation.documentId !== deletion.documentId
          || confirmation.documentPath !== deletion.documentPath
          || confirmation.ownerGeneration !== state.preparedGeneration
          || state.entry.generation !== confirmation.ownerGeneration
          || (state.entry.latestSnapshot !== null
            && state.entry.latestSnapshot.revision !== confirmation.revision)
          || !snapshotMatches(
            state.entry.latestSnapshot,
            confirmation.expectedSnapshot,
          )) {
          await releaseEntry(state, deletion.documentPath, true, true)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            status: 'stale',
          })
          continue
        }
        const expected = state.entry.persistedDraft
          && confirmation.expectedSnapshot
          && draftMatchesSnapshot(
            state.entry.persistedDraft,
            confirmation.expectedSnapshot,
          )
          ? state.entry.persistedDraft
          : confirmation.expectedDraft
        // Snapshot the entry's pre-CAS ownership so the post-CAS
        // branch can detect edits that landed during the await.
        const preCasGeneration = state.entry.generation
        const preCasRevision = state.entry.latestSnapshot?.revision ?? null
        const preCasSnapshotRef = state.entry.latestSnapshot
        const preCasConfirmedDraft = state.confirmedDraft
        const outcome = expected
          ? await store.deleteDraftIfUnchanged(expected)
          : { status: 'missing' as const }
        const entry = state.entry
        // Refine the CAS outcome using the pre-prepare confirmedDraft.
        // - `missing` + confirmedDraft: at prepare time the store had
        //   a record; CAS found none → a concurrent context deleted
        //   it. Surface as 'stale' so the UI refreshes Recovery
        //   instead of silently dropping the identity.
        const refinedStatus: typeof outcome.status = (() => {
          if (outcome.status === 'missing' && preCasConfirmedDraft) {
            return 'stale'
          }
          return outcome.status
        })()
        // Post-CAS ownership check: detect edits made during the
        // CAS await. `schedule()` advances `entry.generation` even
        // while a file transaction is held, so a strict generation
        // check catches them.
        const entryAdvancedDuringAwait = entry.generation !== preCasGeneration
          || entry.latestSnapshot?.revision !== preCasRevision
          || entry.latestSnapshot !== preCasSnapshotRef
        if ((refinedStatus === 'deleted' || refinedStatus === 'missing')
          && !entryAdvancedDuringAwait) {
          // Truly confirmed: clear the entry's snapshot and ownership.
          clearTimer(entry)
          entry.generation += 1
          entry.latestSnapshot = null
          entry.latestSnapshotNeedsWrite = false
          entry.persistedDraft = null
          entry.fileTransaction = null
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            status: refinedStatus,
          })
          continue
        }
        if ((refinedStatus === 'deleted' || refinedStatus === 'missing')
          && entryAdvancedDuringAwait) {
          // CAS succeeded on the IndexedDB record the user
          // confirmed, but a new local edit (post-CAS) owns a
          // different generation / revision. Preserve the new
          // snapshot by NOT clearing the entry — `releaseEntry`'s
          // normal write path will re-queue the new snapshot with
          // a bumped generation. Report 'conflict' so callers can
          // surface "the deleted source had a newer edit that was
          // preserved as a new orphan recovery entry" instead of
          // treating the operation as a clean delete.
          await releaseEntry(state, deletion.documentPath, true, true)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            status: 'conflict',
          })
          continue
        }
        if (refinedStatus === 'stale' && entryAdvancedDuringAwait) {
          // CAS found a newer cross-context record AND the user
          // made a new local edit during the await. Auto-writing
          // the new local edit with a fresh `safeTimestamp()` would
          // overwrite the cross-context record, which is exactly
          // what the spec forbids. Surface as 'conflict' so the
          // caller can hand the orphan back to Recovery without
          // touching IndexedDB.
          // Re-read the IndexedDB record so the conflict record
          // captures the cross-context source's updatedAt —
          // `state.confirmedDraft` may hold the LOCAL persisted
          // draft, not the cross-context record that won the CAS.
          let crossContextUpdatedAt: number | null = null
          try {
            const remote = await store.getDraft(deletion.vaultId, deletion.documentId)
            if (remote) crossContextUpdatedAt = remote.updatedAt
          } catch {
            crossContextUpdatedAt = null
          }
          await persistLocalAsConflict(state, entry, refinedStatus, crossContextUpdatedAt)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            status: 'conflict',
          })
          continue
        }
        // 'stale' / 'failed' / 'unsupported' without a waiting-period
        // edit: the IndexedDB record (or lack thereof) is the source
        // of truth. Never call queueWrite here — releaseEntry's
        // writeLatest=true path would assign a fresh `safeTimestamp()`
        // that could overwrite a cross-context newer record. Instead,
        // just release the transaction lock without re-writing so
        // Recovery refresh can pick up whatever IndexedDB actually
        // holds.
        await releaseEntry(state, deletion.documentPath, false, true)
        results.push({
          documentId: deletion.documentId,
          oldPath: deletion.documentPath,
          status: refinedStatus,
        })
      }
      for (const [identityKey, state] of held) {
        if (!deletedKeys.has(identityKey)) {
          await releaseEntry(state, state.identity.documentPath, true, true)
        }
      }
      return results
    }

    async function finalizeAfterTabMigration(): Promise<void> {
      if (finalized) return
      finalized = true
      for (const [identityKey, release] of pendingReleases) {
        const state = held.get(identityKey)
        if (state) await releaseEntry(state, release.path, release.writeLatest, true)
      }
      pendingReleases.clear()
    }

    async function rollback(): Promise<void> {
      if (settled) return
      settled = true
      for (const state of held.values()) {
        await releaseEntry(state, state.identity.documentPath, true)
      }
    }

    return { commitMoves, commitDeletes, finalizeAfterTabMigration, rollback }
  }

  function captureDeleteConfirmation(
    identity: DraftDocumentIdentity,
    revision: number,
    expectedDraft?: UnsavedDraft | null,
  ): DraftDeleteConfirmation {
    const entry = entryFor(identity.vaultId, identity.documentId)
    const expected = entry.persistedDraft ?? (expectedDraft
      && expectedDraft.vaultId === identity.vaultId
      && expectedDraft.documentId === identity.documentId
      ? expectedDraft
      : null)
    return {
      ...identity,
      revision,
      ownerGeneration: entry.generation,
      expectedDraft: expected
        ? { ...expected }
        : null,
      expectedSnapshot: entry.latestSnapshot
        ? cloneSnapshot(entry.latestSnapshot)
        : null,
    }
  }

  function findTrackedIdentitiesByPaths(
    paths: readonly string[],
  ): DraftDocumentIdentity[] {
    const wanted = new Set(paths)
    const found = new Map<string, DraftDocumentIdentity>()
    for (const entry of entries.values()) {
      const snapshot = entry.latestSnapshot
      if (!snapshot || !wanted.has(snapshot.documentPath)) continue
      found.set(key(snapshot.vaultId, snapshot.documentId), {
        vaultId: snapshot.vaultId,
        documentId: snapshot.documentId,
        documentPath: snapshot.documentPath,
      })
    }
    return [...found.values()]
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
    discardConflict,
    adoptRecoveredDraft,
    prepareFileMutation,
    captureDeleteConfirmation,
    findTrackedIdentitiesByPaths,
    invalidateOwner,
    invalidate,
    dispose,
  }
}
