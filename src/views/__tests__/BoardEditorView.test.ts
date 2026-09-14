// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import BoardEditorView from '../BoardEditorView.vue'
import ExcalidrawHost from '../../components/board/ExcalidrawHost.vue'
import type { BoardAggregate } from '../../features/board/api'
import type { BoardScene } from '../../../shared/boardProtocol'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { useConfirm } from '../../composables/useConfirm'
import { boardMetadataSource } from '../../features/board/metadataSource'

const api = vi.hoisted(() => ({
  BoardApiError: class BoardApiError extends Error {
    status: number
    code: string
    uncertain: boolean
    constructor(message: string, status = 500, code = 'BOARD_API_ERROR', uncertain = true) {
      super(message)
      this.status = status
      this.code = code
      this.uncertain = uncertain
    }
  },
  listBoards: vi.fn(),
  getBoard: vi.fn(),
  saveBoardScene: vi.fn(),
}))

vi.mock('../../features/board/api', () => api)
vi.mock('../../components/board/ExcalidrawHost.vue', () => ({
  default: {
    name: 'ExcalidrawHost',
    props: ['initialScene', 'theme'],
    emits: ['change', 'ready', 'error', 'unsupported-action'],
    template: '<div data-testid="mock-excalidraw-host" />',
  },
}))

function emptyScene(): BoardScene {
  return { engineData: { elements: [], fileMap: {} }, persistentAppState: {}, assetRefs: [] }
}

function board(id: string, title = id, revision = 3): BoardAggregate {
  return {
    metadata: { id, title, thumbnailAssetId: null, createdAt: 1, updatedAt: 2 },
    sceneRecord: { boardId: id, engine: 'excalidraw', sceneVersion: 1, revision, scene: emptyScene() },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function mountEditor(boardId = 'a') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/board/:boardId', name: 'board-editor', component: BoardEditorView }],
  })
  await router.push(`/board/${boardId}`)
  await router.isReady()
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
  return { wrapper, router }
}

