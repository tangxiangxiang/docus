import {
  BOARD_ENGINE_EXCALIDRAW,
  CURRENT_BOARD_SCENE_VERSION,
  type BoardPersistentAppState,
  type BoardScene,
} from '../../shared/boardProtocol.js'
import { isAssetId } from '../../shared/assetProtocol.js'
import { BoardError } from './errors.js'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validationError(message: string): never {
  throw new BoardError('BOARD_VALIDATION_ERROR', 400, message)
}

export function assertBoardId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    validationError('Board ID must be a non-empty string')
  }
  return value as string
}

export function normalizeBoardTitle(value: unknown): string {
  if (typeof value !== 'string') validationError('Board title must be a string')
  const title = value.trim()
  if (title.length === 0) validationError('Board title must not be empty')
  return title
}

export function assertExpectedRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    validationError('Board scene revision must be a non-negative safe integer')
  }
  return value as number
}

export function assertSupportedBoardSceneContract(engine: unknown, sceneVersion: unknown): void {
  if (engine !== BOARD_ENGINE_EXCALIDRAW) {
    throw new BoardError('BOARD_SCENE_ENGINE_UNSUPPORTED', 409, `Unsupported Board engine: ${String(engine)}`)
  }
  if (sceneVersion !== CURRENT_BOARD_SCENE_VERSION) {
    throw new BoardError(
      'BOARD_SCENE_VERSION_UNSUPPORTED',
      409,
      `Unsupported Board scene version: ${String(sceneVersion)}`,
    )
  }
}

export function normalizeAssetReferences(value: unknown): string[] {
  if (!Array.isArray(value)) validationError('Board scene assetRefs must be an array')
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!isAssetId(item)) validationError('Board scene assetRefs must contain UUID Asset IDs')
    if (seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

function validateEngineData(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.elements) || !isRecord(value.fileMap)) {
    validationError('Board scene engineData has an invalid basic shape')
  }
  return value
}

function validatePersistentAppState(value: unknown): BoardPersistentAppState {
  if (!isRecord(value)) validationError('Board scene persistentAppState must be an object')
  const allowed = new Set(['zoom', 'scrollX', 'scrollY', 'gridSize', 'viewBackgroundColor'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) validationError(`Unsupported persistentAppState field: ${key}`)
  }
  for (const key of ['zoom', 'scrollX', 'scrollY']) {
    if (key in value && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) {
      validationError(`persistentAppState.${key} must be a finite number`)
    }
  }
  if ('gridSize' in value
    && value.gridSize !== null
    && (typeof value.gridSize !== 'number' || !Number.isFinite(value.gridSize))) {
    validationError('persistentAppState.gridSize must be a finite number or null')
  }
  if ('viewBackgroundColor' in value && typeof value.viewBackgroundColor !== 'string') {
    validationError('persistentAppState.viewBackgroundColor must be a string')
  }
  return value as BoardPersistentAppState
}

export function normalizeBoardScene(value: unknown): BoardScene {
  if (!isRecord(value)) validationError('Board scene must be an object')
  return {
    engineData: validateEngineData(value.engineData),
    persistentAppState: validatePersistentAppState(value.persistentAppState),
    assetRefs: normalizeAssetReferences(value.assetRefs),
  }
}

export function parseStoredBoardScene(
  engineDataJson: string,
  persistentAppStateJson: string,
  assetRefs: readonly string[],
): BoardScene {
  let engineData: unknown
  let persistentAppState: unknown
  try {
    engineData = JSON.parse(engineDataJson)
    persistentAppState = JSON.parse(persistentAppStateJson)
  } catch (error) {
    throw new BoardError('BOARD_SCENE_CORRUPT', 500, 'Board scene JSON is invalid', { cause: error })
  }

  try {
    return normalizeBoardScene({ engineData, persistentAppState, assetRefs })
  } catch (error) {
    if (error instanceof BoardError && error.code === 'BOARD_VALIDATION_ERROR') {
      throw new BoardError('BOARD_SCENE_CORRUPT', 500, error.message, { cause: error })
    }
    throw error
  }
}

/** Minimal future-version seam; V1 has no migration step yet. */
export function migrateBoardScene(sceneVersion: number, scene: BoardScene): BoardScene {
  if (sceneVersion !== CURRENT_BOARD_SCENE_VERSION) {
    throw new BoardError(
      'BOARD_SCENE_VERSION_UNSUPPORTED',
      409,
      `Unsupported Board scene version: ${String(sceneVersion)}`,
    )
  }
  return scene
}

export function serializeBoardScenePart(value: unknown, fieldName: string): string {
  try {
    const json = JSON.stringify(value)
    if (json === undefined) throw new Error(`${fieldName} serialized to undefined`)
    return json
  } catch (error) {
    throw new BoardError('BOARD_VALIDATION_ERROR', 400, `${fieldName} cannot be serialized`, { cause: error })
  }
}
