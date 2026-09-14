import type { BoardScene } from '../../../shared/boardProtocol'
import type { BoardCheckpointStore } from './checkpointStore'
import type { BoardCheckpoint, BoardRecoveryState } from './recoveryTypes'

export interface BoardCheckpointSchedulerOptions<TRuntimeScene> {
  boardId: string
  sceneVersion: number
  initialRuntimeScene: TRuntimeScene
  initialLocalRevision?: number
  initialBaseRevision?: number
  serialize: (runtimeScene: TRuntimeScene) => BoardScene
  store: BoardCheckpointStore
  debounceMs?: number
  now?: () => number
  onStateChange?: (state: BoardRecoveryState) => void
}

export interface BoardCheckpointSaveSucceeded {
  revision: number
  savedLocalRevision: number
  currentLocalRevision: number
}

export interface BoardCheckpointScheduler<TRuntimeScene> {
  schedule(runtimeScene: TRuntimeScene, localRevision: number, baseRevision: number): void
  onServerSaveSucceeded(event: BoardCheckpointSaveSucceeded): void
  dispose(): void
  getSnapshot(): BoardRecoveryState
}

type PendingOperation =
  | { kind: 'put'; checkpoint: BoardCheckpoint }
  | { kind: 'delete' }

export function createBoardCheckpointScheduler<TRuntimeScene>(
  options: BoardCheckpointSchedulerOptions<TRuntimeScene>,
): BoardCheckpointScheduler<TRuntimeScene> {
  const debounceMs = options.debounceMs ?? 250
  const now = options.now ?? Date.now
  let latestRuntimeScene = options.initialRuntimeScene
  let currentLocalRevision = options.initialLocalRevision ?? 0
  let baseRevision = options.initialBaseRevision ?? 0
  let checkpointRequested = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let queued: PendingOperation | null = null
  let disposed = false
  let state: BoardRecoveryState = { status: 'idle', lastError: null }

  function publish(nextState: BoardRecoveryState): void {
    state = nextState
    if (!disposed) options.onStateChange?.(state)
  }

  function clearTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function latestCheckpoint(): BoardCheckpoint {
    return {
      boardId: options.boardId,
      sceneVersion: options.sceneVersion,
      baseRevision,
      localRevision: currentLocalRevision,
      scene: options.serialize(latestRuntimeScene),
      savedAt: now(),
    }
  }

  async function pump(): Promise<void> {
    if (disposed || inFlight || !queued) return
    const operation = queued
    queued = null
    inFlight = true
    publish({ status: operation.kind === 'put' ? 'writing' : 'writing', lastError: null })
    try {
      if (operation.kind === 'put') await options.store.put(operation.checkpoint)
      else await options.store.delete(options.boardId)
      publish({ status: operation.kind === 'put' ? 'available' : 'idle', lastError: null })
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code
      publish({
        status: code === 'BOARD_RECOVERY_UNAVAILABLE' ? 'unavailable' : 'error',
        lastError: error,
      })
    } finally {
      inFlight = false
      if (disposed) return
      if (checkpointRequested && operation.kind === 'put'
        && (operation.checkpoint.localRevision !== currentLocalRevision
          || operation.checkpoint.baseRevision !== baseRevision)) {
        enqueueLatestPut()
      } else if (checkpointRequested && operation.kind === 'delete') {
        enqueueLatestPut()
      }
      void pump()
    }
  }

  function enqueueLatestPut(): void {
    try {
      queued = { kind: 'put', checkpoint: latestCheckpoint() }
      void pump()
    } catch (error) {
      publish({ status: 'error', lastError: error })
    }
  }

  function capture(): void {
    timer = null
    if (disposed || !checkpointRequested) return
    try {
      enqueueLatestPut()
    } catch (error) {
      publish({ status: 'error', lastError: error })
    }
  }

  function schedule(runtimeScene: TRuntimeScene, localRevision: number, nextBaseRevision: number): void {
    if (disposed) return
    latestRuntimeScene = runtimeScene
    currentLocalRevision = localRevision
    baseRevision = nextBaseRevision
    checkpointRequested = true
    clearTimer()
    publish({ status: 'scheduled', lastError: null })
    timer = setTimeout(capture, debounceMs)
  }

  function onServerSaveSucceeded(event: BoardCheckpointSaveSucceeded): void {
    if (disposed) return
    baseRevision = event.revision
    currentLocalRevision = Math.max(currentLocalRevision, event.currentLocalRevision)
    clearTimer()
    if (event.savedLocalRevision >= event.currentLocalRevision) {
      checkpointRequested = false
      queued = { kind: 'delete' }
      void pump()
      return
    }
    checkpointRequested = true
    enqueueLatestPut()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearTimer()
    queued = null
  }

  return {
    schedule,
    onServerSaveSucceeded,
    dispose,
    getSnapshot: () => state,
  }
}
