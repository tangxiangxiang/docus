// History state + actions. Module-level singleton so the side
// panel, the activity-bar dirty badge, and the main DiffView all
// share the same in-memory state. Persistence is server-side (the
// `git` CLI under the hood); this composable is a thin read-through
// cache + the action helpers that drive it.
//
// The "dirty" ref is reactive: ActivityBar.vue can read it directly
// to render the small count badge next to the History button. It is
// recomputed from `status()` and updates whenever the file-change
// bus publishes an event (see the `useFileChangeBus` subscription
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
import { publishFileChange, getFileChangeBus } from './useFileChangeBus.js'

export interface HistoryState {
  // raw state
  capability: Ref<Capability | null>
  status: Ref<StatusEntry[]>
  log: Ref<CommitRecord[]>
  available: Ref<boolean>

  // busy / error
  busy: Ref<boolean>
  error: Ref<string | null>

  // selection — drives the DiffView
  selectedFile: Ref<string | null>
  selectedOldRef: Ref<string>
  selectedNewRef: Ref<string>
  currentDiff: Ref<FileDiff | null>

  // UI-only draft state (not persisted, not sent to server until
  // the user clicks Commit). Lives on the singleton so the composer
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
  // Restore a file's on-disk content to its blob at `ref`. After
  // success, status is reloaded and a file-change event is fired so
  // any open editor tab sees the new content. Returns false on
  // failure (the error is on `error`).
  restoreFile(path: string, ref: string): Promise<boolean>
  // Toggle a dirty file in/out of the next commit. `paths` is the
  // caller's working set; we just flip membership in it.
  toggleDirty(path: string, selected: Set<string>): void
}

// --- module-level singletons ----------------------------------------------

const _capability = ref<Capability | null>(null)
const _status = ref<StatusEntry[]>([])
const _log = ref<CommitRecord[]>([])
const _busy = ref(false)
const _error = ref<string | null>(null)
const _selectedFile = ref<string | null>(null)
const _selectedOldRef = ref<string>('HEAD')
const _selectedNewRef = ref<string>('HEAD')
const _currentDiff = ref<FileDiff | null>(null)
const _commitMessage = ref('')
const _available = ref(false)
let _hydrated = false
let _fileChangeUnsub: (() => void) | null = null
let _lastSeenFileChangeSeq = 0

async function refreshCapability(): Promise<void> {
  try {
    const c = await api.getCapability()
    _capability.value = c
    _available.value = c.gitAvailable
  } catch (e: any) {
    _capability.value = { gitAvailable: false, repoInitialized: false }
    _available.value = false
    _error.value = e?.message ?? 'capability probe failed'
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
    _error.value = e?.message ?? 'status failed'
  }
}

async function refreshLog(opts: { path?: string } = {}): Promise<void> {
  try {
    const r = await api.getLog({ path: opts.path, limit: 200 })
    _log.value = r.commits
  } catch (e: any) {
    _log.value = []
    _error.value = e?.message ?? 'log failed'
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
  _busy.value = true
  try {
    const r = await api.getDiff(path, _selectedOldRef.value, _selectedNewRef.value)
    _currentDiff.value = r.diff
    _error.value = null
  } catch (e: any) {
    _currentDiff.value = null
    _error.value = e?.message ?? 'diff failed'
  } finally {
    _busy.value = false
  }
}

async function createCommit(paths: string[], message: string): Promise<CommitResult | null> {
  if (paths.length === 0) {
    _error.value = 'select at least one file'
    return null
  }
  if (message.trim().length === 0) {
    _error.value = 'message must not be empty'
    return null
  }
  _busy.value = true
  try {
    const r = await api.createCommit(paths, message)
    _error.value = null
    // The commit touched these files on disk; notify the file-change
    // bus so any open editor tab refreshes. The mtime is irrelevant
    // here — the bus is purely a "something changed" signal.
    for (const p of paths) {
      publishFileChange({
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
    _error.value = e?.message ?? 'commit failed'
    return null
  } finally {
    _busy.value = false
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
  _busy.value = true
  try {
    await api.restoreFile(path, ref)
    _error.value = null
    // Tell the file-change bus something changed on disk. The bus
    // doesn't carry the new content — the editor tab that owns the
    // file will re-read it from disk on the next self-save tick.
    publishFileChange({
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
    _error.value = e?.message ?? 'restore failed'
    return false
  } finally {
    _busy.value = false
  }
}

const dirtyCount = computed(() => _status.value.length)

export function useHistory(): HistoryState {
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
    // has a unique `seq` (see useFileChangeBus.publishFileChange)
    // so we track the last one we acted on.
    if (!_fileChangeUnsub) {
      _lastSeenFileChangeSeq = 0
      const stop = watch(
        () => getFileChangeBus().value,
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
    available: _available,
    busy: _busy,
    error: _error,
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
    restoreFile,
    toggleDirty,
  }
}

/** Test-only reset. Restores the singleton refs to their defaults
 *  and unsubscribes the file-change listener so the next test
 *  gets a clean slate. */
export function __resetHistoryStateForTesting(): void {
  _capability.value = null
  _status.value = []
  _log.value = []
  _busy.value = false
  _error.value = null
  _selectedFile.value = null
  _selectedOldRef.value = 'HEAD'
  _selectedNewRef.value = 'HEAD'
  _currentDiff.value = null
  _commitMessage.value = ''
  _available.value = false
  _hydrated = false
  _lastSeenFileChangeSeq = 0
  if (_fileChangeUnsub) {
    _fileChangeUnsub()
    _fileChangeUnsub = null
  }
}
