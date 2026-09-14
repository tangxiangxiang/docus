import type { BoardScene } from '../../../shared/boardProtocol'

export interface BoardCheckpoint {
  boardId: string
  sceneVersion: number
  baseRevision: number
  localRevision: number
  scene: BoardScene
  savedAt: number
}

export type BoardRecoveryStatus = 'idle' | 'scheduled' | 'writing' | 'available' | 'unavailable' | 'error'

export interface BoardRecoveryState {
  readonly status: BoardRecoveryStatus
  readonly lastError: unknown | null
}
