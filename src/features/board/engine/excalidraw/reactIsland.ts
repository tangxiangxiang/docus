import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { BoardReactErrorBoundary } from './ReactErrorBoundary'
import type { BoardRuntimeAsset, ExcalidrawRuntimeScene } from '../types'

export type ExcalidrawIslandTheme = 'light' | 'dark'
export type ExcalidrawIslandLangCode = 'zh-CN' | 'en'

export interface ExcalidrawIslandMountOptions {
  container: HTMLElement
  initialScene: ExcalidrawRuntimeScene
  theme: ExcalidrawIslandTheme
  langCode: ExcalidrawIslandLangCode
  onChange?: (scene: ExcalidrawRuntimeScene) => void
  onAssetsChanged?: (assets: readonly BoardRuntimeAsset[]) => void
  onAssetError?: (error: unknown) => void
  onReady?: () => void
  onError?: (error: unknown) => void
}

export interface ExcalidrawIslandHandle {
  update(options: { theme: ExcalidrawIslandTheme, langCode: ExcalidrawIslandLangCode }): void
  unmount(): void
}

type ExcalidrawIslandRenderOptions = Omit<ExcalidrawIslandMountOptions, 'container'>

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const separator = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || separator < 0) {
    throw new Error('Excalidraw returned an unsupported image data URL')
  }
  const metadata = dataUrl.slice(5, separator)
  const encoded = dataUrl.slice(separator + 1)
  if (metadata.split(';').includes('base64')) {
    if (typeof atob !== 'function') throw new Error('Browser base64 support is unavailable')
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: mimeType })
  }
  return new Blob([decodeURIComponent(encoded)], { type: mimeType })
}

function runtimeAssets(files: BinaryFiles): BoardRuntimeAsset[] {
  return Object.entries(files).map(([fileKey, file]) => {
    const engineFileId = typeof file.id === 'string' && file.id.length > 0 ? file.id : fileKey
    return {
      engineFileId,
      mimeType: file.mimeType,
      blob: dataUrlToBlob(file.dataURL, file.mimeType),
    }
  })
}

function ExcalidrawIslandContent({
  theme,
  langCode,
  initialScene,
  onChange,
  onAssetsChanged,
  onAssetError,
  onReady,
  onError,
}: ExcalidrawIslandRenderOptions): React.ReactNode {
  const handleChange = React.useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    try {
      // This callback runs before the Vue bridge receives the scene. The
      // Asset Session can therefore make the pending Blob durable before a
      // checkpoint is ever scheduled for this onChange payload.
      onAssetsChanged?.(runtimeAssets(files))
    } catch (error) {
      onAssetError?.(error)
      return
    }
    onChange?.({
      elements: [...elements],
      appState: appState as unknown as Readonly<Record<string, unknown>>,
      files: files as unknown as Readonly<Record<string, unknown>>,
    })
  }, [onAssetError, onAssetsChanged, onChange])

  const initialData: ExcalidrawInitialDataState = {
    elements: initialScene.elements as readonly OrderedExcalidrawElement[],
    appState: initialScene.appState as Partial<AppState>,
    files: initialScene.files as BinaryFiles,
  }

  return React.createElement(
    BoardReactErrorBoundary,
    { onError },
    React.createElement(Excalidraw, {
      theme,
      langCode,
      initialData,
      excalidrawAPI: () => onReady?.(),
      onChange: handleChange,
      isCollaborating: false,
      aiEnabled: false,
      UIOptions: {
        tools: { image: true },
        canvasActions: { export: false, saveToActiveFile: false },
      },
    }),
  )
}

function renderIsland(root: Root, options: ExcalidrawIslandRenderOptions): void {
  root.render(React.createElement(ExcalidrawIslandContent, options))
}

export async function mountExcalidrawIsland(
  options: ExcalidrawIslandMountOptions,
): Promise<ExcalidrawIslandHandle> {
  const root = createRoot(options.container)
  let mounted = true
  let currentTheme = options.theme
  let currentLangCode = options.langCode

  const render = (): void => {
    renderIsland(root, {
      theme: currentTheme,
      langCode: currentLangCode,
      initialScene: options.initialScene,
      onChange: options.onChange,
      onAssetsChanged: options.onAssetsChanged,
      onAssetError: options.onAssetError,
      onReady: options.onReady,
      onError: options.onError,
    })
  }

  render()

  return {
    update(nextOptions): void {
      if (!mounted) return
      currentTheme = nextOptions.theme
      currentLangCode = nextOptions.langCode
      render()
    },
    unmount(): void {
      if (!mounted) return
      mounted = false
      root.unmount()
    },
  }
}
