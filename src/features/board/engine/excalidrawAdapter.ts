import {
  BOARD_ENGINE_EXCALIDRAW,
  CURRENT_BOARD_SCENE_VERSION,
  type BoardPersistentAppState,
  type BoardScene,
} from '../../../../shared/boardProtocol'
import {
  BoardEngineCompatibilityError,
  type BoardEngineAdapter,
  type ExcalidrawRuntimeScene,
} from './types'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPlainRecord(value: unknown): value is RecordValue {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function invalid(message: string): never {
  throw new BoardEngineCompatibilityError('BOARD_SCENE_INVALID', message)
}

function unsupportedAssets(message: string): never {
  throw new BoardEngineCompatibilityError('BOARD_ASSETS_UNSUPPORTED', message)
}

function finiteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`${field} must be a finite number`)
  return value
}

function validatePersistentAppState(value: unknown): BoardPersistentAppState {
  if (!isPlainRecord(value)) invalid('persistentAppState must be a plain object')
  const allowed = new Set(['zoom', 'scrollX', 'scrollY', 'gridSize', 'viewBackgroundColor'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`Unsupported persistentAppState field: ${key}`)
  }
  const state: BoardPersistentAppState = {}
  const zoom = finiteNumber(value.zoom, 'persistentAppState.zoom')
  const scrollX = finiteNumber(value.scrollX, 'persistentAppState.scrollX')
  const scrollY = finiteNumber(value.scrollY, 'persistentAppState.scrollY')
  const gridSize = value.gridSize
  if (zoom !== undefined) state.zoom = zoom
  if (scrollX !== undefined) state.scrollX = scrollX
  if (scrollY !== undefined) state.scrollY = scrollY
  if (gridSize !== undefined) {
    if (gridSize !== null && (typeof gridSize !== 'number' || !Number.isFinite(gridSize))) {
      invalid('persistentAppState.gridSize must be a finite number or null')
    }
    state.gridSize = gridSize as number | null
  }
  if (value.viewBackgroundColor !== undefined) {
    if (typeof value.viewBackgroundColor !== 'string') invalid('persistentAppState.viewBackgroundColor must be a string')
    state.viewBackgroundColor = value.viewBackgroundColor
  }
  return state
}

function validateScene(scene: BoardScene): {
  elements: readonly unknown[]
  fileMap: RecordValue
  persistentAppState: BoardPersistentAppState
  assetRefs: readonly string[]
} {
  if (!isRecord(scene)) invalid('Board scene must be an object')
  const engineData = scene.engineData
  if (!isPlainRecord(engineData)) invalid('engineData must be a plain object')
  if (!Array.isArray(engineData.elements)) invalid('engineData.elements must be an array')
  if (!isPlainRecord(engineData.fileMap)) invalid('engineData.fileMap must be a plain object')
  if (!Array.isArray(scene.assetRefs)) invalid('assetRefs must be an array')

  const assetRefs: string[] = []
  const seenAssetRefs = new Set<string>()
  for (const assetRef of scene.assetRefs) {
    if (typeof assetRef !== 'string' || assetRef.length === 0) invalid('assetRefs must contain non-empty strings')
    if (seenAssetRefs.has(assetRef)) invalid('assetRefs must be unique')
    seenAssetRefs.add(assetRef)
    assetRefs.push(assetRef)
  }

  const fileMap: RecordValue = {}
  const fileMapAssetRefs: string[] = []
  for (const [fileId, assetRef] of Object.entries(engineData.fileMap)) {
    if (typeof assetRef !== 'string' || assetRef.length === 0) invalid(`fileMap.${fileId} must be a non-empty Asset ID`)
    fileMap[fileId] = assetRef
    if (!fileMapAssetRefs.includes(assetRef)) fileMapAssetRefs.push(assetRef)
  }
  if (fileMapAssetRefs.length !== assetRefs.length || fileMapAssetRefs.some((assetRef) => !seenAssetRefs.has(assetRef))) {
    invalid('assetRefs must equal the unique values of engineData.fileMap')
  }

  return {
    elements: engineData.elements,
    fileMap,
    persistentAppState: validatePersistentAppState(scene.persistentAppState),
    assetRefs,
  }
}

function runtimeNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (isRecord(value) && typeof value.value === 'number' && Number.isFinite(value.value)) return value.value
  invalid(`${field} must be a finite number or a runtime zoom object`)
}

function persistentAppStateFromRuntime(value: unknown): BoardPersistentAppState {
  if (!isPlainRecord(value)) invalid('runtime appState must be a plain object')
  const state: BoardPersistentAppState = {}
  const zoom = runtimeNumber(value.zoom, 'runtime appState.zoom')
  const scrollX = finiteNumber(value.scrollX, 'runtime appState.scrollX')
  const scrollY = finiteNumber(value.scrollY, 'runtime appState.scrollY')
  const gridSize = value.gridSize
  if (zoom !== undefined) state.zoom = zoom
  if (scrollX !== undefined) state.scrollX = scrollX
  if (scrollY !== undefined) state.scrollY = scrollY
  if (gridSize !== undefined) {
    if (gridSize !== null && (typeof gridSize !== 'number' || !Number.isFinite(gridSize))) {
      invalid('runtime appState.gridSize must be a finite number or null')
    }
    state.gridSize = gridSize as number | null
  }
  if (value.viewBackgroundColor !== undefined) {
    if (typeof value.viewBackgroundColor !== 'string') invalid('runtime appState.viewBackgroundColor must be a string')
    state.viewBackgroundColor = value.viewBackgroundColor
  }
  return state
}

function containsImage(elements: readonly unknown[]): boolean {
  return elements.some((element) => isRecord(element) && element.type === 'image')
}

export function assertSupportedExcalidrawScene(engine: unknown, sceneVersion: unknown): void {
  if (engine !== BOARD_ENGINE_EXCALIDRAW) {
    throw new BoardEngineCompatibilityError('BOARD_ENGINE_UNSUPPORTED', `Unsupported Board engine: ${String(engine)}`)
  }
  if (sceneVersion !== CURRENT_BOARD_SCENE_VERSION) {
    throw new BoardEngineCompatibilityError(
      'BOARD_SCENE_VERSION_UNSUPPORTED',
      `Unsupported Board scene version: ${String(sceneVersion)}`,
    )
  }
}

export const excalidrawAdapter: BoardEngineAdapter<ExcalidrawRuntimeScene> = {
  hydrate(scene) {
    const validated = validateScene(scene)
    if (validated.assetRefs.length > 0 || Object.keys(validated.fileMap).length > 0) {
      unsupportedAssets('Board images and assets are not available before B7')
    }
    if (containsImage(validated.elements)) unsupportedAssets('Board image elements are not available before B7')

    const appState: Record<string, unknown> = {}
    if (validated.persistentAppState.zoom !== undefined) {
      // Excalidraw 0.18.1 represents zoom as { value }, while the Docus
      // domain intentionally stores the portable numeric value.
      appState.zoom = { value: validated.persistentAppState.zoom }
    }
    for (const key of ['scrollX', 'scrollY', 'gridSize', 'viewBackgroundColor'] as const) {
      const value = validated.persistentAppState[key]
      if (value !== undefined) appState[key] = value
    }
    return {
      elements: [...validated.elements],
      appState,
      files: {},
    }
  },

  serialize(runtime) {
    if (!isRecord(runtime)) invalid('runtime scene must be an object')
    if (!Array.isArray(runtime.elements)) invalid('runtime elements must be an array')
    if (!isPlainRecord(runtime.files)) invalid('runtime files must be a plain object')
    if (Object.keys(runtime.files).length > 0 || containsImage(runtime.elements)) {
      unsupportedAssets('Board images and assets are not available before B7')
    }
    return {
      engineData: {
        elements: [...runtime.elements],
        fileMap: {},
      },
      persistentAppState: persistentAppStateFromRuntime(runtime.appState),
      assetRefs: [],
    }
  },
}
