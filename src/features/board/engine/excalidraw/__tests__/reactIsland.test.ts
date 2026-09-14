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
    const island = await mountExcalidrawIsland({ container, initialScene, theme: 'light', onError })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })

    container.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(onError).toHaveBeenCalledOnce()

    island.unmount()
    const laterEvent = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(laterEvent, 'dataTransfer', { value: { types: ['Files'] } })
    container.dispatchEvent(laterEvent)
    expect(onError).toHaveBeenCalledOnce()
  })
})
