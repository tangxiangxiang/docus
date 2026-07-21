/**
 * AI live workspace context contract (Edit-10.1).
 *
 * When the user presses Send in the AI panel, the client captures ONE
 * immutable snapshot of the active workspace tab — the exact content the
 * user is looking at plus its stable same-moment identity — and that
 * snapshot (never a later re-read) is what the AI receives for the turn.
 *
 * This module is the pure contract: types + a synchronous resolver. It has
 * no Vue imports, no HTTP, no `nextTick`; Edit-10.2 wires it into
 * `VaultContext.ai.capture()` and Edit-10.3 transports it to the server.
 */

import type { ExternalChangeKind, SaveStatus } from '../../components/vault/tabs'
import type { DraftRecoveryDecisionKind } from './draft-recovery/draftRecoveryDecision'

// ─── Snapshot types (client → server wire contract, v: 1) ──────────

export interface AiDocumentContext {
  v: 1
  kind: 'document'
  capturedAt: number
  vaultId: string
  workspaceTabId: string

  /** documentId, path and raw are copied from the SAME tab snapshot. */
  identity: {
    documentId: string
    path: string
  }

  title: string
  /** Live editor buffer. The empty string is a legal body. */
  raw: string

  revision: number
  savedRevision: number
  dirty: boolean
  saveStatus: SaveStatus

  /** Present while an external change conflicts with the buffer. */
  external?: {
    kind: ExternalChangeKind
    raw: string | null
  }
}

export interface AiHistoryContext {
  v: 1
  kind: 'history'
  capturedAt: number
  vaultId: string
  workspaceTabId: string
  readOnly: true

  identity: {
    path: string
    revisionId: string
    revisionTime: number
  }

  title: string
  /** The historical revision's rawMarkdown; only sent when status is ready. */
  raw: string
}

export interface AiDiffContext {
  v: 1
  kind: 'diff'
  capturedAt: number
  vaultId: string
  workspaceTabId: string
  readOnly: true

  identity: {
    path: string
    revisionId: string
    revisionTime: number
    /** The live editor tab's documentId for the same path, or null. */
    currentDocumentId: string | null
  }

  title: string

  before: {
    raw: string
    source: 'history'
  }

  after: {
    raw: string
    source: 'live-editor' | 'comparison-snapshot'
    dirty: boolean
  }
}

export interface AiRecoveryContext {
  v: 1
  kind: 'recovery'
  capturedAt: number
  vaultId: string
  workspaceTabId: string
  readOnly: true

  /**
   * identity.documentId is the DRAFT's documentId. On identity-mismatch the
   * disk side carries its own documentId in `disk.documentId` — both are
   * preserved so the model can see that the path now belongs to someone
   * else.
   */
  identity: {
    recoveryId: string
    documentId: string
    path: string
    source: 'primary' | 'conflict'
  }

  title: string
  decisionKind: DraftRecoveryDecisionKind
  view: 'content' | 'diff'

  draft: {
    raw: string
  }

  /** Present only when the disk side was readable at tab-open time. */
  disk?: {
    documentId: string | null
    raw: string
  }
}

export type AiLiveContextSnapshot =
  | AiDocumentContext
  | AiHistoryContext
  | AiDiffContext
  | AiRecoveryContext

// ─── Capture result ────────────────────────────────────────────────

export type AiLiveContextUnavailableReason =
  | 'loading'
  | 'load-error'
  | 'missing-identity'
  | 'stale-workspace'

export type AiLiveContextCapture =
  | { status: 'ready'; context: AiLiveContextSnapshot }
  | { status: 'none' }
  | { status: 'unavailable'; reason: AiLiveContextUnavailableReason }

// ─── Resolver inputs (plain data — no reactive objects) ────────────
//
// Each source interface is a structural subset of the corresponding
// workspace type (Tab, HistorySnapshot, HistoryComparison,
// DraftRecoveryTab), so Edit-10.2's capture() can pass plain copies
// straight through without per-field mapping.

export interface AiDocumentSource {
  path: string
  documentId?: string | null
  title: string
  raw: string
  revision: number
  savedRevision: number
  saveStatus: SaveStatus
  loading: boolean
  loadError: string | null
  externalKind?: ExternalChangeKind | null
  externalRaw?: string | null
}

