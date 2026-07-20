import { hashDraftBaseline } from './draftHash'
import { createDraftStore, type DraftStore } from './draftStore'
import {
  UNSAVED_DRAFT_VERSION,
  draftsEqual,
  isUnsavedDraft,
  type DraftConflictRecord,
  type DraftConflictSource,
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
    expectedConflictIds?: readonly string[],
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
   *  conflict record (stale + post-CAS edit). While non-null the entry
   *  is in "conflict channel" mode: new edits must persist as conflict
   *  records, and `flush` / `flushAll` / `dispose` must never write the
   *  primary record — otherwise `safeTimestamp()` would mint a fresh
   *  `updatedAt` that overwrites the cross-context record. */
  pendingConflictId: string | null
  /** The cross-context primary record's `updatedAt` captured when the
   *  entry entered conflict channel mode. Reused by subsequent
   *  conflict-channel writes so each candidate records the same
   *  cross-context source it diverged from. */
  conflictCrossContextUpdatedAt: number | null
  /** Set whenever the draft family and the server/tab path diverge:
   *  a family move that came back INCOMPLETE during commitMoves while
   *  the server rename itself succeeded — `failed` (rolled back),
   *  `unsupported` (pre-flight blocked the whole move) or `conflict` —
   *  or an identity-mismatch the lifecycle resolved against the
   *  server's ACTUAL target path. The draft family (primary record +
   *  every conflict candidate) stays whole at `oldPath` (its actual
   *  path — a chained rename A→B→C that failed twice keeps oldPath
   *  at A); the lifecycle still migrates the Document tab to
   *  `newPath` (the server truth). While non-null, an edit arriving
   *  on any path other than `oldPath` must never write the primary
   *  record directly — DraftStore accepts the higher-`updatedAt`
   *  draft's path wholesale, so a plain write would move the primary
   *  to the new path while the conflict candidates stay on the old
   *  one, re-creating exactly the split the atomic family move
   *  exists to prevent. The debounced write retries the atomic move
   *  FIRST; on success the quarantine lifts and the latest snapshot
   *  persists on the new path with the family whole. While the retry
   *  keeps failing, the latest content persists as a separate
   *  conflict candidate instead and the old family stays whole at
   *  `oldPath`. Cleared by a successful retry OR by a subsequent
   *  commitMoves that completes the family move (`moved`/`missing`)
   *  — a stale quarantine targeting an earlier path must never drag
   *  the family back. The store-level family-aware save is the
   *  stateless backstop for the same invariant across page reloads
   *  (this field is in-memory only): a cross-path primary save
   *  migrates the family atomically inside its own transaction. */
  pendingFamilyMove: { oldPath: string; newPath: string } | null
}

/** Result of promoting a superseded local snapshot into the conflict
 *  store during a delete transaction. The handoff is BOUNDED to two
 *  saves: it persists the current snapshot, and if a newer edit lands
 *  during that save it persists the NEW latest snapshot once more —
 *  never chasing indefinitely (a steady typer must not keep the file
 *  transaction / mutation lock open on a moving target).
 *  `persisted` — the latest snapshot now lives in the conflict store,
 *  verified within the transaction, so the caller may safely let the
 *  lifecycle close the tab; `failed` — a save was rejected, or edits
 *  kept landing across both attempts, so the latest bytes are still
 *  only in-memory: the caller must report 'failed' and keep the tab
 *  visible (the release arms the conflict debounce so the write is
 *  retried in the background while the tab remains the visible
 *  surface). */
export type ConflictHandoffResult =
  | { status: 'persisted'; conflictId: string }
  | { status: 'failed' }

/** Result of releasing a file transaction's hold on an entry.
 *  `released` — the lock was dropped without an immediate persistence
 *  requirement (nothing pending, or a debounce was armed instead);
 *  `persisted` — an immediate orphan/conflict write completed and the
 *  bytes are durable; `failed` — an immediate write was attempted and
 *  rejected, so the latest snapshot is still only in-memory. Every
 *  delete path that lets the lifecycle close the file tab must map
 *  `failed` to a 'failed' transaction result — the open tab is then
 *  the only surface still holding those bytes. */
type DraftReleaseResult =
  | { status: 'released' }
  | { status: 'persisted' }
  | { status: 'failed' }

/** Fired when a background quarantine retry changes the draft family
 *  AFTER the rename transaction already reported (the lifecycle has
 *  long since refreshed Recovery against the failed/mismatched state).
 *  `moved` — the retry united the family at `newPath`; `conflict` —
 *  the retry failed again but the latest content was persisted as a
 *  move-quarantine candidate next to the old family. The owner should
 *  refresh the Recovery identity (and any open Recovery surfaces) so
 *  they follow the family instead of showing the stale pre-retry
 *  state. Never warns — the original failure already did. */
export interface DraftFamilyMoveSettlement {
  vaultId: string
  documentId: string
  oldPath: string
  newPath: string
  status: 'moved' | 'conflict'
}

interface CreateOptions {
  store?: DraftStore
  debounceMs?: number
  now?: () => number
  targetWindow?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  onDraftFamilyMoveSettled?: (settlement: DraftFamilyMoveSettlement) => void
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

