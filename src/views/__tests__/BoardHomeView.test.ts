// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import BoardHomeView from '../BoardHomeView.vue'
import BoardGallery from '../../components/board/BoardGallery.vue'
import { boardMetadataSource } from '../../features/board/metadataSource'
import type { BoardMetadata } from '../../../shared/boardProtocol'
import { useI18n } from '../../composables/useI18n'

const api = vi.hoisted(() => ({
  BoardApiError: class BoardApiError extends Error {
    uncertain: boolean
    constructor(message: string, uncertain = true) {
      super(message)
      this.uncertain = uncertain
    }
  },
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  renameBoard: vi.fn(),
  deleteBoard: vi.fn(),
  boardAssetUrl: vi.fn((assetId: string) => `/api/assets/${assetId}`),
}))

vi.mock('../../features/board/api', () => api)
vi.mock('../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}))

function board(id: string, title: string, updatedAt = 1): BoardMetadata {
  return { id, title, thumbnailAssetId: null, createdAt: updatedAt - 1, updatedAt }
}

async function mountHome(): Promise<{ wrapper: VueWrapper; router: ReturnType<typeof createRouter> }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/board', name: 'board', component: BoardHomeView },
      { path: '/board/:boardId', name: 'board-editor', component: { template: '<div />' } },
    ],
  })
  await router.push('/board')
  await router.isReady()
  const wrapper = mount(BoardHomeView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('Board Gallery Home', () => {
  beforeEach(() => {
    useI18n().setLocale('en')
    vi.clearAllMocks()
    boardMetadataSource.invalidate()
  })

  afterEach(() => {
    boardMetadataSource.invalidate()
    useI18n().setLocale('zh')
    document.body.innerHTML = ''
  })

  it('loads metadata, shows recent and all sections, and filters titles locally', async () => {
    api.listBoards.mockResolvedValue([
      board('older', 'Reading List', 10),
      board('newer', 'Project Atlas', 20),
    ])
    const { wrapper } = await mountHome()

    expect(api.listBoards).toHaveBeenCalledOnce()
    expect(wrapper.findAll('[data-testid="board-card-title"]').map((item) => item.text())).toEqual([
      'Project Atlas',
      'Reading List',
      'Project Atlas',
      'Reading List',
    ])

    await wrapper.find('.board-home-search input').setValue('atlas')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="board-card-title"]').map((item) => item.text())).toEqual([
      'Project Atlas',
    ])
    wrapper.unmount()
  })

  it('creates a board through the metadata source and opens the editor route', async () => {
    api.listBoards.mockResolvedValue([])
    const created = board('created', 'Untitled Board', 30)
    api.createBoard.mockResolvedValue({ metadata: created, sceneRecord: {} })
    const { wrapper, router } = await mountHome()

    await wrapper.get('.board-new-button').trigger('click')
    await flushPromises()

    expect(api.createBoard).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="board-card-title"]').text()).toBe('Untitled Board')
    expect(router.currentRoute.value.name).toBe('board-editor')
    expect(router.currentRoute.value.params.boardId).toBe('created')
    wrapper.unmount()
  })

  it('opens the thin Board Editor route from a card', async () => {
    api.listBoards.mockResolvedValue([board('atlas', 'Project Atlas')])
    const { wrapper, router } = await mountHome()

    await wrapper.get('.board-card-open').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('board-editor')
    expect(router.currentRoute.value.params.boardId).toBe('atlas')
    wrapper.unmount()
  })

  it('invalidates metadata after an uncertain create transport failure', async () => {
    api.listBoards.mockResolvedValue([board('existing', 'Existing')])
    api.createBoard.mockRejectedValue(new api.BoardApiError('network failed', true))
    const { wrapper } = await mountHome()

    await wrapper.get('.board-new-button').trigger('click')
    await flushPromises()

    expect(boardMetadataSource.getSnapshot()).toEqual([])
    wrapper.unmount()
  })

  it('invalidates metadata after uncertain rename and delete failures', async () => {
    api.listBoards.mockResolvedValue([board('existing', 'Existing')])
    api.renameBoard.mockRejectedValue(new api.BoardApiError('network failed', true))
    api.deleteBoard.mockRejectedValue(new api.BoardApiError('network failed', true))
    const { wrapper } = await mountHome()

    wrapper.findComponent(BoardGallery).vm.$emit('rename', board('existing', 'Existing'))
    await flushPromises()
    const renameSubmit = document.body.querySelector('[data-testid="board-rename-submit"]') as HTMLElement | null
    expect(renameSubmit).not.toBeNull()
    renameSubmit?.click()
    await flushPromises()
    expect(boardMetadataSource.getSnapshot()).toEqual([])

    boardMetadataSource.upsert(board('existing', 'Existing'))
    await flushPromises()
    wrapper.findComponent(BoardGallery).vm.$emit('delete', board('existing', 'Existing'))
    await flushPromises()
    expect(api.deleteBoard).toHaveBeenCalledOnce()
    expect(boardMetadataSource.getSnapshot()).toEqual([])
    wrapper.unmount()
  })

  it('keeps metadata loaded after a definite Board API failure', async () => {
    api.listBoards.mockResolvedValue([board('existing', 'Existing')])
    api.renameBoard.mockRejectedValue(new api.BoardApiError('invalid title', false))
    const { wrapper } = await mountHome()

    wrapper.findComponent(BoardGallery).vm.$emit('rename', board('existing', 'Existing'))
    await flushPromises()
    const renameSubmit = document.body.querySelector('[data-testid="board-rename-submit"]') as HTMLElement | null
    expect(renameSubmit).not.toBeNull()
    renameSubmit?.click()
    await flushPromises()

    expect(boardMetadataSource.getSnapshot()).toHaveLength(1)
    wrapper.unmount()
  })
})
