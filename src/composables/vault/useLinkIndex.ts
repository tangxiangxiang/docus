// Client-side link index store. A module-level singleton that
// mirrors the server's `/api/links/index` snapshot, so the wiki
// link renderer can check existence and the LinksPanel can show
// outgoing links without round-tripping the server for every note.
//
// Refresh triggers:
//   - On mount (via `useLinkIndexSubscription`)
//   - On every file-change bus event, debounced 400ms. Coalesces
//     bursts of saves (e.g. AI tool calls) into a single fetch.
//
// The bus subscription is set up ONCE per vault mount, not per
// component — duplicate watchers would each trigger a refresh.
//
// Modeled on the `_liveTabs` / `_openPost` patterns in
// useEditorTabs.ts.

import { onBeforeUnmount, onMounted, shallowRef, watch, type ShallowRef } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import {
  getBacklinks,
  getLinkIndexSnapshot,
  type BacklinkRecord,
  type LinkIndexSnapshot,
} from '../../lib/api'
import { getFileChangeBus } from './useFileChangeBus.js'

// Module-level state: a single shallowRef shared by every
// component. `paths` is a Set for O(1) existence checks; `outgoing`
// is the raw wire shape (Record<source, Link[]>) so the panel can
// iterate without a second conversion pass.
export interface LinkIndexState {
  paths: Set<string>
  outgoing: Record<string, Array<{ target: string; alias?: string; anchor?: string; kind: 'wiki' | 'md' }>>
  /** Unix ms of the last successful refresh, for diagnostics. */
  lastFetched: number
}

let _state: ShallowRef<LinkIndexState> | null = null

function makeInitialState(): LinkIndexState {
  return { paths: new Set(), outgoing: {}, lastFetched: 0 }
}

export function getLinkIndex(): ShallowRef<LinkIndexState> {
  if (!_state) _state = shallowRef<LinkIndexState>(makeInitialState())
  return _state
}

/** Force a fresh fetch from `/api/links/index`. Called on mount and
 *  from the debounced bus subscriber. Errors are swallowed: a
 *  transient network failure just leaves the previous state in
 *  place; the next bus event will retry. */
export async function refreshLinkIndex(): Promise<void> {
  try {
    const snap: LinkIndexSnapshot = await getLinkIndexSnapshot()
    const next: LinkIndexState = {
      paths: new Set(snap.paths),
      outgoing: snap.outgoing,
      lastFetched: Date.now(),
    }
    // Always initialize the singleton (so a refresh called before
    // any consumer reads `getLinkIndex()` still produces state).
    getLinkIndex().value = next
  } catch {
    // ignore — keep the previous state
  }
}

/** Test-only escape hatch: drop the singleton so the next
 *  `getLinkIndex()` returns a fresh empty state. */
export function __resetLinkIndexForTesting(): void {
  _state = null
}

// --- bus subscription (one per vault mount) ---

let _subInstallCount = 0
let _activeStop: (() => void) | null = null

/** Install the file-change-bus subscription that refreshes the
 *  link index on every external change. Each call installs a
 *  fresh watch; the previous one is torn down if still active
 *  (e.g. across remounts in tests). */
export function useLinkIndexSubscription(): void {
  // Tear down any prior subscription so multiple mounts (e.g.
  // across test cases) each get their own watcher + debounce.
  if (_activeStop) {
    _activeStop()
    _activeStop = null
  }

  const bus = getFileChangeBus()
  // Debounce: a save-burst (e.g. an AI tool call) can publish
  // multiple events in a few ms. Coalesce them into one refresh.
  const debounced = useDebounceFn(() => { void refreshLinkIndex() }, 400)

  let lastSeenSeq = 0
  const stop = watch(
    () => bus.value,
    (events) => {
      const latest = events.at(-1)?.seq ?? lastSeenSeq
      if (latest <= lastSeenSeq) return
      lastSeenSeq = latest
      debounced()
    },
    { flush: 'post' },
  )

  _activeStop = () => {
    stop()
    // Cancel any pending debounced refresh so a mid-flight debounce
    // can't fire after the watch is torn down. useDebounceFn exposes
    // cancel as a property on the returned function; if the version
    // shipped with the project doesn't have it, we degrade gracefully
    // (the in-flight refresh will just no-op against a reset state).
    const d = debounced as { cancel?: () => void }
    d.cancel?.()
  }
  _subInstallCount += 1

  // First refresh: do it immediately (no debounce) so the index is
  // populated before the user opens the first note.
  onMounted(() => { void refreshLinkIndex() })

  onBeforeUnmount(() => {
    if (_activeStop) {
      _activeStop()
      _activeStop = null
    }
  })
}

/** Test-only escape hatch: reset subscription install count. */
export function __resetLinkIndexSubscriptionForTesting(): void {
  if (_activeStop) {
    _activeStop()
    _activeStop = null
  }
  _subInstallCount = 0
}

// Backlinks are NOT in the index snapshot (they'd bloat the wire
// shape for notes with many incoming links). Fetched on demand
// per-path. The LinksPanel calls this when its `path` prop changes.
export async function fetchBacklinks(path: string): Promise<BacklinkRecord[]> {
  return getBacklinks(path)
}
