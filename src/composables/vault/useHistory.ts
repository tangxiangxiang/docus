// History state + actions. Each VaultContext owns one instance so the side
// panel, activity-bar dirty badge, and main DiffView in that vault share
// state without leaking it to another vault. Persistence is server-side (the
// `git` CLI under the hood); this composable is a thin read-through
// cache + the action helpers that drive it.
//
// The "dirty" ref is reactive: ActivityBar.vue can read it directly
// to render the small count badge next to the History button. It is
// recomputed from `status()` and updates whenever the file-change
// Vault file-change capability publishes an event (see the subscription
// at the bottom of this file).
//
// `selectedFile` and `selectedOldRef` / `selectedNewRef` drive the
// DiffView. They are reset to a sensible default (current active
// tab vs HEAD) by the HistoryPanel on mount; the user can then
// click any commit to make it the new "old" or "new" side.
//
// A note on caching: `log()` is reloaded only on user action (a
// commit, or a panel open with stale data). We don't poll — git is
// fast enough to query on demand and the timeline doesn't need to
// be live.

import { ref, computed, watch, type Ref } from 'vue'
import * as api from '../../lib/history-api.js'
import type {
  Capability,
  StatusEntry,
  CommitRecord,
  FileDiff,
  CommitResult,
} from '../../lib/history-api.js'
import type { VaultContext } from './context/types'
import { getFallbackVaultFileChanges, type VaultFileChanges } from './context/fileChanges'
import { useOptionalVaultContext } from './context/useVaultContext'

export interface HistoryState {
  // raw state
  capability: Ref<Capability | null>
  status: Ref<StatusEntry[]>
  log: Ref<CommitRecord[]>
  logLoading: Ref<boolean>
  logLoaded: Ref<boolean>
  available: Ref<boolean>

  // Busy is shared within one Vault because it gates its mutations. Errors are scoped so
  // a failed diff never appears under the commit timeline (and vice versa).
  busy: Ref<boolean>
  diffError: Ref<string | null>
  actionError: Ref<string | null>

  // selection — drives the DiffView
  selectedFile: Ref<string | null>
  selectedOldRef: Ref<string>
  selectedNewRef: Ref<string>
  currentDiff: Ref<FileDiff | null>

  // UI-only draft state (not persisted, not sent to server until
  // the user clicks Commit). Lives on the vault history instance so the composer
  // and the commit button in the same panel see the same value,
  // and so navigating away and back doesn't lose what the user
  // typed.
  commitMessage: Ref<string>

  // derived
  dirtyCount: Ref<number>

  // actions
  refreshCapability(): Promise<void>
  refreshStatus(): Promise<void>
  refreshLog(opts?: { path?: string }): Promise<void>
  selectFile(path: string, opts?: { oldRef?: string; newRef?: string }): Promise<void>
  loadDiffForSelection(): Promise<void>
  createCommit(paths: string[], message: string): Promise<CommitResult | null>
  dropCommit(sha: string): Promise<CommitResult | null>
  // Restore a file's on-disk content to its blob at `ref`. After
  // success, status is reloaded and a file-change event is fired so
  // any open editor tab sees the new content. Returns false on
  // failure (the error is on `actionError`).
  restoreFile(path: string, ref: string): Promise<boolean>
  // Toggle a dirty file in/out of the next commit. `paths` is the
  // caller's working set; we just flip membership in it.
  toggleDirty(path: string, selected: Set<string>): void
}

interface HistoryInstance {
  use(): HistoryState
  reset(): void
}

