// Module-level pub-sub for "a file in the workspace just changed
// externally" notifications. Modeled on the `_liveTabs` pattern in
// useEditorTabs.ts — a singleton shallowRef + test escape hatches.
//
// The publisher is the AI panel's event handler: when a
// `file_changed` SSE event arrives, the orchestrator's bus
// consumer watches it and refreshes any open tab whose path
// matches. The current-note composable also subscribes so the
// next AI turn sees the AI's edits without the model having to
// re-read.
//
// Each event gets a monotonically-increasing `seq` so a consumer
// that joins mid-stream can fast-forward past already-seen events.

import { shallowRef, type ShallowRef } from 'vue'
import type { FileChangeEvent, FileChangeKind } from '../../lib/ai-api'

// Re-export the wire shape with a required `seq` for in-process
// ordering. The wire SSE event has no `seq`; the publisher adds it
// on arrival.
export type InternalFileChangeEvent = FileChangeEvent & { seq: number }

// The bus is a module-level stable ref (created eagerly at module
// load). This way consumers can `watch(() => bus.value, ...)` from
// day one and have a working dep — a lazy-created ref would not be
// tracked by watchers that were set up before the first publish.
const _bus: ShallowRef<InternalFileChangeEvent[]> = shallowRef([])
let _seq = 0
let _seenSeqByConsumer = new WeakMap<object, number>()

/**
 * Publish a file-change event. The event is appended to the bus
 * ref (one shallowRef mutation per call) with a fresh `seq`. Any
 * watcher of the bus sees the new event.
 */
export function publishFileChange(event: FileChangeEvent): void {
  _seq += 1
  _bus.value = [..._bus.value, { ...event, seq: _seq }]
}

/**
 * Get the live bus ref. Always non-null — the ref is created at
 * module load so consumers can subscribe even before the first
 * publish.
 */
export function getFileChangeBus(): ShallowRef<InternalFileChangeEvent[]> {
  return _bus
}

/**
 * Mark a consumer (by key object) as having seen events up to the
 * given seq. Consumers can use this to skip events they've already
 * processed in a prior session/turn. The default per-call dedup
 * (handled in `consumeNewEvents`) is good enough for v1; this is
 * a public API in case a future consumer needs it.
 */
export function markConsumerSeen(key: object, seq: number): void {
  _seenSeqByConsumer.set(key, seq)
}

export function getConsumerSeen(key: object): number {
  return _seenSeqByConsumer.get(key) ?? 0
}

// Test escape hatches. Same pattern as useEditorTabs.ts so tests
// can reset state between cases.

/** Reset the bus (clear events + seq). For tests. */
export function __resetFileChangeBusForTesting(): void {
  _seq = 0
  _bus.value = []
  _seenSeqByConsumer = new WeakMap()
}

// Kind union re-export so consumers don't have to import from
// `ai-api` for this enum.
export type { FileChangeKind }