export interface AiHistorySource {
  tabId: string
  documentPath: string
  documentTitle: string
  revisionId: string
  revisionTime: number
  rawMarkdown: string
  status: 'loading' | 'ready' | 'error'
}

export interface AiDiffSource {
  tabId: string
  documentPath: string
  documentTitle: string
  revisionId: string
  revisionTime: number
  oldRaw: string
  newRaw: string
  currentDirty: boolean
  status: 'loading' | 'ready' | 'error'
}

export interface AiRecoverySource {
  tabId: string
  recoveryId: string
  source: 'primary' | 'conflict'
  documentId: string
  documentPath: string
  documentTitle: string
  decisionKind: DraftRecoveryDecisionKind
  diskStatus: 'ready' | 'missing' | 'unreadable'
  diskDocumentId: string | null
  view: 'content' | 'diff'
  draftRaw: string
  diskRaw: string | null
  status: 'ready' | 'error'
}

export interface AiLiveEditorDocument {
  raw: string
  dirty: boolean
  documentId: string | null
}

export interface AiLiveContextInput {
  vaultId: string | null
  activeWorkspaceTabId: string | null
  documentTabs: readonly AiDocumentSource[]
  historySnapshots: readonly AiHistorySource[]
  historyComparisons: readonly AiDiffSource[]
  recoveryTabs: readonly AiRecoverySource[]
}

export interface AiLiveContextOptions {
  now?: () => number
  /**
   * Synchronous live-editor lookup for a diff's path. When a document tab
   * for that path is loaded, the diff's after-side must be re-read from it
   * at capture time instead of the comparison's possibly stale `newRaw`.
   */
  liveDocument?: (path: string) => AiLiveEditorDocument | null
}

/**
 * Resolve the AI context for the active workspace tab.
 *
 * The resolution order mirrors the workspace activation order exactly
 * (VaultView's `activeWorkspaceTabId`):
 *
 *   active Recovery → active Diff → active History → active Document → none
 *
 * The active tab id is matched against each candidate list; this function
 * never re-derives authority from the route.
 *
 * Contract:
 *
 *   - Synchronous. Copies strings and identity fields into fresh plain
 *     objects; never returns a Vue reactive object.
 *   - Never falls back to stale content: `loading`, `loadError`, a missing
 *     documentId, or a non-ready viewer yields `unavailable`, never an
 *     older body.
 *   - `stale-workspace` means the active id matched no candidate (e.g. the
 *     tab closed between render and capture); a null vault or null active
 *     id is simply `none`.
 *
 * Dependency injection (`now`, `liveDocument`) keeps this pure and
 * testable, matching the decideDraftRecovery / createUnsavedDraftPersistence
 * house style.
 */
