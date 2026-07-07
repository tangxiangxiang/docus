// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import HistoryPanel from '../HistoryPanel.vue'
import { __resetHistoryStateForTesting } from '../../../composables/vault/useHistory'
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
})

afterEach(() => {
  __resetHistoryStateForTesting()
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
