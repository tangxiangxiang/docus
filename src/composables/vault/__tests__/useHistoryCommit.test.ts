// @vitest-environment jsdom
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHistoryCommit } from '../useHistoryCommit'
import type { HistoryState } from '../useHistory'
import * as api from '../../../lib/history-api'
import { useI18n } from '../../useI18n'

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../../useToast', () => ({ useToast: () => toast }))
vi.mock('../../../lib/history-api', async () => {
  const actual = await vi.importActual<typeof api>('../../../lib/history-api')
  return { ...actual, createCommit: vi.fn() }
})

function history(paths = ['inbox/a.md', 'inbox/b.md']): HistoryState {
  const status = ref(paths.map((path) => ({ path, index: ' ', worktree: 'M' })))
  return {
    capability: ref({ gitAvailable: true, repoInitialized: true }),
    status,
    log: ref([]),
    logLoading: ref(false),
    logLoaded: ref(true),
    logError: ref(null),
    available: ref(true),
    dirtyCount: computed(() => status.value.length),
    refreshCapability: vi.fn(),
    refreshStatus: vi.fn(),
    refreshLog: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useI18n().setLocale('en')
})

describe('useHistoryCommit', () => {
  it('selects the initial changed set, supports partial selection, and preserves exact .md paths', async () => {
    const h = history()
    const saveSelected = vi.fn().mockResolvedValue(undefined)
    vi.mocked(api.createCommit).mockResolvedValue({ sha: 'abc', filesCommitted: ['inbox/a.md'] })
    const commit = useHistoryCommit({ history: h, saveSelected })
    commit.toggle('inbox/b.md')
    commit.message.value = '  Update A  '

    await commit.submit()

    expect(saveSelected).toHaveBeenCalledWith(['inbox/a.md'])
    expect(api.createCommit).toHaveBeenCalledWith(['inbox/a.md'], 'Update A')
    expect(api.createCommit).not.toHaveBeenCalledWith(expect.arrayContaining(['inbox/b.md']), expect.anything())
    expect(h.refreshStatus).toHaveBeenCalledOnce()
    expect(h.refreshLog).toHaveBeenCalledOnce()
    expect(commit.message.value).toBe('')
    expect(commit.selectedPaths.value.size).toBe(0)
  })

  it('supports select all and clear selection without auto-selecting later status additions', async () => {
    const h = history(['a.md'])
    const commit = useHistoryCommit({ history: h, saveSelected: vi.fn() })
    commit.clearSelection()
    expect(commit.canCommit.value).toBe(false)
    h.status.value = [...h.status.value, { path: 'new.md', index: '?', worktree: '?' }]
    await Promise.resolve()
    expect([...commit.selectedPaths.value]).toEqual([])
    commit.selectAll()
    expect([...commit.selectedPaths.value]).toEqual(['a.md', 'new.md'])
  })

  it('rejects empty and whitespace-only messages and prevents duplicate requests', async () => {
    const h = history(['a.md'])
    let release!: () => void
    const saving = new Promise<void>((resolve) => { release = resolve })
    const commit = useHistoryCommit({ history: h, saveSelected: vi.fn(() => saving) })
    expect(await commit.submit()).toBeNull()
    commit.message.value = '   '
    expect(await commit.submit()).toBeNull()
    expect(api.createCommit).not.toHaveBeenCalled()

    commit.message.value = 'Version'
    const first = commit.submit()
    const duplicate = await commit.submit()
    expect(duplicate).toBeNull()
    release()
    vi.mocked(api.createCommit).mockResolvedValue({ sha: 'abc', filesCommitted: ['a.md'] })
    await first
    expect(api.createCommit).toHaveBeenCalledOnce()
  })

  it('does not commit when save fails and preserves selection and message', async () => {
    const h = history(['a.md'])
    const commit = useHistoryCommit({
      history: h,
      saveSelected: vi.fn().mockRejectedValue(new Error('disk full')),
    })
    commit.message.value = 'Keep me'

    await commit.submit()

    expect(api.createCommit).not.toHaveBeenCalled()
    expect(commit.message.value).toBe('Keep me')
    expect([...commit.selectedPaths.value]).toEqual(['a.md'])
    expect(commit.error.value).toContain('disk full')
    expect(commit.busy.value).toBe(false)
  })

  it('preserves input on commit failure and refreshes stale selections without retrying', async () => {
    const h = history(['a.md', 'b.md'])
    vi.mocked(h.refreshStatus).mockImplementation(async () => {
      h.status.value = [{ path: 'b.md', index: ' ', worktree: 'M' }]
    })
    vi.mocked(api.createCommit).mockRejectedValue(new api.HistoryApiError('selection is stale', 409))
    const commit = useHistoryCommit({ history: h, saveSelected: vi.fn() })
    commit.message.value = 'Retry me'

    await commit.submit()

    expect(api.createCommit).toHaveBeenCalledOnce()
    expect(h.refreshStatus).toHaveBeenCalledOnce()
    expect([...commit.selectedPaths.value]).toEqual(['b.md'])
    expect(commit.message.value).toBe('Retry me')
    expect(commit.error.value).toContain('Review the refreshed list')
  })

  it('keeps the message, selection, and workspace content after a normal commit failure', async () => {
    const h = history(['a.md'])
    const editor = { raw: '# Current', saveStatus: 'idle' }
    const snapshot = { rawMarkdown: '# Historical' }
    const diff = { oldRaw: '# Historical', newRaw: '# Current' }
    vi.mocked(api.createCommit).mockRejectedValue(new Error('author identity missing'))
    const commit = useHistoryCommit({ history: h, saveSelected: vi.fn() })
    commit.message.value = 'Keep everything'

    await commit.submit()

    expect(commit.message.value).toBe('Keep everything')
    expect([...commit.selectedPaths.value]).toEqual(['a.md'])
    expect(editor).toEqual({ raw: '# Current', saveStatus: 'idle' })
    expect(snapshot.rawMarkdown).toBe('# Historical')
    expect(diff).toEqual({ oldRaw: '# Historical', newRaw: '# Current' })
    expect(h.refreshStatus).not.toHaveBeenCalled()
    expect(h.refreshLog).not.toHaveBeenCalled()
  })

  it('updates the shared dirty count while leaving uncommitted files dirty', async () => {
    const h = history(['a.md', 'b.md'])
    vi.mocked(h.refreshStatus).mockImplementation(async () => {
      h.status.value = [{ path: 'b.md', index: ' ', worktree: 'M' }]
    })
    vi.mocked(api.createCommit).mockResolvedValue({ sha: 'abc', filesCommitted: ['a.md'] })
    const commit = useHistoryCommit({ history: h, saveSelected: vi.fn() })
    commit.toggle('b.md')
    commit.message.value = 'Only A'

    await commit.submit()

    expect(h.dirtyCount.value).toBe(1)
    expect(h.status.value[0]?.path).toBe('b.md')
  })

  it('refreshes existing comparisons after a successful commit', async () => {
    const h = history(['a.md'])
    const refreshComparisons = vi.fn()
    vi.mocked(api.createCommit).mockResolvedValue({ sha: 'abc', filesCommitted: ['a.md'] })
    const commit = useHistoryCommit({ history: h, saveSelected: vi.fn(), refreshComparisons })
    commit.message.value = 'Version'
    await commit.submit()
    expect(refreshComparisons).toHaveBeenCalledWith(['a.md'])
  })

  it('keeps the barrier through commit and releases it before post-commit refreshes', async () => {
    const h = history(['a.md'])
    const calls: string[] = []
    const release = vi.fn(async () => { calls.push('release') })
    vi.mocked(h.refreshStatus).mockImplementation(async () => { calls.push('status') })
    vi.mocked(h.refreshLog).mockImplementation(async () => { calls.push('log') })
    vi.mocked(api.createCommit).mockImplementation(async () => {
      calls.push('commit')
      return { sha: 'abc', filesCommitted: ['a.md'] }
    })
    const commit = useHistoryCommit({
      history: h,
      saveSelected: vi.fn(async () => {
        calls.push('barrier')
        return release
      }),
    })
    commit.message.value = 'Version'

    await commit.submit()

    expect(calls[0]).toBe('barrier')
    expect(calls[1]).toBe('commit')
    expect(calls[2]).toBe('release')
    expect(calls.slice(3).sort()).toEqual(['log', 'status'])
    expect(release).toHaveBeenCalledOnce()
  })
})
