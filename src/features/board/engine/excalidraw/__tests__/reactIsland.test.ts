// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const reactMocks = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
}))

vi.mock('react-dom/client', () => ({
  createRoot: reactMocks.createRoot,
}))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useCallback: (callback: (...args: never[]) => unknown) => callback,
  }
})

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: 'div',
  MainMenu: Object.assign('main-menu', {
    Item: 'menu-item',
    ItemCustom: 'menu-item-custom',
    Separator: 'menu-separator',
    DefaultItems: { ToggleTheme: 'toggle-theme', ChangeCanvasBackground: 'change-background' },
  }),
}))

import { mountExcalidrawIsland } from '../reactIsland'

const initialScene = { elements: [], appState: {}, files: {} }

afterEach(() => {
  reactMocks.createRoot.mockReset()
  reactMocks.render.mockReset()
  reactMocks.unmount.mockReset()
})

describe('mountExcalidrawIsland', () => {
  it('mounts, updates theme without recreating the root, and unmounts idempotently', async () => {
    reactMocks.createRoot.mockReturnValue({ render: reactMocks.render, unmount: reactMocks.unmount })
    const container = document.createElement('div')
    const onError = vi.fn()
    const island = await mountExcalidrawIsland({ container, initialScene, theme: 'light', langCode: 'en', onError })

    expect(reactMocks.createRoot).toHaveBeenCalledWith(container)
    expect(reactMocks.render).toHaveBeenCalledOnce()
    island.update({ theme: 'dark', langCode: 'en' })
    expect(reactMocks.createRoot).toHaveBeenCalledOnce()
    expect(reactMocks.render).toHaveBeenCalledTimes(2)

    island.unmount()
    island.unmount()
    expect(reactMocks.unmount).toHaveBeenCalledOnce()
  })

  it('leaves image file drops available to Excalidraw', async () => {
    reactMocks.createRoot.mockReturnValue({ render: reactMocks.render, unmount: reactMocks.unmount })
    const container = document.createElement('div')
    const onError = vi.fn()
    const onAssetsChanged = vi.fn()
    const island = await mountExcalidrawIsland({ container, initialScene, theme: 'light', langCode: 'en', onError, onAssetsChanged })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })

    container.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onError).not.toHaveBeenCalled()
    expect(onAssetsChanged).not.toHaveBeenCalled()

    island.unmount()
    const laterEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(laterEvent, 'dataTransfer', { value: { types: ['Files'] } })
    container.dispatchEvent(laterEvent)
    expect(onAssetsChanged).not.toHaveBeenCalled()
  })

  it('enables the Excalidraw image tool and does not override paste handling', async () => {
    reactMocks.createRoot.mockReturnValue({ render: reactMocks.render, unmount: reactMocks.unmount })
    const container = document.createElement('div')
    const onError = vi.fn()
    await mountExcalidrawIsland({ container, initialScene, theme: 'light', langCode: 'en', onError })

    const renderedContent = reactMocks.render.mock.calls[0][0] as {
      type: (props: unknown) => { props: { children: { props: { onPaste?: unknown; UIOptions?: { tools?: { image?: boolean } } } } } }
      props: unknown
    }
    const renderedBoundary = renderedContent.type(renderedContent.props)

    expect(renderedBoundary.props.children.props.onPaste).toBeUndefined()
    expect(renderedBoundary.props.children.props.UIOptions?.tools?.image).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('bridges runtime BinaryFiles as engine-neutral Blobs before onChange', async () => {
    reactMocks.createRoot.mockReturnValue({ render: reactMocks.render, unmount: reactMocks.unmount })
    const container = document.createElement('div')
    const onChange = vi.fn()
    const onAssetsChanged = vi.fn()
    await mountExcalidrawIsland({ container, initialScene, theme: 'light', langCode: 'en', onChange, onAssetsChanged })

    const renderedContent = reactMocks.render.mock.calls[0][0] as {
      type: (props: unknown) => { props: { children: { props: { onChange: (elements: unknown[], appState: unknown, files: unknown) => void } } } }
      props: unknown
    }
    const renderedBoundary = renderedContent.type(renderedContent.props)
    const file = {
      id: 'engine-file-1',
      dataURL: 'data:image/png;base64,aGk=',
      mimeType: 'image/png',
      created: 1,
    }
    const elements = [{ id: 'shape' }]
    const appState = { zoom: { value: 0.8 } }
    const files = { 'engine-file-1': file }
    renderedBoundary.props.children.props.onChange(elements, appState, files)

    expect(onAssetsChanged).toHaveBeenCalledWith([expect.objectContaining({
      engineFileId: 'engine-file-1',
      mimeType: 'image/png',
      blob: expect.any(Blob),
    })])
    expect(onChange).toHaveBeenCalledWith({ elements, appState, files })
  })
})