  /** Build a conflict record for a snapshot. Mints a timestamp strictly
   *  newer than the cross-context source so recovery can sort candidates.
   *  Shared by the delete-time handoff, the conflict-channel write path
   *  and the failed-family-move quarantine so all produce identical
   *  record shapes. */
  function buildConflictRecord(
    snapshot: DraftBufferSnapshot,
    entry: DraftEntry,
    identity: DraftDocumentIdentity,
    crossContextUpdatedAt: number | null,
    origin: DraftConflictSource = 'delete-conflict',
  ): DraftConflictRecord {
    const localConflictId = conflictId(identity.documentId, entry.generation)
    const recordedAt = Math.max(safeTimestamp(entry), (crossContextUpdatedAt ?? 0) + 1)
    entry.previousUpdatedAt = recordedAt
    if (entry.createdAt === null) entry.createdAt = recordedAt
    return {
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
      origin,
      crossContextUpdatedAt,
      recordedAt,
    }
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
        conflictCrossContextUpdatedAt: null,
        pendingFamilyMove: null,
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

  /** Notify the owner that a background quarantine retry settled the
   *  draft family (see DraftFamilyMoveSettlement). Best effort — a
   *  throwing handler must never break draft persistence. */
  function notifyFamilyMoveSettled(
    vaultId: string,
    documentId: string,
    quarantine: { oldPath: string; newPath: string },
    status: DraftFamilyMoveSettlement['status'],
  ): void {
    try {
      options.onDraftFamilyMoveSettled?.({
        vaultId,
        documentId,
        oldPath: quarantine.oldPath,
        newPath: quarantine.newPath,
        status,
      })
    } catch {
      // Recovery sync is best-effort UX.
    }
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

  /** Core primary-record write shared by the debounced, flushed and
   *  finalized paths. Returns true ONLY when the exact readback after
   *  the save still equals the draft just written AND the snapshot is
   *  still the entry's latest at resolution:
   *  - an edit landing during the save advances the generation,
   *    replaces the snapshot and re-arms the write flag, so a `true`
   *    that ignored the supersession would certify outdated content;
   *  - another context may replace the record between the save and
   *    the readback (DraftStore accepts a higher `updatedAt` record
   *    wholesale), so a `true` based on `saveDraft` alone would
   *    certify content that is already gone from the store — and a
   *    close seal acting on it would close the tab holding the only
   *    remaining copy.
   *  On a readback mismatch the write hands off instead of retrying:
   *  the attempted revision is persisted as an independent conflict
   *  candidate (never a fresh-timestamp primary overwrite, which
   *  would bury the cross-context record) and the entry is pinned to
   *  the conflict channel. The write still returns false — the bytes
   *  survived as a candidate but not as the primary record, so the
   *  caller (close seal, release) fails closed and keeps the tab
   *  open while Recovery surfaces the candidate. A rejected candidate
   *  also returns false, leaving the write flag set so flush / close
   *  seal keep retrying the conflict channel. */
  async function writePrimary(
    owner: DraftOwner,
    snapshot: DraftBufferSnapshot,
    allowDisposed: boolean,
  ): Promise<boolean> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!entry || (!allowDisposed && disposed)) return false
    if ((!allowDisposed && disposed) || !current(owner, entry)) return false
    const draft = await buildDraft(snapshot, owner, entry)
    if (!draft || (!allowDisposed && disposed) || !current(owner, entry)) return false
    const capturedSnapshot = entry.latestSnapshot
    const capturedRevision = snapshot.revision
    if (!capturedSnapshot || capturedSnapshot.revision !== capturedRevision) return false
    let saved = false
    try {
      saved = await store.saveDraft(draft)
    } catch {
      return false
    }
    if (!saved) return false
    // A newer local edit landing during the save supersedes this
    // revision — its own write is responsible for persistence.
    if ((!allowDisposed && disposed) || !current(owner, entry)
      || entry.latestSnapshot !== capturedSnapshot
      || entry.latestSnapshot.revision !== capturedRevision) {
      return false
    }
    // Exact readback: the store must still hold EXACTLY the draft we
    // just saved. Another context may have replaced it between the
    // save and this read — DraftStore accepts a higher `updatedAt`
    // record wholesale (body AND path), so a `saveDraft === true` that
    // skips the readback would certify content durable that is
    // already gone from the store, and a close seal acting on that
    // true would close the tab holding the only remaining copy. The
    // write flag is cleared ONLY once the readback matches.
    let stored: UnsavedDraft | null = null
    try {
      stored = await store.getDraft(draft.vaultId, draft.documentId)
    } catch {
      return false
    }
    if (stored
      && (!allowDisposed && disposed) === false
      && current(owner, entry)
      && entry.latestSnapshot === capturedSnapshot
      && entry.latestSnapshot.revision === capturedRevision
      && draftsEqual(stored, { ...draft, createdAt: stored.createdAt })) {
      entry.latestSnapshotNeedsWrite = false
      entry.persistedDraft = stored
      return true
    }
    // Readback mismatch: the record the store now holds is a newer
    // cross-context draft (or is gone). NEVER retry with a fresh
    // timestamp — `safeTimestamp()` would mint a higher `updatedAt`
    // and silently bury the other context's record, the exact race
    // the conflict channel exists to prevent. Persist the attempted
    // revision as an independent conflict candidate instead and pin
    // the entry to the conflict channel so every subsequent edit
    // follows it. A rejected candidate fails closed: the close seal
    // keeps the tab open (the only surface still holding the bytes)
    // and flush/dispose keep retrying the conflict channel.
    if ((!allowDisposed && disposed) || entry.pendingConflictId !== null) {
      return false
    }
    const crossContextUpdatedAt = stored?.updatedAt ?? null
    const record = buildConflictRecord(
      snapshot,
      entry,
      {
        vaultId: owner.vaultId,
        documentId: owner.documentId,
        documentPath: snapshot.documentPath,
      },
      crossContextUpdatedAt,
    )
    let candidateSaved = false
    try {
      candidateSaved = (await store.saveConflictDraft(record)).status === 'saved'
    } catch {
      candidateSaved = false
    }
    entry.conflictCrossContextUpdatedAt = crossContextUpdatedAt
    if (!candidateSaved) {
      // Pin as failed so flush / close-seal retries stay on the
      // conflict channel instead of falling back to a primary write
      // that would overwrite the cross-context record.
      entry.pendingConflictId = `failed:${record.conflictId}`
      return false
    }
    entry.pendingConflictId = record.conflictId
    // The cross-context record owns the primary store from here on.
    entry.persistedDraft = stored
    if (current(owner, entry)
      && entry.latestSnapshot === capturedSnapshot
      && entry.latestSnapshot.revision === capturedRevision) {
      // The candidate holds the latest content — clear the write
      // flag. A newer local edit that landed mid-handoff keeps its
      // flag set so it persists on the conflict channel next.
      entry.latestSnapshotNeedsWrite = false
    }
    // The attempted revision is durable as a conflict candidate, but
    // NOT as the primary record the caller asked to persist — report
    // false so a close seal keeps the tab open and a Recovery refresh
    // surfaces the candidate.
    return false
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
      return writePrimary(owner, snapshot, allowDisposed)
    })()
    entry.pendingWrite = task
    void task.finally(() => {
      if (entry.pendingWrite === task) entry.pendingWrite = null
    })
    return task
  }

  /** Core conflict-channel write (see queueConflictWrite). Persists the
   *  latest snapshot as a conflict record — never the primary store. */
  async function writeConflict(
    owner: DraftOwner,
    snapshot: DraftBufferSnapshot,
    allowDisposed: boolean,
  ): Promise<boolean> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!entry || (!allowDisposed && disposed)) return false
    if ((!allowDisposed && disposed) || !current(owner, entry)) return false
    if (entry.pendingConflictId === null) return false
    if (entry.latestSnapshot?.revision !== snapshot.revision) return false
    const record = buildConflictRecord(
      snapshot,
      entry,
      {
        vaultId: owner.vaultId,
        documentId: owner.documentId,
        documentPath: snapshot.documentPath,
      },
      entry.conflictCrossContextUpdatedAt,
    )
    try {
      const result = await store.saveConflictDraft(record)
      if (result.status === 'saved'
        && current(owner, entry)
        && entry.pendingConflictId !== null
        && entry.latestSnapshot?.revision === snapshot.revision) {
        entry.pendingConflictId = record.conflictId
        entry.latestSnapshotNeedsWrite = false
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /** Persist the latest snapshot as a conflict record — never the primary
   *  store. Used while an entry is in conflict channel mode: the primary
   *  record is owned by a cross-context source and must not be touched,
   *  but the user's continuing edits still need to be preserved. Each
   *  quiet debounce period produces one new conflict candidate. */
  function queueConflictWrite(
    owner: DraftOwner,
    snapshot: DraftBufferSnapshot,
    allowDisposed = false,
  ): Promise<boolean> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!entry || (!allowDisposed && disposed)) return Promise.resolve(false)
    const previous = entry.pendingWrite
    const task = (async () => {
      if (previous) await previous.catch(() => false)
      return writeConflict(owner, snapshot, allowDisposed)
    })()
    entry.pendingWrite = task
    void task.finally(() => {
      if (entry.pendingWrite === task) entry.pendingWrite = null
    })
    return task
  }

  /** Persist the latest snapshot of an entry quarantined by a failed
   *  family move (the server rename succeeded, the draft family is
   *  still whole at `oldPath`, and the tab already shows `newPath`).
   *  A plain primary write here would move ONLY the primary record to
   *  the new path (DraftStore accepts the higher-`updatedAt` draft's
   *  path wholesale), stranding the conflict candidates on the old
   *  one — the exact split the atomic family move exists to prevent.
   *  So the write retries the atomic move FIRST:
   *  - move succeeds → the quarantine lifts and the latest snapshot
   *    persists on the entry's active channel at the new path, family
   *    whole (a candidate recorded by an earlier failed retry travels
   *    with it);
   *  - move fails → the primary record is never touched; the latest
   *    content persists as a separate move-quarantine candidate
   *    instead, the old family stays whole at `oldPath`, and the next
   *    edit retries the move again. */
  function queueFamilyMoveWrite(
    owner: DraftOwner,
    snapshot: DraftBufferSnapshot,
    allowDisposed = false,
  ): Promise<boolean> {
    const entry = entries.get(key(owner.vaultId, owner.documentId))
    if (!entry || (!allowDisposed && disposed)) return Promise.resolve(false)
    const quarantine = entry.pendingFamilyMove
    if (!quarantine) {
      // Quarantine lifted concurrently — persist on the active channel.
      return entry.pendingConflictId !== null
        ? queueConflictWrite(owner, snapshot, allowDisposed)
        : queueWrite(owner, snapshot, allowDisposed)
    }
    const previous = entry.pendingWrite
    const task = (async () => {
      if (previous) await previous.catch(() => false)
      if ((!allowDisposed && disposed) || !current(owner, entry)) return false
      if (entry.pendingFamilyMove !== quarantine) {
        return entry.pendingConflictId !== null
          ? writeConflict(owner, snapshot, allowDisposed)
          : writePrimary(owner, snapshot, allowDisposed)
      }
      let moved = false
      try {
        const outcome = await store.moveDraftFamily(
          owner.vaultId,
          owner.documentId,
          quarantine.newPath,
        )
        moved = outcome.status === 'moved' || outcome.status === 'missing'
      } catch {
        moved = false
      }
      if ((!allowDisposed && disposed) || !current(owner, entry)) return false
      if (moved) {
        // The store state changed — lift the quarantine FIRST so a
        // superseding edit (its owner check fails below) persists
        // normally on the new path instead of re-running the move.
        entry.pendingFamilyMove = null
        // The family moved in the background, after the rename
        // transaction already refreshed Recovery against the failed
        // state — notify so items/tabs follow the family.
        notifyFamilyMoveSettled(owner.vaultId, owner.documentId, quarantine, 'moved')
        if ((!allowDisposed && disposed) || !current(owner, entry)) return false
        if (entry.latestSnapshot) {
          entry.latestSnapshot = {
            ...entry.latestSnapshot,
            documentPath: quarantine.newPath,
          }
        }
        try {
          entry.persistedDraft = await store.getDraft(owner.vaultId, owner.documentId)
        } catch {
          entry.persistedDraft = null
        }
        if ((!allowDisposed && disposed) || !current(owner, entry)) return false
        const latest = entry.latestSnapshot
        if (!latest || !entry.latestSnapshotNeedsWrite) return true
        const target = cloneSnapshot(latest)
        return entry.pendingConflictId !== null
          ? writeConflict(owner, target, allowDisposed)
          : writePrimary(owner, target, allowDisposed)
      }
      // The retry failed — the family stays whole at the OLD path.
      // Never write the primary record: persist the latest content as
      // a separate move-quarantine candidate so Recovery shows it next
      // to the old family, and keep the quarantine so the next edit
      // retries the move again.
      if (entry.pendingConflictId !== null) {
        // Conflict-pinned entries stay on their existing channel.
        return writeConflict(owner, snapshot, allowDisposed)
      }
      const latest = entry.latestSnapshot
      if (!latest) return false
      const capturedRef = latest
      const capturedRevision = latest.revision
      const record = buildConflictRecord(
        latest,
        entry,
        {
          vaultId: owner.vaultId,
          documentId: owner.documentId,
          documentPath: latest.documentPath,
        },
        null,
        'move-conflict',
      )
      let saved = false
      try {
        saved = (await store.saveConflictDraft(record)).status === 'saved'
      } catch {
        saved = false
      }
      if (saved) {
        // A new candidate now sits next to the old family — notify so
        // Recovery shows it even though the move is still failing.
        notifyFamilyMoveSettled(owner.vaultId, owner.documentId, quarantine, 'conflict')
      }
      if (saved
        && current(owner, entry)
        && entry.pendingFamilyMove === quarantine
        && entry.latestSnapshot === capturedRef
        && entry.latestSnapshot.revision === capturedRevision) {
        entry.latestSnapshotNeedsWrite = false
        return true
      }
      return false
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
    // While the entry is in conflict channel mode (a prior handoff
    // promoted the local snapshot to a conflict record), a new edit must
    // NOT revert to primary persistence: writing the primary store here
    // would mint a fresh `safeTimestamp()` and overwrite the cross-
    // context record that won the CAS. Keep the pin and route the
    // debounced write to the conflict channel, preserving the new
    // content as another conflict candidate.
    const conflictChannel = entry.pendingConflictId !== null
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
        const quarantine = entry.pendingFamilyMove
        if (quarantine && captured.documentPath !== quarantine.oldPath) {
          // A failed family move quarantines the entry: an edit made on
          // the post-rename tab path must retry the atomic move before
          // anything may write the primary record there — a plain write
          // would move the primary alone and split the family.
          void queueFamilyMoveWrite(owner, captured)
        } else if (conflictChannel) {
          void queueConflictWrite(owner, captured)
        } else {
          void queueWrite(owner, captured)
        }
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
    // A quarantined entry (failed family move, tab already on the new
    // path) must never flush a new-path snapshot to the primary record
    // directly — route it through the move-retry flow instead so the
    // family moves as a unit (or the content lands as a candidate).
    const quarantine = entry.pendingFamilyMove
    if (quarantine
      && entry.latestSnapshot
      && entry.latestSnapshot.documentPath !== quarantine.oldPath) {
      clearTimer(entry)
      if (!entry.latestSnapshotNeedsWrite) return true
      const owner = { vaultId, documentId, generation: entry.generation }
      return queueFamilyMoveWrite(owner, cloneSnapshot(entry.latestSnapshot), allowDisposed)
    }
    // Conflict-pinned entries must never be flushed back to the primary
    // record. If a conflict-channel edit is still pending, persist it as
    // a conflict record so pagehide/dispose doesn't drop it; otherwise
    // (snapshot already promoted) there's nothing left to do.
    if (entry.pendingConflictId !== null) {
      clearTimer(entry)
      const snapshot = entry.latestSnapshot
      if (!snapshot || !entry.latestSnapshotNeedsWrite) return true
      const owner = { vaultId, documentId, generation: entry.generation }
      return queueConflictWrite(owner, cloneSnapshot(snapshot), allowDisposed)
    }
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
      // Delegate to `flush()`, which picks the right channel per entry:
      // conflict-pinned entries persist a still-pending snapshot as a
      // conflict record (never the primary record — a primary write
      // would mint a fresh `safeTimestamp()` and overwrite the cross-
      // context record), while normal entries write primary. Skipping
      // conflict-pinned entries here would drop an in-debounce
      // conflict-channel edit on pagehide/dispose — the bytes would
      // exist neither in the primary store nor the conflict store.
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
    let closeSealed = false
    // Identities whose commit already reported 'failed'. Their tabs stay
    // open regardless and their armed debounce retries in the background,
    // so the finalize gates never re-REPORT them — re-running the failure
    // there could only duplicate the user-visible warning.
    // finalizeBeforeDocumentClose skips them outright; finalizeAfterTab-
    // Migration still RELEASES them (their fileTransaction token must not
    // outlive the barrier — without the release, schedule() would never
    // arm a timer again and flush()/pagehide could never persist the
    // entry's subsequent edits), but suppresses the duplicate result.
    const alreadyFailedKeys = new Set<string>()
    const pendingReleases = new Map<string, {
      path: string
      writeLatest: boolean
      documentId: string
      fromPath: string
      toPath?: string
    }>()

    async function releaseEntry(
      state: typeof held extends Map<string, infer V> ? V : never,
      path: string,
      writeLatest: boolean,
      immediate = false,
    ): Promise<DraftReleaseResult> {
      const { entry, identity } = state
      if (entry.fileTransaction !== token) return { status: 'released' }
      entry.fileTransaction = null
      if (entry.latestSnapshot) {
        entry.latestSnapshot = {
          ...entry.latestSnapshot,
          documentPath: path,
        }
      }
      if (!writeLatest || !entry.latestSnapshot || !entry.latestSnapshotNeedsWrite) {
        return { status: 'released' }
      }
      // A conflict-pinned entry must keep writing the conflict channel,
      // never the primary record, even when released by a file
      // transaction (e.g. a move finalized while in conflict mode).
      const conflictChannel = entry.pendingConflictId !== null
      entry.generation += 1
      const owner = {
        vaultId: identity.vaultId,
        documentId: identity.documentId,
        generation: entry.generation,
      }
      const captured = cloneSnapshot(entry.latestSnapshot)
      if (immediate) {
        // An immediate write must be OBSERVED: it is the last persistence
        // step before the caller reports the transaction result that
        // decides whether the file tab closes. A rejected write leaves
        // the bytes only in-memory — return 'failed' so the caller maps
        // it to a 'failed' transaction result and the lifecycle keeps
        // the tab open (the only surface still holding the content).
        const saved = conflictChannel
          ? await queueConflictWrite(owner, captured)
          : await queueWrite(owner, captured)
        return saved ? { status: 'persisted' } : { status: 'failed' }
      }
      entry.timer = setTimeout(() => {
        entry.timer = null
        if (conflictChannel) void queueConflictWrite(owner, captured)
        else void queueWrite(owner, captured)
      }, debounceMs)
      return { status: 'released' }
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
     * `pendingConflictId` so `flush` / `flushAll` / `dispose` keep any
     * later edits on the conflict channel instead of writing primary.
     *
     * The handoff is bounded to TWO saves so it always terminates — a
     * steady typer cannot keep the file transaction / mutation lock
     * open on a moving target — yet it never reports success while
     * the latest bytes are still only in-memory: attempt 1 persists
     * the current snapshot; if a newer edit lands during that save,
     * attempt 2 persists the NEW latest snapshot immediately. An edit
     * that lands during attempt 2 is NOT chased — the handoff fails
     * closed instead, keeping the tab open (the only visible surface)
     * while the armed conflict debounce retries in the background.
     */
    async function persistLocalAsConflict(
      state: typeof held extends Map<string, infer V> ? V : never,
      entry: DraftEntry,
      outcome: string,
      crossContextUpdatedAt: number | null,
    ): Promise<ConflictHandoffResult> {
      const { identity } = state
      // No snapshot → nothing to preserve; the cross-context record
      // stands alone.
      if (!entry.latestSnapshot) {
        await releaseEntry(state, identity.documentPath, false, true)
        return { status: 'persisted', conflictId: '' }
      }
      let lastConflictId = ''
      // Bounded to exactly two attempts — the hard cap is the whole
      // point: an unbounded re-save loop let a slow IndexedDB write
      // plus steady typing keep this transaction open indefinitely.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const snapshot = entry.latestSnapshot
        // The snapshot was invalidated mid-handoff (the buffer was
        // reloaded / discarded) — nothing left to persist.
        if (!snapshot) break
        const capturedGeneration = entry.generation
        const capturedRevision = snapshot.revision
        const capturedRef = snapshot
        const record = buildConflictRecord(snapshot, entry, identity, crossContextUpdatedAt)
        lastConflictId = record.conflictId
        let saved = false
        try {
          saved = (await store.saveConflictDraft(record)).status === 'saved'
        } catch (error) {
          console.warn(`[commitDeletes] Conflict record save threw for ${identity.documentPath} (${outcome}):`, error)
          saved = false
        }
        if (!saved) {
          // Rejected: keep the content in-memory and pin as failed so
          // flush/flushAll/dispose never overwrite the primary record
          // (and retry the conflict write if the store recovers). The
          // release arms the conflict debounce for a background retry
          // while the lifecycle keeps the tab open — it is the only
          // surface still holding these bytes.
          entry.pendingConflictId = `failed:${record.conflictId}`
          entry.conflictCrossContextUpdatedAt = crossContextUpdatedAt
          clearTimer(entry)
          console.warn(`[commitDeletes] Conflict record save failed for ${identity.documentPath} (${outcome})`)
          await releaseEntry(state, identity.documentPath, true)
          return { status: 'failed' }
        }
        const advanced = entry.generation !== capturedGeneration
          || entry.latestSnapshot?.revision !== capturedRevision
          || entry.latestSnapshot !== capturedRef
        if (!advanced) {
          // Stable: the saved record holds the latest content. Pin the
          // entry and drop the in-memory snapshot (it now lives in the
          // conflict store).
          entry.pendingConflictId = record.conflictId
          entry.conflictCrossContextUpdatedAt = crossContextUpdatedAt
          clearTimer(entry)
          entry.latestSnapshot = null
          entry.latestSnapshotNeedsWrite = false
          await releaseEntry(state, identity.documentPath, false, true)
          return { status: 'persisted', conflictId: record.conflictId }
        }
        // Superseded: a newer edit landed during the save. Loop into
        // attempt 2 on the NEW latest snapshot (or fall through to the
        // fail-closed tail once both attempts are spent).
      }
      // Both attempts saved candidates, but the entry kept advancing
      // (or its snapshot vanished mid-handoff): the latest bytes are
      // not verified persisted. Fail closed — pin the conflict channel
      // to the last saved candidate and end the transaction with the
      // debounce armed, so the unpersisted snapshot retries in the
      // background while the tab stays open as the visible surface.
      entry.pendingConflictId = lastConflictId || entry.pendingConflictId
      entry.conflictCrossContextUpdatedAt = crossContextUpdatedAt
      clearTimer(entry)
      await releaseEntry(state, identity.documentPath, true)
      return { status: 'failed' }
    }

    async function commitMoves(
      mappings: readonly DraftPathMapping[],
      preserved: readonly DraftDocumentIdentity[] = [],
      mismatched: readonly DraftPathMapping[] = [],
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
        // Move the primary record and every conflict candidate for this
        // identity in ONE IndexedDB transaction. Conflict records share
        // the documentId identity but live in a separate store; moving
        // them in an independent transaction could leave the primary
        // renamed while conflicts are stranded on the pre-rename path
        // (misclassified as missing-source / identity-mismatch), and a
        // conflict-phase failure used to be silently swallowed while the
        // result still reported 'moved'. The family move fails closed:
        // any error rolls both stores back and surfaces as 'failed',
        // which reportDraftResults turns into a user-visible warning.
        // Conflict candidates travel even when the primary record is
        // 'missing' (conflict-only documents).
        const outcome = await store.moveDraftFamily(
          mapping.vaultId,
          mapping.documentId,
          mapping.toPath,
        )
        const status = outcome.status
        const familyMoved = status === 'moved' || status === 'missing'
        if (!familyMoved) {
          // failed / unsupported / conflict: the server rename already
          // succeeded and the lifecycle WILL migrate the tab to the
          // new path — but the draft family is still whole where it
          // was ('unsupported' means the pre-flight blocked the WHOLE
          // move, so nothing changed; 'failed' means it rolled back).
          // Quarantine the entry on EVERY incomplete status: a later
          // edit made on the new tab path must retry the atomic move
          // before anything writes the primary record there (a plain
          // write would move the primary alone, stranding the
          // conflict candidates on the old path — re-creating exactly
          // the split the family move failed to complete). oldPath is
          // the family's ACTUAL path: a previous quarantine's oldPath
          // when this rename chains onto an earlier failed one (A→B
          // failed leaving the family at A, then B→C fails — the
          // family is at A, not at the mapping's fromPath B).
          if (status === 'failed') alreadyFailedKeys.add(identityKey)
          state.entry.pendingFamilyMove = {
            oldPath: state.entry.pendingFamilyMove?.oldPath ?? mapping.fromPath,
            newPath: mapping.toPath,
          }
        } else {
          // The family moved (or nothing existed to move): any stale
          // quarantine left by an earlier failed rename targeting a
          // different path is obsolete — keeping it would let a later
          // edit retry the move against the OLD target and drag the
          // family back from the path it actually lives on now.
          state.entry.pendingFamilyMove = null
          if (status === 'moved') {
            state.entry.persistedDraft = await store.getDraft(
              mapping.vaultId,
              mapping.documentId,
            )
          }
        }
        pendingReleases.set(identityKey, {
          // An incomplete move releases on the family's actual path:
          // the transaction-time edit persists where the family is
          // whole, never as a lone primary write at the renamed path.
          path: familyMoved
            ? mapping.toPath
            : (state.entry.pendingFamilyMove?.oldPath ?? state.identity.documentPath),
          writeLatest: true,
          documentId: mapping.documentId,
          fromPath: mapping.fromPath,
          toPath: mapping.toPath,
        })
        results.push({
          documentId: mapping.documentId,
          oldPath: mapping.fromPath,
          newPath: mapping.toPath,
          status,
        })
      }
      // Identities whose server rename succeeded but whose post-rename
      // identity resolution does not match the draft identity. The
      // barrier attempts NO move for them — the lifecycle reports the
      // identity-mismatch itself — but it still receives the ACTUAL
      // server target path: the tab migrates there, so a later edit
      // made under the stale draft identity must quarantine-and-retry
      // exactly like a failed move instead of writing the primary
      // record alone at the new path (stranding the family on the old
      // one). Released without a result, like preserved identities.
      for (const mapping of mismatched) {
        const identityKey = key(mapping.vaultId, mapping.documentId)
        const state = held.get(identityKey)
        if (!state || state.entry.fileTransaction !== token) continue
        mappedKeys.add(identityKey)
        state.entry.pendingFamilyMove = {
          oldPath: state.entry.pendingFamilyMove?.oldPath ?? mapping.fromPath,
          newPath: mapping.toPath,
        }
        pendingReleases.set(identityKey, {
          path: state.entry.pendingFamilyMove.oldPath,
          writeLatest: true,
          documentId: mapping.documentId,
          fromPath: mapping.fromPath,
          toPath: mapping.toPath,
        })
      }
      for (const [identityKey, state] of held) {
        if (mappedKeys.has(identityKey)) continue
        pendingReleases.set(identityKey, {
          path: state.identity.documentPath,
          // Identity mismatch preserves the record at its old identity, but
          // transaction-time edits must also be persisted as orphan recovery.
          writeLatest: true,
          documentId: state.identity.documentId,
          fromPath: state.identity.documentPath,
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
          const release = await releaseEntry(state, deletion.documentPath, true, true)
          const status = release.status === 'failed' ? 'failed' as const : 'preserved' as const
          if (status === 'failed') alreadyFailedKeys.add(identityKey)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            // An immediate orphan write failure leaves the latest
            // snapshot only in-memory — report 'failed' (not
            // 'preserved') so the lifecycle keeps the tab open: it is
            // the only surface still holding those bytes.
            status,
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
          const release = await releaseEntry(state, deletion.documentPath, true, true)
          const status = release.status === 'failed' ? 'failed' as const : 'stale' as const
          if (status === 'failed') alreadyFailedKeys.add(identityKey)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            // The mismatch re-queues the newer snapshot as an orphan
            // immediately; if that write fails the snapshot is still
            // only in-memory — 'failed' keeps the tab open instead of
            // closing it behind a 'stale' result.
            status,
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
        // check catches them. Normalize the revision read to `null`
        // (matching `preCasRevision`) so a snapshot-less entry — e.g.
        // a conflict-only delete with no open editor — isn't falsely
        // flagged as advanced (`undefined !== null`).
        const entryAdvancedDuringAwait = entry.generation !== preCasGeneration
          || (entry.latestSnapshot?.revision ?? null) !== preCasRevision
          || entry.latestSnapshot !== preCasSnapshotRef
        if ((refinedStatus === 'deleted' || refinedStatus === 'missing')
          && !entryAdvancedDuringAwait) {
          // Truly confirmed. Clear the entry's confirmed snapshot and
          // ownership, but HOLD the file transaction until the frozen-
          // conflict cleanup AND the final re-verification below
          // complete. Releasing it here (as an earlier revision did)
          // let an edit typed during the cleanup arm a normal primary
          // debounce: the lifecycle could then close the tab before
          // the debounce fired, losing bytes that lived only in
          // coordinator memory while the identity was already reported
          // deleted.
          clearTimer(entry)
          entry.generation += 1
          entry.latestSnapshot = null
          entry.latestSnapshotNeedsWrite = false
          entry.persistedDraft = null
          entry.pendingConflictId = null
          entry.conflictCrossContextUpdatedAt = null
          // The confirmed discard also removes the conflict candidates
          // frozen at confirmation time. Without this the conflict-store
          // rows survive and resurface on the next discovery even though
          // the user confirmed deleting this identity. Track every
          // delete result: a store error leaves the row alive, and
          // reporting full success anyway would hide it behind the UI's
          // removeIdentity() until the next refresh.
          const failedConflictIds: string[] = []
          for (const conflictId of confirmation.expectedConflictIds) {
            const conflictOutcome = await store.deleteConflictDraft(
              deletion.vaultId,
              deletion.documentId,
              conflictId,
            )
            if (conflictOutcome === 'failed') failedConflictIds.push(conflictId)
          }
          // Anything still on the conflict store for this identity — a
          // frozen row whose delete failed, or a candidate recorded
          // AFTER confirmation (never frozen, intentionally surviving)
          // — must keep the identity visible. The strict read fails
          // closed on a store error: the lossy listConflictDrafts()
          // returns [] there, which would report a full delete while
          // unread survivors hide behind it until the next refresh.
          // Scoped to this identity: a same-identity row that fails
          // validation (future-version / corrupt — never freezable, so
          // it always survives the cleanup above) surfaces as
          // 'unsupported' instead of being silently filtered behind a
          // full delete, mirroring the family move's raw-row pre-flight.
          const conflictList = await store.listConflictDraftsStrict(
            deletion.vaultId,
            deletion.documentId,
          )
          // Final re-verification across the cleanup awaits. schedule()
          // still advances the entry while the transaction is held (it
          // just does not arm a timer), so a non-null snapshot here is
          // an edit made during the cleanup window. It exists only in
          // coordinator memory right now — persist it as a conflict
          // candidate BEFORE reporting anything, so the lifecycle never
          // closes the tab on unpersisted bytes.
          if (entry.latestSnapshot !== null) {
            const handoff = await persistLocalAsConflict(
              state,
              entry,
              refinedStatus,
              // The primary record was just removed by the confirmed
              // CAS — there is no cross-context source left for the
              // candidate to record a divergence from.
              null,
            )
            const status = handoff.status === 'failed' || failedConflictIds.length > 0
              ? 'failed' as const
              : 'conflict' as const
            if (status === 'failed') alreadyFailedKeys.add(identityKey)
            results.push({
              documentId: deletion.documentId,
              oldPath: deletion.documentPath,
              status,
            })
            continue
          }
          if (failedConflictIds.length > 0) {
            console.warn(`[commitDeletes] Frozen conflict delete failed for ${deletion.documentPath}: ${failedConflictIds.join(', ')}`)
            alreadyFailedKeys.add(identityKey)
            await releaseEntry(state, deletion.documentPath, false, true)
            results.push({
              documentId: deletion.documentId,
              oldPath: deletion.documentPath,
              status: 'failed',
            })
            continue
          }
          if (conflictList.status === 'failed') {
            console.warn(`[commitDeletes] Conflict store read failed for ${deletion.documentPath}; reporting failed instead of full success`)
            alreadyFailedKeys.add(identityKey)
            await releaseEntry(state, deletion.documentPath, false, true)
            results.push({
              documentId: deletion.documentId,
              oldPath: deletion.documentPath,
              status: 'failed',
            })
            continue
          }
          if (conflictList.status === 'unsupported') {
            // A future-version / corrupt conflict row for this identity
            // survived the confirmed delete — the store cannot certify
            // the conflict state is empty. Report 'unsupported' (not a
            // clean delete) so the Recovery identity stays visible and
            // the user is warned instead of the row being outlived
            // silently behind removeIdentity().
            console.warn(`[commitDeletes] Unsupported conflict row survived the confirmed delete for ${deletion.documentPath}; reporting unsupported instead of full success`)
            await releaseEntry(state, deletion.documentPath, false, true)
            results.push({
              documentId: deletion.documentId,
              oldPath: deletion.documentPath,
              status: 'unsupported',
            })
            continue
          }
          if (conflictList.records.some(
            (record) => record.documentId === deletion.documentId,
          )) {
            await releaseEntry(state, deletion.documentPath, false, true)
            results.push({
              documentId: deletion.documentId,
              oldPath: deletion.documentPath,
              status: 'conflict',
            })
            continue
          }
          await releaseEntry(state, deletion.documentPath, false, true)
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
          const release = await releaseEntry(state, deletion.documentPath, true, true)
          const status = release.status === 'failed' ? 'failed' as const : 'conflict' as const
          if (status === 'failed') alreadyFailedKeys.add(identityKey)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            // The post-CAS snapshot is re-queued as an orphan
            // immediately; if that write fails the new edit is still
            // only in-memory — 'failed' (not 'conflict') keeps the tab
            // open as the only surface still holding it.
            status,
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
          const handoff = await persistLocalAsConflict(
            state,
            entry,
            refinedStatus,
            crossContextUpdatedAt,
          )
          const status = handoff.status === 'failed' ? 'failed' as const : 'conflict' as const
          if (status === 'failed') alreadyFailedKeys.add(identityKey)
          results.push({
            documentId: deletion.documentId,
            oldPath: deletion.documentPath,
            // A failed handoff means the local content is still only
            // in-memory; surface 'failed' so the lifecycle keeps the tab
            // open instead of closing the only surface holding it.
            status,
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

    /** Seal released entries just before the lifecycle closes document
     *  tabs — as ONE batch barrier over every identity about to close.
     *  commitDeletes releases every entry when it reports, but the
     *  lifecycle still awaits Recovery synchronization before closing
     *  tabs — an edit typed during that async window arms a fresh
     *  debounce (the transaction lock is already gone) that the tab
     *  close could outrun: if that debounced write later failed, the
     *  bytes would exist nowhere visible.
     *  Phase 1 (synchronous, before ANY await): install a fresh close
     *  seal on every identity being closed and clear its timer. The
     *  seal reuses the fileTransaction mechanism — schedule() may
     *  still update a snapshot but no longer arms a timer, and flush()
     *  steps aside — so an edit typed while a SIBLING document's save
     *  is in flight cannot arm a debounce the tab close would outrun.
     *  Phase 2: persist anything still pending on the entry's active
     *  channel (conflict-pinned entries keep writing conflict records;
     *  quarantined entries route through the family-move retry), all
     *  writes in flight together.
     *  Phase 3: only AFTER every write settles, re-verify each entry
     *  against its seal-time state. An identity whose latest content
     *  was not verified durable — a rejected write, OR an edit that
     *  landed during the phase (its generation advanced / snapshot
     *  replaced / write flag still set) — returns 'failed' so the
     *  lifecycle keeps THAT tab open (the only surface still holding
     *  those bytes); releasing its seal re-arms the background retry.
     *  A verified write returns 'preserved' so the lifecycle's second
     *  synchronization pass (after the tab decision) refreshes the
     *  current Recovery identity — otherwise the panel keeps showing
     *  the pre-window record, or never sees a fresh orphan recorded
     *  after a confirmed delete. 'preserved' never warns.
     *  Identities that already reported 'failed' are never sealed:
     *  their tabs stay open regardless and their armed debounce must
     *  keep retrying in the background.
     *  The lifecycle must close tabs synchronously after this promise
     *  resolves (no await in between) so no user input event can open
     *  a new window. */
    async function finalizeBeforeDocumentClose(): Promise<DraftFileTransactionResult[]> {
      if (closeSealed) return []
      closeSealed = true
      const results: DraftFileTransactionResult[] = []
      const closeToken = Symbol('draft-close-seal')
      // Phase 1 — seal every identity being closed BEFORE any await.
      const sealed: Array<{
        identityKey: string
        state: {
          identity: DraftDocumentIdentity
          entry: DraftEntry
          confirmedDraft: UnsavedDraft | null
          preparedGeneration: number
        }
        sealedGeneration: number
        sealedSnapshot: DraftBufferSnapshot | null
        pending: boolean
        save: Promise<boolean> | null
      }> = []
      for (const [identityKey, state] of held) {
        if (alreadyFailedKeys.has(identityKey)) continue
        const { entry } = state
        if (entry.fileTransaction) continue
        clearTimer(entry)
        entry.fileTransaction = closeToken
        sealed.push({
          identityKey,
          state,
          sealedGeneration: entry.generation,
          sealedSnapshot: entry.latestSnapshot,
          pending: entry.latestSnapshot !== null && entry.latestSnapshotNeedsWrite,
          save: null,
        })
      }
      // Phase 2 — bounded saves, all in flight together (a slow
      // document must not serialize its siblings behind it).
      for (const attempt of sealed) {
        if (!attempt.pending) continue
        const { entry, identity } = attempt.state
        const latest = entry.latestSnapshot
        if (!latest) continue
        const quarantine = entry.pendingFamilyMove
        const conflictChannel = entry.pendingConflictId !== null
        const owner = {
          vaultId: identity.vaultId,
          documentId: identity.documentId,
          generation: entry.generation,
        }
        const captured = cloneSnapshot(latest)
        attempt.save = quarantine && captured.documentPath !== quarantine.oldPath
          ? queueFamilyMoveWrite(owner, captured)
          : conflictChannel
            ? queueConflictWrite(owner, captured)
            : queueWrite(owner, captured)
      }
      const saveResults = await Promise.all(sealed.map(async (attempt) => {
        if (!attempt.save) return true
        try {
          return await attempt.save
        } catch {
          return false
        }
      }))
      // Phase 3 — uniform re-verification across the WHOLE phase: the
      // latest content is certified durable only for an entry whose
      // state is exactly what the seal captured. An edit that landed
      // during a sibling's write fails closed whatever its own save
      // returned. Release every seal on the way out — it must not
      // outlive this gate.
      sealed.forEach((attempt, index) => {
        const { identityKey, state, sealedGeneration, sealedSnapshot, pending } = attempt
        const { entry, identity } = state
        const superseded = entry.generation !== sealedGeneration
          || entry.latestSnapshot !== sealedSnapshot
          || entry.latestSnapshotNeedsWrite
        const failed = superseded || (pending && !saveResults[index])
        if (entry.fileTransaction === closeToken) entry.fileTransaction = null
        if (!failed) {
          if (pending) {
            // The settlement-window edit is durable — report a
            // non-warning status so the lifecycle runs its second
            // Recovery sync after the tab decision: refreshIdentity
            // re-reads the store, so the panel shows the window edit
            // instead of the stale pre-window record (and, after a
            // confirmed delete already removed the identity, re-adds
            // the fresh orphan — otherwise invisible in the current
            // session until the next full discovery).
            // 'preserved' never warns.
            results.push({
              documentId: identity.documentId,
              oldPath: identity.documentPath,
              status: 'preserved',
            })
          }
          return
        }
        alreadyFailedKeys.add(identityKey)
        // Re-arm the background retry: the tab stays open as the
        // visible surface while the debounce persists the latest
        // snapshot on the entry's active channel.
        if (entry.latestSnapshot && entry.latestSnapshotNeedsWrite) {
          const conflictChannel = entry.pendingConflictId !== null
          const quarantine = entry.pendingFamilyMove
          entry.generation += 1
          const owner = {
            vaultId: identity.vaultId,
            documentId: identity.documentId,
            generation: entry.generation,
          }
          const captured = cloneSnapshot(entry.latestSnapshot)
          entry.timer = setTimeout(() => {
            entry.timer = null
            if (quarantine && captured.documentPath !== quarantine.oldPath) {
              void queueFamilyMoveWrite(owner, captured)
            } else if (conflictChannel) {
              void queueConflictWrite(owner, captured)
            } else {
              void queueWrite(owner, captured)
            }
          }, debounceMs)
        }
        results.push({
          documentId: identity.documentId,
          oldPath: identity.documentPath,
          status: 'failed',
        })
      })
      return results
    }

    async function finalizeAfterTabMigration(): Promise<DraftFileTransactionResult[]> {
      if (finalized) return []
      finalized = true
      const results: DraftFileTransactionResult[] = []
      for (const [identityKey, release] of pendingReleases) {
        const state = held.get(identityKey)
        if (!state) continue
        // Every pending entry MUST be released — including one the
        // commit already reported 'failed' (e.g. a failed family move).
        // Skipping the release would leave entry.fileTransaction pinned
        // to this dead barrier forever: schedule() would stop arming
        // timers, flush() would keep returning false, and pagehide /
        // dispose could never persist the entry's subsequent edits — a
        // permanent lock on exactly the tab the failure keeps open.
        const releaseResult = await releaseEntry(
          state,
          release.path,
          release.writeLatest,
          true,
        )
        if (alreadyFailedKeys.has(identityKey)) {
          // Already reported failed by the commit results — re-reporting
          // would only duplicate the user-visible warning. The release
          // above is what matters.
          continue
        }
        if (releaseResult.status === 'failed') {
          // The immediate write of the transaction-time snapshot to
          // the actual post-rename path was rejected: the latest edit
          // is still only in-memory. Report 'failed' so the lifecycle
          // merges it into the transaction results — the server rename
          // stays successful and the tab keeps its new path, but the
          // user is warned that the local draft could not be persisted
          // (a crash or refresh now could lose the transaction-time
          // edit). Never reverse the rename over a draft write failure.
          alreadyFailedKeys.add(identityKey)
          results.push({
            documentId: release.documentId,
            oldPath: release.fromPath,
            newPath: release.toPath,
            status: 'failed',
          })
        }
      }
      pendingReleases.clear()
      return results
    }

    async function rollback(): Promise<void> {
      if (settled) return
      settled = true
      for (const state of held.values()) {
        await releaseEntry(state, state.identity.documentPath, true)
      }
    }

    return {
      commitMoves,
      commitDeletes,
      finalizeBeforeDocumentClose,
      finalizeAfterTabMigration,
      rollback,
    }
  }

  function captureDeleteConfirmation(
    identity: DraftDocumentIdentity,
    revision: number,
    expectedDraft?: UnsavedDraft | null,
    expectedConflictIds?: readonly string[],
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
      // Freeze the conflict candidates present at confirmation time so a
      // confirmed discard removes exactly these (and nothing recorded
      // afterwards).
      expectedConflictIds: [...(expectedConflictIds ?? [])],
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
