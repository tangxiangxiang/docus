// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import BoardHomeView from '../BoardHomeView.vue'
import { boardMetadataSource } from '../../features/board/metadataSource'
import type { BoardMetadata } from '../../../shared/boardProtocol'
import { useI18n } from '../../composables/useI18n'

const api = vi.hoisted(() => ({
  BoardApiError: class BoardApiError extends Error {},
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  renameBoard: vi.fn(),
  deleteBoard: vi.fn(),
  boardAssetUrl: vi.fn((assetId: string) => `/api/assets/${assetId}`),
}))

vi.mock('../../features/board/api', () => api)

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
})
