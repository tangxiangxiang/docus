import type { BoardScene } from '../../../../shared/boardProtocol'

/** Engine runtime data kept outside Vue's deep reactivity graph. */
export interface ExcalidrawRuntimeScene {
  readonly elements: readonly unknown[]
  readonly appState: Readonly<Record<string, unknown>>
  readonly files: Readonly<Record<string, unknown>>
}

export interface BoardEngineAdapter<TRuntimeScene = unknown> {
  hydrate(scene: BoardScene): TRuntimeScene
  serialize(runtime: TRuntimeScene): BoardScene
}

export type BoardEngineCompatibilityCode =
  | 'BOARD_ENGINE_UNSUPPORTED'
  | 'BOARD_SCENE_VERSION_UNSUPPORTED'
  | 'BOARD_SCENE_INVALID'
  | 'BOARD_ASSETS_UNSUPPORTED'

export class BoardEngineCompatibilityError extends Error {
  readonly code: BoardEngineCompatibilityCode

  constructor(code: BoardEngineCompatibilityCode, message: string) {
    super(message)
    this.name = 'BoardEngineCompatibilityError'
    this.code = code
  }
}
