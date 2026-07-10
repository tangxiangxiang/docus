// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import HistoryPanel from '../HistoryPanel.vue'
import { __resetHistoryStateForTesting } from '../../../composables/vault/useHistory'
import { useI18n } from '../../../composables/useI18n'
import * as api from '../../../lib/history-api'

vi.mock('../../../lib/history-api', async () => {
  const actual = await vi.importActual<typeof api>('../../../lib/history-api')
  return {
    ...actual,
    getCapability: vi.fn(),
    getStatus: vi.fn(),
    getLog: vi.fn(),
    getDiff: vi.fn(),
    createCommit: vi.fn(),
    dropCommit: vi.fn(),
    restoreFile: vi.fn(),
  }
})

const EMPTY_DIFF = {
  ops: [],
  stats: { added: 0, removed: 0, equal: 0 },
}

beforeEach(() => {
  __resetHistoryStateForTesting()
  vi.clearAllMocks()
  vi.mocked(api.getCapability).mockResolvedValue({ gitAvailable: true, repoInitialized: true })
  vi.mocked(api.getStatus).mockResolvedValue({ dirty: [], available: true })
  vi.mocked(api.getLog).mockResolvedValue({ commits: [] })
  vi.mocked(api.getDiff).mockResolvedValue({
    path: 'inbox/new-note.md',
    oldRef: 'HEAD',
    newRef: api.WORKTREE_REF,
    diff: EMPTY_DIFF,
  })
  vi.mocked(api.dropCommit).mockResolvedValue({ sha: 'parent123', filesCommitted: ['inbox/a.md'] })
})

afterEach(() => {
  __resetHistoryStateForTesting()
})

describe('HistoryPanel timeline context menu', () => {
  it('drops a commit from the right-click menu after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    vi.mocked(api.getLog).mockResolvedValue({
      commits: [{
        sha: 'abc1234000000000000000000000000000000000',
        author: 'A',
        date: new Date().toISOString(),
        subject: 'add note',
        body: '',
        files: ['inbox/a.md'],
      }],
    })

    const wrapper = mount(HistoryPanel)
    await flushPromises()
    await wrapper.get('.history-commit-row').trigger('contextmenu', {
      clientX: 10,
      clientY: 20,
    })
    await flushPromises()

    const menuButton = document.body.querySelector<HTMLButtonElement>('.history-context-menu button.danger')
    expect(menuButton?.textContent).toContain('Drop commit')
    menuButton?.click()
    await flushPromises()

    expect(api.dropCommit).toHaveBeenCalledWith('abc1234000000000000000000000000000000000')
    expect(window.confirm).toHaveBeenCalled()
  })
})

describe('HistoryPanel initial selection', () => {
  it('opens an untracked current file as HEAD..WORKTREE instead of HEAD~1..HEAD', async () => {
    vi.mocked(api.getStatus).mockResolvedValue({
      dirty: [{ path: 'inbox/new-note.md', index: '?', worktree: '?' }],
      available: true,
    })

    mount(HistoryPanel, {
      props: { currentPath: 'inbox/new-note' },
    })
    await flushPromises()

    expect(api.getDiff).toHaveBeenCalledWith('inbox/new-note.md', 'HEAD', api.WORKTREE_REF)
  })

  it('opens a clean current file as the latest committed change', async () => {
    mount(HistoryPanel, {
      props: { currentPath: 'inbox/old-note' },
    })
    await flushPromises()

    expect(api.getDiff).toHaveBeenCalledWith('inbox/old-note.md', 'HEAD~1', 'HEAD')
  })
})

describe('HistoryPanel state presentation', () => {
  it('renders semantic status badges and keeps keyboard selection in sync', async () => {
    const sha = 'abc1234000000000000000000000000000000000'
    vi.mocked(api.getStatus).mockResolvedValue({
      dirty: [
        { path: 'inbox/added.md', index: '?', worktree: '?' },
        { path: 'inbox/changed.md', index: ' ', worktree: 'M' },
        { path: 'inbox/deleted.md', index: ' ', worktree: 'D' },
      ],
      available: true,
    })
    vi.mocked(api.getLog).mockResolvedValue({
      commits: [{
        sha,
        author: 'A',
        date: new Date().toISOString(),
        subject: 'state boundary',
        body: '',
        files: ['inbox/changed.md'],
      }],
    })

    const wrapper = mount(HistoryPanel)
    await flushPromises()
    expect(wrapper.findAll('.history-section-count').map((node) => node.text())).toEqual(['3', '1'])
    expect(wrapper.findAll('.history-dirty-status').map((node) => node.text())).toEqual(['A', 'M', 'D'])
    expect(wrapper.get('.history-dirty-status.is-a').attributes('title')).toBe('Added')
    expect(wrapper.get('.history-dirty-status.is-d').attributes('title')).toBe('Deleted')

    await wrapper.findAll('.history-dirty-row')[1].trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.getDiff).toHaveBeenLastCalledWith('inbox/changed.md', 'HEAD', api.WORKTREE_REF)

    await wrapper.get('.history-commit-row').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get('.history-commit-row').classes()).toContain('selected')
    expect(api.getDiff).toHaveBeenLastCalledWith('inbox/changed.md', `${sha}~1`, sha)
  })

  it('renders History controls in Chinese when the locale is zh', async () => {
    const { setLocale } = useI18n()
    setLocale('zh')
    try {
      const wrapper = mount(HistoryPanel)
      await flushPromises()
      expect(wrapper.get('.history-title').text()).toBe('历史')
      expect(wrapper.get('.history-section-changes').text()).toContain('更改')
      expect(wrapper.get('.history-composer-input').attributes('placeholder')).toBe('提交信息…')
      expect(wrapper.get('.history-commit-btn').text()).toBe('提交 0 个文件')
    } finally {
      setLocale('en')
    }
  })
})