describe('Board Editor B4 lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    boardMetadataSource.invalidate()
    useI18n().setLocale('en')
  })

  afterEach(() => {
    boardMetadataSource.invalidate()
    useI18n().setLocale('zh')
  })

  it('shows loading without mounting a canvas, then hydrates and becomes ready', async () => {
    const request = deferred<BoardAggregate>()
    api.getBoard.mockReturnValueOnce(request.promise)
    const { wrapper } = await mountEditor()
    expect(wrapper.find('[data-testid="board-editor-loading"]').exists()).toBe(true)
    expect(wrapper.findComponent(ExcalidrawHost).exists()).toBe(false)

    request.resolve(board('a', 'Alpha'))
    await flushPromises()
    expect(wrapper.findComponent(ExcalidrawHost).exists()).toBe(true)
    wrapper.findComponent(ExcalidrawHost).vm.$emit('ready')
    await flushPromises()
    expect(wrapper.get('[data-testid="board-editor-status"]').text()).toContain('Ready')
    expect(wrapper.findComponent(ExcalidrawHost).props('initialScene')).toEqual({ elements: [], appState: {}, files: {} })
    wrapper.unmount()
  })

  it('does not mount an empty canvas for not-found or load failures', async () => {
    api.getBoard.mockRejectedValueOnce(new api.BoardApiError('missing', 404, 'BOARD_NOT_FOUND', false))
    const { wrapper } = await mountEditor()
    await flushPromises()
    expect(wrapper.find('[data-testid="board-editor-error"]').exists()).toBe(true)
    expect(wrapper.findComponent(ExcalidrawHost).exists()).toBe(false)
    wrapper.unmount()
  })

  it('fences stale route responses and keeps only the latest board', async () => {
    const first = deferred<BoardAggregate>()
    const second = deferred<BoardAggregate>()
    api.getBoard.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { wrapper, router } = await mountEditor('a')
    await router.push('/board/b')
    await flushPromises()
    second.resolve(board('b', 'Beta'))
    await flushPromises()
    wrapper.findComponent(ExcalidrawHost).vm.$emit('ready')
    first.resolve(board('a', 'Alpha'))
    await flushPromises()
    expect(wrapper.get('.board-editor-title').text()).toBe('Beta')
    expect(api.getBoard).toHaveBeenCalledWith('a')
    expect(api.getBoard).toHaveBeenCalledWith('b')
    wrapper.unmount()
  })

  it('retries a failed load and mounts the successful result', async () => {
    api.getBoard.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(board('a', 'Retry'))
    const { wrapper } = await mountEditor()
    await flushPromises()
    await wrapper.get('[data-testid="board-editor-error"] button').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ExcalidrawHost).exists()).toBe(true)
    expect(api.getBoard).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('starts at local revision zero and increments only for meaningful scene changes', async () => {
    api.getBoard.mockResolvedValueOnce(board('a'))
    const { wrapper } = await mountEditor()
    await flushPromises()
    const host = wrapper.findComponent(ExcalidrawHost)
    host.vm.$emit('ready')
    await flushPromises()
    expect(wrapper.get('[data-testid="board-local-revision"]').attributes('data-local-revision')).toBe('0')

    const same = { elements: [], appState: {}, files: {} }
    host.vm.$emit('change', same)
    await flushPromises()
    expect(wrapper.get('[data-testid="board-local-revision"]').attributes('data-local-revision')).toBe('0')

    host.vm.$emit('change', {
      elements: [{ id: 'rectangle-1', type: 'rectangle', version: 1, x: 10, y: 10, width: 20, height: 20 }],
      appState: {},
      files: {},
    })
    await flushPromises()
    expect(wrapper.get('[data-testid="board-local-revision"]').attributes('data-local-revision')).toBe('1')
    expect(api.getBoard).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('keeps the ready editor and local session when image insertion is unsupported', async () => {
    api.getBoard.mockResolvedValueOnce(board('a'))
    const { wrapper } = await mountEditor()
    await flushPromises()
    const host = wrapper.findComponent(ExcalidrawHost)
    host.vm.$emit('ready')
    await flushPromises()

    host.vm.$emit('unsupported-action', { kind: 'image-insert', source: 'drop' })
    await flushPromises()

    expect(wrapper.get('[data-testid="board-editor-status"]').text()).toContain('Ready')
    expect(wrapper.findComponent(ExcalidrawHost).exists()).toBe(true)
    expect(wrapper.get('[data-testid="board-local-revision"]').attributes('data-local-revision')).toBe('0')
    expect(useToast().toasts.value.at(-1)?.message).toBe('Image insertion is not available in Board yet.')
    useToast().toasts.value.forEach((item) => useToast().dismiss(item.id))
    wrapper.unmount()
  })

  it('flushes a dirty Board before same-component boardId navigation', async () => {
    api.getBoard.mockResolvedValueOnce(board('a')).mockResolvedValueOnce(board('b'))
    api.saveBoardScene.mockResolvedValueOnce({ revision: 4, updatedAt: 20 })
    const { wrapper, router } = await mountEditor('a')
    await flushPromises()
    const host = wrapper.findComponent(ExcalidrawHost)
    host.vm.$emit('ready')
    host.vm.$emit('change', {
      elements: [{ id: 'rectangle-1', type: 'rectangle', version: 1, x: 10, y: 10, width: 20, height: 20 }],
      appState: {},
      files: {},
    })
    await flushPromises()

    await router.push('/board/b')
    await flushPromises()
    expect(api.saveBoardScene).toHaveBeenCalledWith('a', expect.objectContaining({ expectedRevision: 3 }))
    expect(router.currentRoute.value.params.boardId).toBe('b')
    expect(api.getBoard).toHaveBeenCalledWith('b')
    wrapper.unmount()
  })

  it('blocks same-component boardId navigation when a failed flush is not confirmed', async () => {
    api.getBoard.mockResolvedValueOnce(board('a')).mockResolvedValueOnce(board('b'))
    api.saveBoardScene.mockRejectedValueOnce(new api.BoardApiError('save failed', 500, 'BOARD_INTERNAL_ERROR', false))
    const { wrapper, router } = await mountEditor('a')
    await flushPromises()
    const host = wrapper.findComponent(ExcalidrawHost)
    host.vm.$emit('ready')
    host.vm.$emit('change', {
      elements: [{ id: 'rectangle-1', type: 'rectangle', version: 1, x: 10, y: 10, width: 20, height: 20 }],
      appState: {},
      files: {},
    })
    await flushPromises()

    const navigation = router.push('/board/b')
    await flushPromises()
    const request = useConfirm().queue.value[0]
    expect(request?.message).toBe('Changes could not be safely saved')
    if (request) useConfirm().answer(request.id, false)
    await navigation
    expect(router.currentRoute.value.params.boardId).toBe('a')
    expect(api.getBoard).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('warns synchronously on beforeunload while a scene save is at risk', async () => {
    api.getBoard.mockResolvedValueOnce(board('a'))
    const { wrapper } = await mountEditor()
    await flushPromises()
    const host = wrapper.findComponent(ExcalidrawHost)
    host.vm.$emit('ready')
    host.vm.$emit('change', {
      elements: [{ id: 'rectangle-1', type: 'rectangle', version: 1, x: 10, y: 10, width: 20, height: 20 }],
      appState: {},
      files: {},
    })
    await flushPromises()

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })
})