function createHistoryInstance(fileChanges: VaultFileChanges): HistoryInstance {

const _capability = ref<Capability | null>(null)
const _status = ref<StatusEntry[]>([])
const _log = ref<CommitRecord[]>([])
const _logLoading = ref(false)
const _logLoaded = ref(false)
const _busy = ref(false)
const _diffError = ref<string | null>(null)
const _actionError = ref<string | null>(null)
const _selectedFile = ref<string | null>(null)
const _selectedOldRef = ref<string>('HEAD')
const _selectedNewRef = ref<string>('HEAD')
const _currentDiff = ref<FileDiff | null>(null)
const _commitMessage = ref('')
const _available = ref(false)
let _hydrated = false
let _fileChangeUnsub: (() => void) | null = null
let _lastSeenFileChangeSeq = 0
let _pendingOperations = 0
let _diffRequestId = 0

function beginBusy(): void {
  _pendingOperations++
  _busy.value = true
}

function endBusy(): void {
  _pendingOperations = Math.max(0, _pendingOperations - 1)
  _busy.value = _pendingOperations > 0
}

async function refreshCapability(): Promise<void> {
  try {
    const c = await api.getCapability()
    _capability.value = c
    _available.value = c.gitAvailable
  } catch (e: any) {
    _capability.value = { gitAvailable: false, repoInitialized: false }
    _available.value = false
    _actionError.value = e?.message ?? 'capability probe failed'
  }
}

async function refreshStatus(): Promise<void> {
  try {
    const r = await api.getStatus()
    _status.value = r.dirty
    _available.value = r.available
  } catch (e: any) {
    _status.value = []
    _available.value = false
    _actionError.value = e?.message ?? 'status failed'
  }
}

async function refreshLog(opts: { path?: string } = {}): Promise<void> {
  _logLoading.value = true
  try {
    const r = await api.getLog({ path: opts.path, limit: 200 })
    // Default to [] if the server's body is missing `commits` for any
    // reason (older version, partial migration, etc.) — the template
    // reads `h.log.value.length` and would otherwise crash on
    // `undefined.length`. `getLog` already throws on non-2xx so we
    // only land here on a 200 with a usable body; this guard is for
    // shape drift, not transport errors.
    _log.value = Array.isArray(r?.commits) ? r.commits : []
  } catch (e: any) {
    _log.value = []
    _actionError.value = e?.message ?? 'log failed'
  } finally {
    _logLoading.value = false
    _logLoaded.value = true
  }
}

async function selectFile(path: string, opts: { oldRef?: string; newRef?: string } = {}): Promise<void> {
  _selectedFile.value = path
  if (opts.oldRef !== undefined) _selectedOldRef.value = opts.oldRef
  if (opts.newRef !== undefined) _selectedNewRef.value = opts.newRef
  // Reset the cached diff; the panel will re-fetch via loadDiffForSelection.
  _currentDiff.value = null
  await loadDiffForSelection()
}

async function loadDiffForSelection(): Promise<void> {
  const path = _selectedFile.value
  if (!path) {
    _currentDiff.value = null
    return
  }
  const oldRef = _selectedOldRef.value
  const newRef = _selectedNewRef.value
  const requestId = ++_diffRequestId
  beginBusy()
  try {
    const r = await api.getDiff(path, oldRef, newRef)
    if (requestId !== _diffRequestId) return
    _currentDiff.value = r.diff
    _diffError.value = null
  } catch (e: any) {
    if (requestId !== _diffRequestId) return
    _currentDiff.value = null
    _diffError.value = e?.message ?? 'diff failed'
  } finally {
    endBusy()
  }
}

async function createCommit(paths: string[], message: string): Promise<CommitResult | null> {
  if (paths.length === 0) {
    _actionError.value = 'select at least one file'
    return null
  }
  if (message.trim().length === 0) {
    _actionError.value = 'message must not be empty'
    return null
  }
  beginBusy()
  try {
    const r = await api.createCommit(paths, message)
    _actionError.value = null
    // The commit touched these files on disk; notify the file-change
    // bus so any open editor tab refreshes. The mtime is irrelevant
    // here — the bus is purely a "something changed" signal.
    for (const p of paths) {
      fileChanges.publish({
        path: p,
        kind: 'write',
        newMtime: Date.now(),
        newRaw: undefined,
      })
    }
    // Refresh status (those paths are now clean) + log (new commit
    // at the top) in parallel.
    await Promise.all([refreshStatus(), refreshLog()])
    return r
  } catch (e: any) {
    _actionError.value = e?.message ?? 'commit failed'
    // A 409 commonly means the panel's selection became stale while it was
    // open. Reconcile the Changes list immediately so clean/restored paths
    // disappear and the user can retry the remaining dirty selection.
    await refreshStatus()
    return null
  } finally {
    endBusy()
  }
}

async function dropCommit(sha: string): Promise<CommitResult | null> {
  beginBusy()
  try {
    const r = await api.dropCommit(sha)
    _actionError.value = null
    for (const p of r.filesCommitted) {
      fileChanges.publish({
        path: p,
        kind: 'write',
        newMtime: Date.now(),
        newRaw: undefined,
      })
    }
    await Promise.all([refreshStatus(), refreshLog()])
    return r
  } catch (e: any) {
    _actionError.value = e?.message ?? 'drop failed'
    return null
  } finally {
    endBusy()
  }
}

function toggleDirty(path: string, selected: Set<string>): void {
  if (selected.has(path)) selected.delete(path)
  else selected.add(path)
}

/**
 * Overwrite the on-disk copy of `path` with the blob at `ref`. After
 * success, fires a file-change event so any open editor tab refreshes
 * (the editor reads the file from disk on its own tab-self-save
 * callback) and refreshes status so the dirty list reflects the new
 * state. Does NOT commit — the user is meant to review the diff, then
 * commit via the normal composer flow.
 */
async function restoreFile(path: string, ref: string): Promise<boolean> {
  beginBusy()
  try {
    await api.restoreFile(path, ref)
    _actionError.value = null
    // Tell the file-change bus something changed on disk. The bus
    // doesn't carry the new content — the editor tab that owns the
    // file will re-read it from disk on the next self-save tick.
    fileChanges.publish({
      path,
      kind: 'write',
      newMtime: Date.now(),
      newRaw: undefined,
    })
    await refreshStatus()
    // If the diff view was showing this file, reload it — after
    // restore the old/new refs might compare the new content (which
    // is now the same as what was at `ref`), so the user sees the
    // diff collapse to "no changes". They can pick a new pair.
    if (_selectedFile.value === path) {
      await loadDiffForSelection()
    }
    return true
  } catch (e: any) {
    _actionError.value = e?.message ?? 'restore failed'
    return false
  } finally {
    endBusy()
  }
}

const dirtyCount = computed(() => _status.value.length)

function use(): HistoryState {
  if (!_hydrated) {
    _hydrated = true
    // Fire-and-forget the initial probe. The UI can render
    // "checking…" while it resolves. We do this in setup rather
    // than module-load so the SSR-like first paint isn't blocked
    // on the network.
    void refreshCapability().then(() => {
      if (_available.value) {
        void refreshStatus()
        void refreshLog()
      }
    })
    // Subscribe once to the file-change bus so any external save
    // (an editor tab's self-save, a rename, etc.) re-polls git
    // status. This keeps the dirty badge live without a polling
    // timer. We use `watch` on the bus ref + a `seq` cursor to
    // dedup — if the user has a HistoryPanel open and switches
    // files, the editor will publish file-change events that we
    // also want to ignore once we've processed them. Each event
    // has a unique `seq` assigned by VaultFileChanges.publish()
    // so we track the last one we acted on.
    if (!_fileChangeUnsub) {
      _lastSeenFileChangeSeq = 0
      const stop = watch(
        () => fileChanges.events.value,
        (events) => {
          if (!_available.value) return
          for (const ev of events) {
            if (ev.seq <= _lastSeenFileChangeSeq) continue
            _lastSeenFileChangeSeq = ev.seq
            void refreshStatus()
          }
        },
        { flush: 'post' },
      )
      _fileChangeUnsub = stop
    }
  }

  return {
    capability: _capability,
    status: _status,
    log: _log,
    logLoading: _logLoading,
    logLoaded: _logLoaded,
    available: _available,
    busy: _busy,
    diffError: _diffError,
    actionError: _actionError,
    selectedFile: _selectedFile,
    selectedOldRef: _selectedOldRef,
    selectedNewRef: _selectedNewRef,
    currentDiff: _currentDiff,
    commitMessage: _commitMessage,
    dirtyCount,
    refreshCapability,
    refreshStatus,
    refreshLog,
    selectFile,
    loadDiffForSelection,
    createCommit,
    dropCommit,
    restoreFile,
    toggleDirty,
  }
}

/** Test-only reset. Restores the legacy fallback refs to their defaults
 *  and unsubscribes the file-change listener so the next test
 *  gets a clean slate. */
function reset(): void {
  _capability.value = null
  _status.value = []
  _log.value = []
  _logLoading.value = false
  _logLoaded.value = false
  _busy.value = false
  _diffError.value = null
  _actionError.value = null
  _selectedFile.value = null
  _selectedOldRef.value = 'HEAD'
  _selectedNewRef.value = 'HEAD'
  _currentDiff.value = null
  _commitMessage.value = ''
  _pendingOperations = 0
  _diffRequestId = 0
  _available.value = false
  _hydrated = false
  _lastSeenFileChangeSeq = 0
  if (_fileChangeUnsub) {
    _fileChangeUnsub()
    _fileChangeUnsub = null
  }
}

  return { use, reset }
}

const historyByVault = new WeakMap<VaultContext, HistoryInstance>()
let legacyOwner: VaultFileChanges | null = null
let legacyHistory: HistoryInstance | null = null

function getLegacyHistory(): HistoryInstance {
  const owner = getFallbackVaultFileChanges()
  if (!legacyHistory || legacyOwner !== owner) {
    legacyHistory?.reset()
    legacyOwner = owner
    legacyHistory = createHistoryInstance(owner)
  }
  return legacyHistory
}

export function useHistory(): HistoryState {
  const context = useOptionalVaultContext()
  if (!context) return getLegacyHistory().use()

  let history = historyByVault.get(context)
  if (!history) {
    history = createHistoryInstance(context.fileChanges)
    historyByVault.set(context, history)
  }
  return history.use()
}

export function __resetHistoryStateForTesting(): void {
  legacyHistory?.reset()
  legacyHistory = null
  legacyOwner = null
}
