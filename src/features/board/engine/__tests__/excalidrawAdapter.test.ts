import { describe, expect, it } from 'vitest'
import {
  assertSupportedExcalidrawScene,
  excalidrawAdapter,
  runtimePersistenceFingerprint,
} from '../excalidrawAdapter'
import { BoardEngineCompatibilityError } from '../types'
import {
  BOARD_ENGINE_EXCALIDRAW,
  CURRENT_BOARD_SCENE_VERSION,
  type BoardScene,
} from '../../../../../shared/boardProtocol'

function scene(overrides: Partial<BoardScene> = {}): BoardScene {
  return {
    engineData: { elements: [], fileMap: {} },
    persistentAppState: {
      zoom: 0.8,
      scrollX: 12,
      scrollY: -4,
      gridSize: null,
      viewBackgroundColor: '#fff',
    },
    assetRefs: [],
    ...overrides,
  }
}

function expectCompatibility(action: () => unknown, code: BoardEngineCompatibilityError['code']): void {
  expect(action).toThrow(BoardEngineCompatibilityError)
  try {
    action()
  } catch (error) {
    expect(error).toMatchObject({ code })
  }
}

describe('excalidrawAdapter', () => {
  it('hydrates the portable empty scene and maps numeric zoom to Excalidraw runtime shape', () => {
    expect(excalidrawAdapter.hydrate(scene())).toEqual({
      elements: [],
      appState: {
        zoom: { value: 0.8 },
        scrollX: 12,
        scrollY: -4,
        gridSize: null,
        viewBackgroundColor: '#fff',
      },
      files: {},
    })
  })

  it('serializes only the domain-owned app state whitelist', () => {
    expect(excalidrawAdapter.serialize({
      elements: [{ id: 'rectangle-1', type: 'rectangle', version: 2 }],
      appState: {
        zoom: { value: 0.75 },
        scrollX: 10,
        scrollY: 20,
        gridSize: 8,
        viewBackgroundColor: '#eee',
        selectedElementIds: { 'rectangle-1': true },
        collaborators: {},
      },
      files: {},
    })).toEqual({
      engineData: {
        elements: [{ id: 'rectangle-1', type: 'rectangle', version: 2 }],
        fileMap: {},
      },
      persistentAppState: {
        zoom: 0.75,
        scrollX: 10,
        scrollY: 20,
        gridSize: 8,
        viewBackgroundColor: '#eee',
      },
      assetRefs: [],
    })
  })

  it('ignores Excalidraw default app state when fingerprinting initial hydration', () => {
    expect(runtimePersistenceFingerprint({ elements: [], appState: {}, files: {} }))
      .toBe(runtimePersistenceFingerprint({
        elements: [],
        appState: {
          zoom: { value: 1 },
          scrollX: 0,
          scrollY: 0,
          gridSize: 20,
          viewBackgroundColor: '#ffffff',
          selectedElementIds: { shape: true },
        },
        files: {},
      }))
  })

  it.each([
    ['null engineData', { engineData: null }],
    ['invalid elements', { engineData: { elements: {}, fileMap: {} } }],
    ['invalid fileMap', { engineData: { elements: [], fileMap: [] } }],
    ['asset mismatch', { engineData: { elements: [], fileMap: { file: 'asset-1' } }, assetRefs: [] }],
  ])('fails closed for %s', (_label, overrides) => {
    expectCompatibility(() => excalidrawAdapter.hydrate(scene(overrides)), 'BOARD_SCENE_INVALID')
  })

  it('fails closed for asset-backed or image scenes before asset persistence', () => {
    expectCompatibility(() => excalidrawAdapter.hydrate(scene({
      engineData: { elements: [], fileMap: { file: 'asset-1' } },
      assetRefs: ['asset-1'],
    })), 'BOARD_ASSETS_UNSUPPORTED')
    expectCompatibility(() => excalidrawAdapter.serialize({
      elements: [{ type: 'image' }],
      appState: {},
      files: {},
    }), 'BOARD_ASSETS_UNSUPPORTED')
  })

  it('rejects unsupported engine and scene versions explicitly', () => {
    expectCompatibility(
      () => assertSupportedExcalidrawScene('other', CURRENT_BOARD_SCENE_VERSION),
      'BOARD_ENGINE_UNSUPPORTED',
    )
    expectCompatibility(
      () => assertSupportedExcalidrawScene(BOARD_ENGINE_EXCALIDRAW, CURRENT_BOARD_SCENE_VERSION + 1),
      'BOARD_SCENE_VERSION_UNSUPPORTED',
    )
  })
})
