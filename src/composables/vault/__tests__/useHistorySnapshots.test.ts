import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHistorySnapshots, type HistoryRevisionSelection } from '../useHistorySnapshots'
import * as api from '../../../lib/history-api'

vi.mock('../../../lib/history-api', async () => {
  const actual = await vi.importActual<typeof api>('../../../lib/history-api')
  return { ...actual, getFileAt: vi.fn() }
})

const selection = (overrides: Partial<HistoryRevisionSelection> = {}): HistoryRevisionSelection => ({
  documentPath: 'inbox/redis',
  documentTitle: 'Redis Notes',
  revisionId: 'revision-a',
  revisionTime: 1_752_566_260_000,
  summary: 'Update cache section',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useHistorySnapshots', () => {
  it('loads exact Git content lazily and caches the active revision', async () => {
    vi.mocked(api.getFileAt).mockResolvedValue({
      path: 'inbox/redis.md',
      ref: 'revision-a',
      content: '# Historical Redis\n\nExact snapshot.',
    })
    const history = useHistorySnapshots()

    const request = history.openRevision(selection())
    expect(history.activeSnapshot.value?.status).toBe('loading')
    expect(history.activeSnapshot.value?.rawMarkdown).toBe('')
    await request

    expect(api.getFileAt).toHaveBeenCalledWith('inbox/redis.md', 'revision-a')
    expect(history.activeSnapshot.value?.rawMarkdown).toBe('# Historical Redis\n\nExact snapshot.')
    expect(history.activeSnapshot.value?.status).toBe('ready')

    await history.openRevision(selection())
    expect(api.getFileAt).toHaveBeenCalledTimes(1)
  })

  it('reuses one history tab per document when another revision is selected', async () => {
    vi.mocked(api.getFileAt)
      .mockResolvedValueOnce({ path: 'inbox/redis.md', ref: 'revision-a', content: 'A' })
      .mockResolvedValueOnce({ path: 'inbox/redis.md', ref: 'revision-b', content: 'B' })
    const history = useHistorySnapshots()

    await history.openRevision(selection())
    await history.openRevision(selection({ revisionId: 'revision-b', summary: 'Second revision' }))

    expect(history.snapshots.value).toHaveLength(1)
    expect(history.activeSnapshot.value?.tabId).toBe('history:inbox/redis')
    expect(history.activeSnapshot.value?.revisionId).toBe('revision-b')
    expect(history.activeSnapshot.value?.rawMarkdown).toBe('B')
  })

  it('keeps the history tab open with an inline error when loading fails', async () => {
    vi.mocked(api.getFileAt).mockRejectedValue('failed')
    const history = useHistorySnapshots()

    await history.openRevision(selection())

    expect(history.snapshots.value).toHaveLength(1)
    expect(history.activeSnapshot.value?.status).toBe('error')
    expect(history.activeSnapshot.value?.error).toBeNull()
  })
})
