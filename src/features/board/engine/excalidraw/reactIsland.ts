import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { BoardReactErrorBoundary } from './ReactErrorBoundary'

export type ExcalidrawIslandTheme = 'light' | 'dark'

export interface ExcalidrawIslandMountOptions {
  container: HTMLElement
  theme: ExcalidrawIslandTheme
  onChange?: () => void
  onReady?: () => void
  onError?: (error: unknown) => void
}

export interface ExcalidrawIslandHandle {
  update(options: { theme: ExcalidrawIslandTheme }): void
  unmount(): void
}

type ExcalidrawIslandRenderOptions = Omit<ExcalidrawIslandMountOptions, 'container'>

function ExcalidrawIslandContent({
  theme,
  onChange,
  onReady,
  onError,
}: ExcalidrawIslandRenderOptions): React.ReactNode {
  React.useEffect(() => {
    onReady?.()
  }, [onReady])

  const handleChange = React.useCallback(() => {
    onChange?.()
  }, [onChange])

  return React.createElement(
    BoardReactErrorBoundary,
    { onError },
    React.createElement(Excalidraw, {
      theme,
      initialData: {
        elements: [],
        files: {},
      },
      onChange: handleChange,
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

  const render = (): void => {
    renderIsland(root, {
      theme: currentTheme,
      onChange: options.onChange,
      onReady: options.onReady,
      onError: options.onError,
    })
  }

  render()

  return {
    update(nextOptions): void {
      if (!mounted) return
      currentTheme = nextOptions.theme
      render()
    },
    unmount(): void {
      if (!mounted) return
      mounted = false
      root.unmount()
    },
  }
}
