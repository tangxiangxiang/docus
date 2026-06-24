// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useHistory, __resetHistoryStateForTesting } from '../composables/vault/useHistory'
import * as api from '../lib/history-api'

vi.mock('../lib/history-api', async () => {
  const actual = await vi.importActual<typeof api>('../lib/history-api')
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

beforeEach(() => {
  __resetHistoryStateForTesting()
  vi.clearAllMocks()
  // Default: capability says yes, status empty, log empty.
  vi.mocked(api.getCapability).mockResolvedValue({ gitAvailable: true, repoInitialized: true })
  vi.mocked(api.getStatus).mockResolvedValue({ dirty: [], available: true })
  vi.mocked(api.getLog).mockResolvedValue({ commits: [] })
})

afterEach(() => {
  __resetHistoryStateForTesting()
})

describe('useHistory singleton', () => {
  it('returns the same Ref instances across calls (module-level singleton)', () => {
    const a = useHistory()
    const b = useHistory()
    expect(a.status).toBe(b.status)
    expect(a.log).toBe(b.log)
    expect(a.selectedFile).toBe(b.selectedFile)
  })

  it('refreshStatus writes to the shared status ref', async () => {
    vi.mocked(api.getStatus).mockResolvedValueOnce({
      dirty: [
        { path: 'inbox/a.md', index: ' ', worktree: 'M' },
        { path: 'inbox/b.md', index: '?', worktree: '?' },
      ],
      available: true,
    })
    const h = useHistory()
    await h.refreshStatus()
    expect(h.status.value.map((e) => e.path).sort()).toEqual(['inbox/a.md', 'inbox/b.md'])
    expect(h.dirtyCount.value).toBe(2)
  })

  it('refreshLog writes to the shared log ref', async () => {
    vi.mocked(api.getLog).mockResolvedValueOnce({
      commits: [
        { sha: 'a'.repeat(40), author: 'X', date: '2026-01-01T00:00:00Z', subject: 'first', body: '', files: [] },
      ],
    })
    const h = useHistory()
    await h.refreshLog()
    expect(h.log.value).toHaveLength(1)
    expect(h.log.value[0].subject).toBe('first')
  })

  it('selectFile fetches the diff and stores it', async () => {
    vi.mocked(api.getDiff).mockResolvedValueOnce({
      path: 'inbox/a.md', oldRef: 'HEAD~1', newRef: 'HEAD',
      diff: { ops: [{ op: 'add', oldLine: null, newLine: 1, text: 'x' }], stats: { added: 1, removed: 0, equal: 0 } },
    })
    const h = useHistory()
    await h.selectFile('inbox/a.md', { oldRef: 'HEAD~1', newRef: 'HEAD' })
    expect(h.selectedFile.value).toBe('inbox/a.md')
    expect(h.currentDiff.value?.stats.added).toBe(1)
    expect(api.getDiff).toHaveBeenCalledWith('inbox/a.md', 'HEAD~1', 'HEAD')
  })

  it('createCommit calls the API and refreshes status + log on success', async () => {
    vi.mocked(api.createCommit).mockResolvedValueOnce({
      sha: 'b'.repeat(40), filesCommitted: ['inbox/a.md'],
    })
    vi.mocked(api.getStatus).mockResolvedValueOnce({ dirty: [], available: true })
    vi.mocked(api.getLog).mockResolvedValueOnce({ commits: [] })
    const h = useHistory()
    h.commitMessage.value = 'msg'
    const r = await h.createCommit(['inbox/a.md'], 'msg')
    expect(r?.sha).toBe('b'.repeat(40))
    expect(api.createCommit).toHaveBeenCalledWith(['inbox/a.md'], 'msg')
    expect(api.getStatus).toHaveBeenCalled()
    expect(api.getLog).toHaveBeenCalled()
  })

  it('createCommit refuses empty message without hitting the API', async () => {
    const h = useHistory()
    const r = await h.createCommit(['a.md'], '   ')
    expect(r).toBeNull()
    expect(api.createCommit).not.toHaveBeenCalled()
    expect(h.error.value).toMatch(/message/i)
  })

  it('createCommit refuses empty paths without hitting the API', async () => {
    const h = useHistory()
    h.commitMessage.value = 'msg'
    const r = await h.createCommit([], 'msg')
    expect(r).toBeNull()
    expect(api.createCommit).not.toHaveBeenCalled()
    expect(h.error.value).toMatch(/file/i)
  })

  it('createCommit returns the API result on success', async () => {
    vi.mocked(api.createCommit).mockResolvedValueOnce({ sha: 'c'.repeat(40), filesCommitted: ['a.md'] })
    vi.mocked(api.getStatus).mockResolvedValueOnce({ dirty: [], available: true })
    vi.mocked(api.getLog).mockResolvedValueOnce({ commits: [] })
    const h = useHistory()
    h.commitMessage.value = 'msg'
    const r = await h.createCommit(['a.md'], 'msg')
    // The composable does NOT clear `commitMessage` — that's the
    // caller's job (HistoryPanel clears it on success to keep the
    // composable's surface narrow). Document the behavior so a
    // future refactor doesn't quietly change it.
    expect(h.commitMessage.value).toBe('msg')
    expect(r?.sha).toBe('c'.repeat(40))
  })

  it('createCommit surfaces the server error string and does NOT clear composer', async () => {
    vi.mocked(api.createCommit).mockRejectedValueOnce(new Error('nothing to commit'))
    const h = useHistory()
    h.commitMessage.value = 'msg'
    const r = await h.createCommit(['a.md'], 'msg')
    expect(r).toBeNull()
    expect(h.error.value).toBe('nothing to commit')
    expect(h.commitMessage.value).toBe('msg')
  })

  it('toggleDirty adds then removes a path from a Set', () => {
    const h = useHistory()
    const set = new Set<string>()
    h.toggleDirty('a.md', set)
    expect(set.has('a.md')).toBe(true)
    h.toggleDirty('a.md', set)
    expect(set.has('a.md')).toBe(false)
  })

  it('restoreFile calls the API and returns true on success', async () => {
    vi.mocked(api.restoreFile).mockResolvedValueOnce({ path: 'a.md', ref: 'HEAD~1' })
    // After restore the composable refreshes status; mock it to no-op.
    const h = useHistory()
    const r = await h.restoreFile('a.md', 'HEAD~1')
    expect(r).toBe(true)
    expect(api.restoreFile).toHaveBeenCalledWith('a.md', 'HEAD~1')
    expect(h.error.value).toBeNull()
  })

  it('restoreFile surfaces the server error and returns false on failure', async () => {
    vi.mocked(api.restoreFile).mockRejectedValueOnce(new Error('file does not exist at ref HEAD'))
    const h = useHistory()
    const r = await h.restoreFile('a.md', 'HEAD')
    expect(r).toBe(false)
    expect(h.error.value).toMatch(/does not exist at ref/)
  })
})

describe('useHistory hydration', () => {
  it('refreshes capability on first call and exposes available=true', async () => {
    const h = useHistory()
    // The first call to useHistory kicks off the capability probe
    // in the background. Let the microtask queue drain.
    await flushPromises()
    await flushPromises()
    expect(api.getCapability).toHaveBeenCalled()
    expect(h.available.value).toBe(true)
  })

  it('hydrates _hydrated once (subsequent calls do not re-probe)', async () => {
    useHistory()
    await flushPromises()
    const callsAfterFirst = vi.mocked(api.getCapability).mock.calls.length
    useHistory()
    await flushPromises()
    const callsAfterSecond = vi.mocked(api.getCapability).mock.calls.length
    expect(callsAfterSecond).toBe(callsAfterFirst)
  })
})