export function captureAiLiveContext(
  input: AiLiveContextInput,
  options: AiLiveContextOptions = {},
): AiLiveContextCapture {
  if (!input.vaultId || input.activeWorkspaceTabId === null) {
    return { status: 'none' }
  }

  const vaultId = input.vaultId
  const activeId = input.activeWorkspaceTabId
  const capturedAt = (options.now ?? (() => Date.now()))()

  // Priority 1: Recovery viewer.
  const recovery = input.recoveryTabs.find((tab) => tab.tabId === activeId)
  if (recovery) {
    if (recovery.status !== 'ready') {
      return { status: 'unavailable', reason: 'load-error' }
    }
    // Defense in depth: useDraftRecoveryTabs normalizes view on open, but
    // a diff view without a readable disk side cannot send two sides.
    const view = recovery.view === 'diff' && recovery.diskStatus !== 'ready'
      ? 'content'
      : recovery.view
    const context: AiRecoveryContext = {
      v: 1,
      kind: 'recovery',
      capturedAt,
      vaultId,
      workspaceTabId: recovery.tabId,
      readOnly: true,
      identity: {
        recoveryId: recovery.recoveryId,
        documentId: recovery.documentId,
        path: recovery.documentPath,
        source: recovery.source,
      },
      title: recovery.documentTitle,
      decisionKind: recovery.decisionKind,
      view,
      draft: { raw: recovery.draftRaw },
      ...(recovery.diskStatus === 'ready' && recovery.diskRaw !== null
        ? { disk: { documentId: recovery.diskDocumentId, raw: recovery.diskRaw } }
        : {}),
    }
    return { status: 'ready', context }
  }

  // Priority 2: Diff (history comparison) viewer.
  const comparison = input.historyComparisons.find((tab) => tab.tabId === activeId)
  if (comparison) {
    if (comparison.status === 'loading') {
      return { status: 'unavailable', reason: 'loading' }
    }
    if (comparison.status !== 'ready') {
      return { status: 'unavailable', reason: 'load-error' }
    }
    const live = options.liveDocument?.(comparison.documentPath) ?? null
    const after = live
      ? { raw: live.raw, source: 'live-editor' as const, dirty: live.dirty }
      : {
          raw: comparison.newRaw,
          source: 'comparison-snapshot' as const,
          dirty: comparison.currentDirty,
        }
    const context: AiDiffContext = {
      v: 1,
      kind: 'diff',
      capturedAt,
      vaultId,
      workspaceTabId: comparison.tabId,
      readOnly: true,
      identity: {
        path: comparison.documentPath,
        revisionId: comparison.revisionId,
        revisionTime: comparison.revisionTime,
        currentDocumentId: live?.documentId ?? null,
      },
      title: comparison.documentTitle,
      before: { raw: comparison.oldRaw, source: 'history' },
      after,
    }
    return { status: 'ready', context }
  }

  // Priority 3: History snapshot viewer.
  const snapshot = input.historySnapshots.find((tab) => tab.tabId === activeId)
  if (snapshot) {
    if (snapshot.status === 'loading') {
      return { status: 'unavailable', reason: 'loading' }
    }
    if (snapshot.status !== 'ready') {
      return { status: 'unavailable', reason: 'load-error' }
    }
    const context: AiHistoryContext = {
      v: 1,
      kind: 'history',
      capturedAt,
      vaultId,
      workspaceTabId: snapshot.tabId,
      readOnly: true,
      identity: {
        path: snapshot.documentPath,
        revisionId: snapshot.revisionId,
        revisionTime: snapshot.revisionTime,
      },
      title: snapshot.documentTitle,
      raw: snapshot.rawMarkdown,
    }
    return { status: 'ready', context }
  }

  // Priority 4: Document editor tab (id === path).
  const doc = input.documentTabs.find((tab) => tab.path === activeId)
  if (doc) {
    if (doc.loading) {
      return { status: 'unavailable', reason: 'loading' }
    }
    if (doc.loadError) {
      return { status: 'unavailable', reason: 'load-error' }
    }
    if (!doc.documentId) {
      return { status: 'unavailable', reason: 'missing-identity' }
    }
    const context: AiDocumentContext = {
      v: 1,
      kind: 'document',
      capturedAt,
      vaultId,
      workspaceTabId: doc.path,
      identity: { documentId: doc.documentId, path: doc.path },
      title: doc.title,
      raw: doc.raw,
      revision: doc.revision,
      savedRevision: doc.savedRevision,
      // revision (the in-memory buffer), never savingRevision (the
      // in-flight server write).
      dirty: doc.revision !== doc.savedRevision,
      saveStatus: doc.saveStatus,
      ...(doc.externalKind
        ? { external: { kind: doc.externalKind, raw: doc.externalRaw ?? null } }
        : {}),
    }
    return { status: 'ready', context }
  }

  return { status: 'unavailable', reason: 'stale-workspace' }
}

/**
 * Look up the live editor buffer for a path.
 *
 * Mirrors useHistoryComparisons' `getLoadedEditorDocument`, additionally
 * surfacing `documentId` so a diff context can certify which document the
 * after-side belongs to. Edit-10.2 passes this as `options.liveDocument`.
 *
 * Loading or errored tabs are NOT live documents: returning them would
 * re-introduce the stale-content fallback this contract forbids.
 */
export function liveEditorForPath(
  tabs: readonly AiDocumentSource[],
  path: string,
): AiLiveEditorDocument | null {
  const tab = tabs.find((candidate) => candidate.path === path)
  if (!tab || tab.loading || tab.loadError) return null
  return {
    raw: tab.raw,
    dirty: tab.revision !== tab.savedRevision,
    documentId: tab.documentId ?? null,
  }
}
