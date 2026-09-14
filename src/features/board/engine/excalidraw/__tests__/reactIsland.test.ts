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

vi.mock('@excalidraw/excalidraw', () => ({ Excalidraw: 'div' }))

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
    const island = await mountExcalidrawIsland({ container, initialScene, theme: 'light', onError })

    expect(reactMocks.createRoot).toHaveBeenCalledWith(container)
    expect(reactMocks.render).toHaveBeenCalledOnce()
    island.update({ theme: 'dark' })
    expect(reactMocks.createRoot).toHaveBeenCalledOnce()
    expect(reactMocks.render).toHaveBeenCalledTimes(2)

    island.unmount()
    island.unmount()
    expect(reactMocks.unmount).toHaveBeenCalledOnce()
  })

  it('blocks image file drops and removes the blocker when unmounted', async () => {
    reactMocks.createRoot.mockReturnValue({ render: reactMocks.render, unmount: reactMocks.unmount })
    const container = document.createElement('div')
    const onError = vi.fn()
    const onUnsupportedAction = vi.fn()
    const island = await mountExcalidrawIsland({ container, initialScene, theme: 'light', onError, onUnsupportedAction })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })

    container.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onError).not.toHaveBeenCalled()
    expect(onUnsupportedAction).toHaveBeenCalledWith({ kind: 'image-insert', source: 'drop' })

    island.unmount()
    const laterEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(laterEvent, 'dataTransfer', { value: { types: ['Files'] } })
    container.dispatchEvent(laterEvent)
    expect(onUnsupportedAction).toHaveBeenCalledOnce()
  })

  it('blocks image paste as a non-fatal unsupported action', async () => {
    reactMocks.createRoot.mockReturnValue({ render: reactMocks.render, unmount: reactMocks.unmount })
    const container = document.createElement('div')
    const onError = vi.fn()
    const onUnsupportedAction = vi.fn()
    await mountExcalidrawIsland({ container, initialScene, theme: 'light', onError, onUnsupportedAction })

    const renderedContent = reactMocks.render.mock.calls[0][0] as {
      type: (props: unknown) => { props: { children: { props: { onPaste: (data: unknown) => boolean } } } }
      props: unknown
    }
    const renderedBoundary = renderedContent.type(renderedContent.props)
    const handled = renderedBoundary.props.children.props.onPaste({
      files: { 'image/png': new Blob() },
      mixedContent: [],
      elements: [],
    })

    expect(handled).toBe(true)
    expect(onError).not.toHaveBeenCalled()
    expect(onUnsupportedAction).toHaveBeenCalledWith({ kind: 'image-insert', source: 'paste' })
  })
})
