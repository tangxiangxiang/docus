import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import type { ClipboardData } from '@excalidraw/excalidraw/clipboard'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { BoardReactErrorBoundary } from './ReactErrorBoundary'
import type { ExcalidrawRuntimeScene } from '../types'

export type ExcalidrawIslandTheme = 'light' | 'dark'
export type ExcalidrawIslandLangCode = 'zh-CN' | 'en'

export interface ExcalidrawUnsupportedAction {
  kind: 'image-insert'
  source: 'paste' | 'drop'
}

export interface ExcalidrawIslandMountOptions {
  container: HTMLElement
  initialScene: ExcalidrawRuntimeScene
  theme: ExcalidrawIslandTheme
  langCode: ExcalidrawIslandLangCode
  onChange?: (scene: ExcalidrawRuntimeScene) => void
  onReady?: () => void
  onError?: (error: unknown) => void
  onUnsupportedAction?: (action: ExcalidrawUnsupportedAction) => void
}

export interface ExcalidrawIslandHandle {
  update(options: { theme: ExcalidrawIslandTheme, langCode: ExcalidrawIslandLangCode }): void
  unmount(): void
}

type ExcalidrawIslandRenderOptions = Omit<ExcalidrawIslandMountOptions, 'container'>

function hasImagePaste(data: ClipboardData): boolean {
  return Boolean(
    (data.files && Object.keys(data.files).length > 0)
      || data.mixedContent?.some((item) => item.type === 'imageUrl')
      || data.elements?.some((element) => element.type === 'image'),
  )
}

function hasFileDrop(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).some((type) => type === 'Files' || type.startsWith('image/'))
}

function ExcalidrawIslandContent({
  theme,
  langCode,
  initialScene,
  onChange,
  onReady,
  onError,
  onUnsupportedAction,
}: ExcalidrawIslandRenderOptions): React.ReactNode {
  const handleChange = React.useCallback((elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    onChange?.({
      elements: [...elements],
      appState: appState as unknown as Readonly<Record<string, unknown>>,
      files: files as unknown as Readonly<Record<string, unknown>>,
    })
  }, [onChange])

  const handlePaste = React.useCallback((data: ClipboardData) => {
    if (!hasImagePaste(data)) return false
    onUnsupportedAction?.({ kind: 'image-insert', source: 'paste' })
    return true
  }, [onUnsupportedAction])

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
      onPaste: handlePaste,
      isCollaborating: false,
      aiEnabled: false,
      UIOptions: {
        tools: { image: false },
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

  const handleDrop = (event: DragEvent): void => {
    if (!hasFileDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    options.onUnsupportedAction?.({ kind: 'image-insert', source: 'drop' })
  }
  const handleDragOver = (event: DragEvent): void => {
    if (!hasFileDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
  }
  options.container.addEventListener('drop', handleDrop, true)
  options.container.addEventListener('dragover', handleDragOver, true)

  const render = (): void => {
    renderIsland(root, {
      theme: currentTheme,
      langCode: currentLangCode,
      initialScene: options.initialScene,
      onChange: options.onChange,
      onReady: options.onReady,
      onError: options.onError,
      onUnsupportedAction: options.onUnsupportedAction,
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
      options.container.removeEventListener('drop', handleDrop, true)
      options.container.removeEventListener('dragover', handleDragOver, true)
      root.unmount()
    },
  }
}
