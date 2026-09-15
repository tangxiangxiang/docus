import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Excalidraw, MainMenu } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { BoardReactErrorBoundary } from './ReactErrorBoundary'
import type { BoardRuntimeAsset, ExcalidrawRuntimeScene } from '../types'

export type ExcalidrawIslandTheme = 'light' | 'dark'
export type ExcalidrawIslandLangCode = 'zh-CN' | 'en'

export interface BoardEditorMenuOptions {
  title: string
  saveStatusLabel: string
  favorite: boolean
  busy: boolean
  labels: {
    back: string
    rename: string
    favorite: string
    unfavorite: string
    exportPng: string
    exportSvg: string
    copy: string
    delete: string
    titleInput: string
  }
  onBack: () => void
  onRename: (title: string) => Promise<boolean>
  onToggleFavorite: () => void
  onExportPng: () => void
  onExportSvg: () => void
  onCopy: () => void
  onDelete: () => void
}

export interface ExcalidrawIslandMountOptions {
  container: HTMLElement
  initialScene: ExcalidrawRuntimeScene
  theme: ExcalidrawIslandTheme
  langCode: ExcalidrawIslandLangCode
  editorMenu?: BoardEditorMenuOptions
  onChange?: (scene: ExcalidrawRuntimeScene) => void
  onAssetsChanged?: (assets: readonly BoardRuntimeAsset[]) => void
  onAssetError?: (error: unknown) => void
  onReady?: () => void
  onError?: (error: unknown) => void
}

export interface ExcalidrawIslandHandle {
  update(options: { theme: ExcalidrawIslandTheme, langCode: ExcalidrawIslandLangCode, editorMenu?: BoardEditorMenuOptions }): void
  unmount(): void
}

type ExcalidrawIslandRenderOptions = Omit<ExcalidrawIslandMountOptions, 'container'>

function BoardEditorMainMenu({ menu }: { menu: BoardEditorMenuOptions }): React.ReactNode {
  const [renaming, setRenaming] = React.useState(false)
  const [draftTitle, setDraftTitle] = React.useState(menu.title)
  const [renameBusy, setRenameBusy] = React.useState(false)
  const cancelRename = React.useRef(false)
  const composing = React.useRef(false)
  const renameSubmitting = React.useRef(false)

  React.useEffect(() => {
    if (!renaming) setDraftTitle(menu.title)
  }, [menu.title, renaming])

  const submitRename = async (): Promise<void> => {
    if (renameSubmitting.current) return
    const title = draftTitle.trim()
    if (!title || title === menu.title) {
      setDraftTitle(menu.title)
      setRenaming(false)
      return
    }
    renameSubmitting.current = true
    setRenameBusy(true)
    try {
      const renamed = await menu.onRename(title)
      if (renamed) setRenaming(false)
    } catch {
      // The parent owns the user-facing error notification. Keep the menu
      // usable if an integration callback rejects unexpectedly.
    } finally {
      renameSubmitting.current = false
      setRenameBusy(false)
    }
  }

  return React.createElement(
    MainMenu,
    null,
    React.createElement(
      MainMenu.ItemCustom,
      { className: 'docus-board-menu-heading', children: React.createElement(
        'div',
        { style: { display: 'grid', gap: '4px', padding: '4px 2px 8px' } },
        renaming
          ? React.createElement('input', {
              value: draftTitle,
              autoFocus: true,
              disabled: renameBusy,
              'aria-label': menu.labels.titleInput,
              'data-testid': 'board-editor-title-input',
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraftTitle(event.target.value),
              onCompositionStart: () => { composing.current = true },
              onCompositionEnd: () => { composing.current = false },
              onBlur: () => {
                if (cancelRename.current || composing.current) {
                  cancelRename.current = false
                  return
                }
                void submitRename()
              },
              onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter') {
                  if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
                  event.preventDefault()
                  void submitRename()
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelRename.current = true
                  setDraftTitle(menu.title)
                  setRenaming(false)
                }
              },
              style: {
                width: '100%', boxSizing: 'border-box', padding: '7px 9px', border: '1px solid var(--color-primary)',
                borderRadius: '6px', background: 'var(--island-bg-color)', color: 'var(--text-primary-color)', font: 'inherit', fontWeight: 600,
              },
            })
          : React.createElement('button', {
              type: 'button',
              title: menu.labels.rename,
              'data-testid': 'board-editor-title',
              onClick: () => setRenaming(true),
              style: {
                overflow: 'hidden', padding: 0, border: 0, background: 'transparent', color: 'inherit',
                font: 'inherit', fontWeight: 650, textAlign: 'left', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text',
              },
            }, menu.title),
        React.createElement('span', {
          'data-testid': 'board-editor-menu-save-status',
          style: { color: 'var(--text-secondary-color)', fontSize: '12px' },
        }, menu.saveStatusLabel),
      ) },
    ),
    React.createElement(MainMenu.Item, { onSelect: menu.onBack, shortcut: 'G B', children: `← ${menu.labels.back}` }),
    React.createElement(MainMenu.Separator),
    React.createElement(MainMenu.Item, {
      onSelect: (event) => {
        event.preventDefault()
        cancelRename.current = false
        setRenaming(true)
      },
      disabled: menu.busy,
      children: menu.labels.rename,
    }),
    React.createElement(MainMenu.Item, { onSelect: menu.onToggleFavorite, disabled: menu.busy, children: menu.favorite ? menu.labels.unfavorite : menu.labels.favorite }),
    React.createElement(MainMenu.Separator),
    React.createElement(MainMenu.Item, { onSelect: menu.onExportPng, disabled: menu.busy, children: menu.labels.exportPng }),
    React.createElement(MainMenu.Item, { onSelect: menu.onExportSvg, disabled: menu.busy, children: menu.labels.exportSvg }),
    React.createElement(MainMenu.Item, { onSelect: menu.onCopy, disabled: menu.busy, children: menu.labels.copy }),
    React.createElement(MainMenu.Separator),
    React.createElement(MainMenu.Item, {
      onSelect: menu.onDelete,
      disabled: menu.busy,
      style: { color: 'var(--color-danger)' },
      children: menu.labels.delete,
    }),
    React.createElement(MainMenu.Separator),
    React.createElement(MainMenu.DefaultItems.ToggleTheme),
    React.createElement(MainMenu.DefaultItems.ChangeCanvasBackground),
  )
}

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
  editorMenu,
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
    }, editorMenu ? React.createElement(BoardEditorMainMenu, { menu: editorMenu }) : null),
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
  let currentEditorMenu = options.editorMenu

  const render = (): void => {
    renderIsland(root, {
      theme: currentTheme,
      langCode: currentLangCode,
      editorMenu: currentEditorMenu,
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
      currentEditorMenu = nextOptions.editorMenu
      render()
    },
    unmount(): void {
      if (!mounted) return
      mounted = false
      root.unmount()
    },
  }
}
