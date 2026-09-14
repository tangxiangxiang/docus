// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExcalidrawHost from '../ExcalidrawHost.vue'

const islandMocks = vi.hoisted(() => ({
  mount: vi.fn(),
  update: vi.fn(),
  unmount: vi.fn(),
}))

  vi.mock('../../../features/board/engine/excalidraw/reactIsland', () => ({
  mountExcalidrawIsland: islandMocks.mount,
}))

afterEach(() => {
  islandMocks.mount.mockReset()
  islandMocks.update.mockReset()
  islandMocks.unmount.mockReset()
})

describe('ExcalidrawHost', () => {
  it('mounts the lazy Island, updates theme without recreating it, and unmounts it', async () => {
    islandMocks.mount.mockImplementation(async (options: { onReady?: () => void }) => {
      options.onReady?.()
      return {
        update: islandMocks.update,
        unmount: islandMocks.unmount,
      }
    })

    const initialScene = { elements: [], appState: {}, files: {} }
    const wrapper = mount(ExcalidrawHost, { props: { initialScene, theme: 'light', langCode: 'zh-CN' } })
    await flushPromises()

    expect(islandMocks.mount).toHaveBeenCalledOnce()
    expect(islandMocks.mount).toHaveBeenCalledWith(expect.objectContaining({ initialScene, langCode: 'zh-CN' }))
    expect(wrapper.emitted('ready')).toHaveLength(1)

    await wrapper.setProps({ theme: 'dark', langCode: 'en' })
    expect(islandMocks.update).toHaveBeenCalledWith({ theme: 'dark', langCode: 'en' })
    expect(islandMocks.mount).toHaveBeenCalledOnce()

    wrapper.unmount()
    expect(islandMocks.unmount).toHaveBeenCalledOnce()
  })

  it('bridges unsupported actions without treating them as errors', async () => {
    islandMocks.mount.mockImplementation(async (options: { onUnsupportedAction?: (action: unknown) => void }) => {
      options.onUnsupportedAction?.({ kind: 'image-insert', source: 'drop' })
      return { update: islandMocks.update, unmount: islandMocks.unmount }
    })

    const wrapper = mount(ExcalidrawHost, { props: { initialScene: { elements: [], appState: {}, files: {} } } })
    await flushPromises()

    expect(wrapper.emitted('unsupportedAction')).toEqual([[{ kind: 'image-insert', source: 'drop' }]])
    expect(wrapper.emitted('error')).toBeUndefined()
    wrapper.unmount()
  })
})
