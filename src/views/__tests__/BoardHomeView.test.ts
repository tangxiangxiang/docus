// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { NSelect } from 'naive-ui'
import BoardHomeView from '../BoardHomeView.vue'
import BoardGallery from '../../components/board/BoardGallery.vue'
import { boardMetadataSource } from '../../features/board/metadataSource'
import type { BoardMetadata } from '../../../shared/boardProtocol'
import { useBoardFavorites } from '../../composables/useBoardFavorites'
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

function board(id: string, title: string, updatedAt = 1, lastOpenedAt: number | null = null): BoardMetadata {
  return { id, title, thumbnailAssetId: null, createdAt: updatedAt - 1, updatedAt, lastOpenedAt }
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
    useBoardFavorites().favoriteBoardIds.value = []
    vi.clearAllMocks()
    boardMetadataSource.invalidate()
  })

  afterEach(() => {
    boardMetadataSource.invalidate()
    useBoardFavorites().favoriteBoardIds.value = []
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

    await wrapper.find('.board-search-input input').setValue('atlas')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="board-card-title"]').map((item) => item.text())).toEqual([
      'Project Atlas',
    ])
    wrapper.unmount()
  })

  it('shows Board as the eyebrow and Idea canvas as the page title', async () => {
    api.listBoards.mockResolvedValue([])
    const { wrapper } = await mountHome()

    expect(wrapper.get('.board-home-eyebrow').text()).toBe('Board')
    expect(wrapper.get('.board-home-header h1').text()).toBe('Idea canvas')
    wrapper.unmount()
  })

  it('keeps five recent boards above the complete grid and reuses the same card style', async () => {
    api.listBoards.mockResolvedValue([
      board('older', 'Reading List', 10),
      board('newer', 'Project Atlas', 30),
      board('middle', 'Sketch Notes', 20),
      board('fourth', 'Flow Map', 15),
      board('fifth', 'Product Plan', 12),
      board('sixth', 'Meeting Notes', 8),
    ])
    const { wrapper } = await mountHome()

    expect(wrapper.findAll('.board-recent-section .board-card')).toHaveLength(5)
    expect(wrapper.findAll('.board-all-section .board-card')).toHaveLength(6)
    expect(wrapper.findAll('.board-recent-section .board-card.is-recent')).toHaveLength(0)
    expect(wrapper.findAll('.board-all-section .board-card.is-grid')).toHaveLength(0)
    expect(wrapper.find('.board-recent-section .board-gallery').classes()).toContain('is-recent')
    expect(wrapper.find('.board-all-section .board-gallery').classes()).toContain('is-grid')
    expect(wrapper.find('.board-recent-section [data-testid="board-card-title"]').text()).toBe('Project Atlas')
    expect(wrapper.find('[data-testid="board-summary-all"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="board-summary-recent"]').exists()).toBe(false)
    expect(wrapper.find('.board-section-link').exists()).toBe(false)
    expect(wrapper.find('[data-testid="board-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('.board-all-search').exists()).toBe(true)
    wrapper.unmount()
  })

  it('switches the quick access tabs and persists a favorite Board locally', async () => {
    api.listBoards.mockResolvedValue([
      board('older', 'Reading List', 10),
      board('newer', 'Project Atlas', 30),
      board('middle', 'Sketch Notes', 20),
    ])
    const { wrapper, router } = await mountHome()

    await wrapper.get('.board-recent-section .board-card-menu').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('board')
    const favoriteOption = Array.from(document.body.querySelectorAll<HTMLElement>('.n-dropdown-option'))
      .find((element) => element.textContent?.trim() === 'Add to favorites')
    favoriteOption?.querySelector<HTMLElement>('.n-dropdown-option-body')?.click()
    await flushPromises()

    await wrapper.get('[data-testid="board-quick-tab-favorites"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.board-home-eyebrow').text()).toBe('Board')
    expect(wrapper.get('.board-recent-section h2').text()).toBe('Quick access')
    expect(wrapper.get('[data-testid="board-quick-tab-favorites"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.findAll('.board-recent-section [data-testid="board-card-title"]').map((item) => item.text())).toEqual([
      'Project Atlas',
    ])
    expect(JSON.parse(localStorage.getItem('docus.board.favorites') ?? '[]')).toEqual(['newer'])
    wrapper.unmount()
  })

  it('limits favorites to five boards without expanding the quick access row', async () => {
    api.listBoards.mockResolvedValue([
      board('one', 'Board 1', 1),
      board('two', 'Board 2', 2),
      board('three', 'Board 3', 3),
      board('four', 'Board 4', 4),
      board('five', 'Board 5', 5),
      board('six', 'Board 6', 6),
    ])
    useBoardFavorites().favoriteBoardIds.value = ['one', 'two', 'three', 'four', 'five', 'six']
    const { wrapper } = await mountHome()

    await wrapper.get('[data-testid="board-quick-tab-favorites"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.board-recent-section [data-testid="board-card-title"]')).toHaveLength(5)
    expect(wrapper.find('[data-testid="board-quick-more-favorites"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('uses last opened time for recent Boards while keeping the all list sortable by edits', async () => {
    api.listBoards.mockResolvedValue([
      board('recently-edited', 'Recently edited', 100, 10),
      board('recently-opened', 'Recently opened', 20, 90),
    ])
    const { wrapper } = await mountHome()

    expect(wrapper.findAll('.board-recent-section [data-testid="board-card-title"]').map((item) => item.text())).toEqual([
      'Recently opened',
      'Recently edited',
    ])

    await wrapper.findComponent(NSelect).vm.$emit('update:value', 'updated')
    await flushPromises()

    expect(wrapper.findAll('.board-all-section [data-testid="board-card-title"]').map((item) => item.text())).toEqual([
      'Recently edited',
      'Recently opened',
    ])
    wrapper.unmount()
  })

  it('resets pagination after search and sort changes', async () => {
    api.listBoards.mockResolvedValue(Array.from({ length: 11 }, (_, index) => (
      board(`board-${index}`, `Board ${index}`, index + 1)
    )))
    const { wrapper } = await mountHome()

    const pageTwo = Array.from((wrapper.element as HTMLElement).querySelectorAll('.n-pagination-item--clickable'))
      .find((item) => item.textContent?.trim() === '2') as HTMLElement | undefined
    expect(pageTwo).toBeDefined()
    pageTwo?.click()
    await flushPromises()
    expect(wrapper.find('.n-pagination-item--active').text()).toBe('2')

    await wrapper.find('.board-search-input input').setValue('Board 1')
    await flushPromises()
    expect(wrapper.find('.n-pagination-item--active').text()).toBe('1')

    await wrapper.find('.board-search-input input').setValue('')
    await flushPromises()
    const pageTwoAgain = Array.from((wrapper.element as HTMLElement).querySelectorAll('.n-pagination-item--clickable'))
      .find((item) => item.textContent?.trim() === '2') as HTMLElement | undefined
    pageTwoAgain?.click()
    await flushPromises()
    await wrapper.findComponent(NSelect).vm.$emit('update:value', 'updated')
    await flushPromises()

    expect(wrapper.find('.n-pagination-item--active').text()).toBe('1')
    expect(wrapper.find('.board-all-section [data-testid="board-card-title"]').text()).toBe('Board 10')
    wrapper.unmount()
  })

  it('moves back to the previous page after deleting its last Board', async () => {
    api.listBoards.mockResolvedValue(Array.from({ length: 11 }, (_, index) => (
      board(`board-${index}`, `Board ${index}`, 100 - index)
    )))
    api.deleteBoard.mockResolvedValueOnce(undefined)
    const { wrapper } = await mountHome()

    const pageTwo = Array.from((wrapper.element as HTMLElement).querySelectorAll('.n-pagination-item--clickable'))
      .find((item) => item.textContent?.trim() === '2') as HTMLElement | undefined
    pageTwo?.click()
    await flushPromises()
    const lastCard = wrapper.get('.board-all-section .board-card')
    const lastBoard = boardMetadataSource.getSnapshot().find((item) => item.id === lastCard.attributes('data-board-id'))
    expect(lastBoard).toBeDefined()
    wrapper.find('.board-all-section').findComponent(BoardGallery).vm.$emit('delete', lastBoard)
    await flushPromises()

    expect(api.deleteBoard).toHaveBeenCalledWith(lastBoard!.id)
    expect(wrapper.find('.n-pagination-item--active').text()).toBe('1')
    expect(wrapper.findAll('.board-all-section .board-card')).toHaveLength(10)
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
