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

async function expectCompatibility(action: () => unknown, code: BoardEngineCompatibilityError['code']): Promise<void> {
  await expect(Promise.resolve().then(action)).rejects.toBeInstanceOf(BoardEngineCompatibilityError)
  try {
    await Promise.resolve().then(action)
  } catch (error) {
    expect(error).toMatchObject({ code })
  }
}

describe('excalidrawAdapter', () => {
  it('hydrates the portable empty scene and maps numeric zoom to Excalidraw runtime shape', async () => {
    await expect(excalidrawAdapter.hydrate(scene())).resolves.toEqual({
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
  ])('fails closed for %s', async (_label, overrides) => {
    await expectCompatibility(() => excalidrawAdapter.validate(scene(overrides)), 'BOARD_SCENE_INVALID')
  })

  it('hydrates and serializes image elements through the fileId-to-assetId mapping', async () => {
    const image = { id: 'image-1', type: 'image', fileId: 'engine-file-1', isDeleted: false, version: 1 }
    const imageScene = scene({
      engineData: { elements: [image], fileMap: { 'engine-file-1': 'asset-1' } },
      assetRefs: ['asset-1'],
    })
    const runtime = await excalidrawAdapter.hydrate(imageScene, [{
      assetId: 'asset-1',
      engineFileId: 'engine-file-1',
      mimeType: 'image/png',
      blob: new Blob(['image-bytes'], { type: 'image/png' }),
    }])

    expect(runtime.files['engine-file-1']).toMatchObject({
      id: 'engine-file-1',
      mimeType: 'image/png',
    })
    expect((runtime.files['engine-file-1'] as { dataURL: string }).dataURL).toBe('data:image/png;base64,aW1hZ2UtYnl0ZXM=')
    const serialized = excalidrawAdapter.serialize(runtime, { 'engine-file-1': 'asset-1' })
    expect(serialized).toMatchObject({
      engineData: { fileMap: { 'engine-file-1': 'asset-1' } },
      assetRefs: ['asset-1'],
    })
    expect(JSON.stringify(serialized)).not.toContain('data:image')
  })

  it('fails closed when a non-deleted image mapping or resolved asset is missing', async () => {
    await expectCompatibility(() => excalidrawAdapter.validate(scene({
      engineData: { elements: [{ type: 'image', fileId: 'file-1' }], fileMap: {} },
      assetRefs: [],
    })), 'BOARD_SCENE_INVALID')
    await expectCompatibility(() => excalidrawAdapter.hydrate(scene({
      engineData: { elements: [{ type: 'image', fileId: 'file-1' }], fileMap: { 'file-1': 'asset-1' } },
      assetRefs: ['asset-1'],
    })), 'BOARD_SCENE_INVALID')
  })

  it('keeps deleted image elements from retaining removed asset mappings', () => {
    const runtime = {
      elements: [{ type: 'image', fileId: 'file-1', isDeleted: true }],
      appState: {},
      files: { 'file-1': {} },
    }
    expect(excalidrawAdapter.serialize(runtime, { 'file-1': 'asset-1' })).toMatchObject({
      engineData: { fileMap: {} },
      assetRefs: [],
    })
  })

  it('includes image file references in the lightweight persistence fingerprint', () => {
    const base = { elements: [{ type: 'image', fileId: 'file-a', version: 1 }], appState: {}, files: { 'file-a': {} } }
    const changed = { elements: [{ type: 'image', fileId: 'file-b', version: 1 }], appState: {}, files: { 'file-b': {} } }
    expect(runtimePersistenceFingerprint(base)).not.toBe(runtimePersistenceFingerprint(changed))
  })

  it('rejects unsupported engine and scene versions explicitly', async () => {
    await expectCompatibility(
      () => { assertSupportedExcalidrawScene('other', CURRENT_BOARD_SCENE_VERSION) },
      'BOARD_ENGINE_UNSUPPORTED',
    )
    await expectCompatibility(
      () => { assertSupportedExcalidrawScene(BOARD_ENGINE_EXCALIDRAW, CURRENT_BOARD_SCENE_VERSION + 1) },
      'BOARD_SCENE_VERSION_UNSUPPORTED',
    )
  })
})
