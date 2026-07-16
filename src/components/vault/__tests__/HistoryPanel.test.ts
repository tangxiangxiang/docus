// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import HistoryPanel from '../HistoryPanel.vue'
import { __resetHistoryStateForTesting, useHistory } from '../../../composables/vault/useHistory'
import { useHistoryCommit } from '../../../composables/vault/useHistoryCommit'
import { useHistoryWithdraw } from '../../../composables/vault/useHistoryWithdraw'
import { useI18n } from '../../../composables/useI18n'
import { useConfirm } from '../../../composables/useConfirm'
import * as api from '../../../lib/history-api'
import ConfirmHost from '../../ConfirmHost.vue'

vi.mock('../../../lib/history-api', async () => {
  const actual = await vi.importActual<typeof api>('../../../lib/history-api')
  return {
    ...actual,
    getCapability: vi.fn(),
    getStatus: vi.fn(),
    getLog: vi.fn(),
    createCommit: vi.fn(),
    getContentHashes: vi.fn(),
    repairIndex: vi.fn(),
    getIndexRepairStatus: vi.fn().mockResolvedValue([]),
    discardIndexRepair: vi.fn(),
    dropCommit: vi.fn(),
  }
})

const NOW = new Date(2026, 6, 15, 12, 0).getTime()
const commit = (sha: string, date: number, subject: string, files: string[]): api.CommitRecord => ({
  sha,
  author: 'A',
  date: new Date(date).toISOString(),
  subject,
  body: '',
  files,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mountPanel(options: any = {}) {
  const { saveBeforeCommit = async () => {}, withdraw: suppliedWithdraw, ...props } = options.props ?? {}
  const history = useHistory()
  const historyCommit = useHistoryCommit({ history, saveSelected: saveBeforeCommit })
  const withdraw = suppliedWithdraw ?? createWithdraw(history, historyCommit)
  return mount(HistoryPanel, {
    ...options,
    props: { ...props, history, commit: historyCommit, withdraw },
  })
}

function createWithdraw(history: ReturnType<typeof useHistory>, commitState: ReturnType<typeof useHistoryCommit>) {
  return useHistoryWithdraw({
    history,
    confirm: async () => true,
    acquireMutation: () => () => {},
    refreshComparisons: async () => {},
    refreshIndexRepairStatus: commitState.refreshIndexRepairStatus,
    registerIndexRepair: commitState.registerIndexRepair,
    settleIndexRepairPaths: commitState.settleIndexRepairPaths,
    closeDroppedRevision: () => {},
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  __resetHistoryStateForTesting()
  vi.clearAllMocks()
  useI18n().setLocale('en')
  vi.mocked(api.getCapability).mockResolvedValue({ gitAvailable: true, repoInitialized: true })
  vi.mocked(api.getStatus).mockResolvedValue({ dirty: [], available: true })
  vi.mocked(api.getLog).mockResolvedValue({ commits: [] })
  vi.mocked(api.createCommit).mockResolvedValue({ sha: 'new-version', filesCommitted: [] })
  vi.mocked(api.getContentHashes).mockImplementation(async (paths) => (
    Object.fromEntries(paths.map((path) => [path, 'a'.repeat(64)]))
  ))
  vi.mocked(api.dropCommit).mockResolvedValue({
    sha: '',
    droppedSha: 'new-version',
    filesChanged: [],
    indexRefreshFailed: false,
    repairStatePersistenceFailed: false,
  })
})

afterEach(() => {
  __resetHistoryStateForTesting()
  vi.useRealTimers()
})

describe('HistoryPanel document timeline', () => {
  it('offers withdrawal only for the latest version and confirms, single-flights, and restores focus', async () => {
    const latest = commit('latest', NOW, 'Latest version', ['inbox/a.md'])
    const older = commit('older', NOW - 60_000, 'Older version', ['inbox/a.md'])
    const request = deferred<api.DropCommitResult>()
    vi.mocked(api.getLog).mockImplementation(async () => ({
      commits: vi.mocked(api.dropCommit).mock.calls.length > 0
        ? [older]
        : [latest, older],
    }))
    vi.mocked(api.dropCommit).mockReturnValue(request.promise)
    const history = useHistory()
    const commitState = useHistoryCommit({ history, saveSelected: vi.fn() })
    const { confirm } = useConfirm()
    const { t } = useI18n()
    const withdraw = useHistoryWithdraw({
      history,
      confirm: () => confirm(t('history.withdraw_title'), t('history.withdraw_detail'), {
        confirmLabel: t('history.withdraw_confirm'),
        cancelLabel: t('history.withdraw_cancel'),
        destructive: true,
      }),
      acquireMutation: () => () => {},
      refreshComparisons: async () => {},
      refreshIndexRepairStatus: commitState.refreshIndexRepairStatus,
      registerIndexRepair: commitState.registerIndexRepair,
      settleIndexRepairPaths: commitState.settleIndexRepairPaths,
      closeDroppedRevision: () => {},
    })
    const host = mount(ConfirmHost)
    const wrapper = mount(HistoryPanel, {
      attachTo: document.body,
      props: {
        history,
        commit: commitState,
        withdraw,
        posts: [{ path: 'inbox/a', title: 'A', created: '', updated: '', tags: [], size: 0, mtime: 0 }],
      },
    })
    await flushPromises()
    await wrapper.get('.history-document-row').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.history-revision-row')).toHaveLength(2)
    expect(wrapper.findAll('.history-withdraw-version')).toHaveLength(1)

    await wrapper.get('.history-withdraw-version').trigger('click')
    await flushPromises()
    let dialog = document.querySelector<HTMLElement>('.confirm-dialog')!
    expect(dialog.textContent).toContain('Withdraw the latest version?')
    expect(dialog.textContent).toContain('This version will be removed from history')
    expect(dialog.textContent).toContain('Cancel')
    expect(dialog.textContent).toContain('Withdraw version')
    ;(dialog.querySelectorAll('button')[0] as HTMLButtonElement).click()
    await flushPromises()
    expect(api.dropCommit).not.toHaveBeenCalled()

    await wrapper.get('.history-withdraw-version').trigger('click')
    await flushPromises()
    dialog = document.querySelector<HTMLElement>('.confirm-dialog')!
    ;(dialog.querySelectorAll('button')[1] as HTMLButtonElement).click()
    await flushPromises()
    expect(api.dropCommit).toHaveBeenCalledOnce()
    expect(wrapper.get('.history-withdraw-version').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.history-withdraw-version').text()).toContain('Withdrawing')

    await wrapper.get('.history-withdraw-version').trigger('click')
    expect(api.dropCommit).toHaveBeenCalledOnce()
    request.resolve({
      sha: 'older',
      droppedSha: 'latest',
      filesChanged: ['inbox/a.md'],
      indexRefreshFailed: false,
      repairStatePersistenceFailed: false,
    })
    await flushPromises()

    expect(wrapper.findAll('.history-revision-row')).toHaveLength(1)
    expect(wrapper.findAll('.history-withdraw-version')).toHaveLength(1)
    expect(document.activeElement).toBe(wrapper.get('.history-timeline-heading').element)
    wrapper.unmount()
    host.unmount()
  })

  it('preserves message, selection, and single-flight state across sidebar remounts', async () => {
    const dirty = [{ path: 'inbox/a.md', index: ' ', worktree: 'M' }]
    vi.mocked(api.getStatus).mockResolvedValue({ dirty, available: true })
    const request = deferred<api.CommitResult>()
    vi.mocked(api.createCommit).mockReturnValue(request.promise)
    const history = useHistory()
    const historyCommit = useHistoryCommit({ history, saveSelected: vi.fn() })
    const withdraw = createWithdraw(history, historyCommit)
    let wrapper = mount(HistoryPanel, { props: { history, commit: historyCommit, withdraw } })
    await flushPromises()

    await wrapper.get('#history-version-message').setValue('Persistent version')
    await wrapper.get('.history-create-version').trigger('click')
    await flushPromises()
    expect(historyCommit.busy.value).toBe(true)
    wrapper.unmount()

    wrapper = mount(HistoryPanel, { props: { history, commit: historyCommit, withdraw } })
    expect((wrapper.get('#history-version-message').element as HTMLTextAreaElement).value).toBe('Persistent version')
    expect(wrapper.get('input[type="checkbox"]').attributes('checked')).toBeDefined()
    expect(wrapper.get('.history-create-version').attributes('disabled')).toBeDefined()
    await wrapper.get('.history-create-version').trigger('click')
    expect(api.createCommit).toHaveBeenCalledOnce()

    request.resolve({ sha: 'new-version', filesCommitted: ['inbox/a.md'] })
    await flushPromises()
  })

  it('creates a version from only selected exact status paths after save coordination', async () => {
    const dirty = [
      { path: 'inbox/a.md', index: ' ', worktree: 'M' },
      { path: 'inbox/b.md', index: '?', worktree: '?' },
    ]
    vi.mocked(api.getStatus)
      .mockResolvedValueOnce({ dirty, available: true })
      .mockResolvedValue({ dirty: [dirty[1]!], available: true })
    vi.mocked(api.createCommit).mockResolvedValue({ sha: 'new-version', filesCommitted: ['inbox/a.md'] })
    const saveBeforeCommit = vi.fn().mockResolvedValue(undefined)
    const wrapper = mountPanel({ props: { saveBeforeCommit } })
    await flushPromises()

    expect(wrapper.findAll('.history-change-row')).toHaveLength(2)
    await wrapper.findAll('input[type="checkbox"]')[1]!.trigger('change')
    await wrapper.get('#history-version-message').setValue('  Update A  ')
    await wrapper.get('.history-create-version').trigger('click')
    await flushPromises()

    expect(saveBeforeCommit).toHaveBeenCalledWith(['inbox/a.md'])
    expect(api.createCommit).toHaveBeenCalledWith(
      ['inbox/a.md'],
      'Update A',
      { 'inbox/a.md': 'a'.repeat(64) },
    )
    expect(saveBeforeCommit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.createCommit).mock.invocationCallOrder[0]!,
    )
    expect((wrapper.get('#history-version-message').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.findAll('.history-change-row')).toHaveLength(1)
    expect(wrapper.text()).toContain('b.md')
  })

  it('shows a newly created version in Timeline and refreshes an open document revision list', async () => {
    const oldCommit = commit('old', NOW - 60_000, 'Old version', ['inbox/a.md'])
    const newCommit = commit('new', NOW, 'New version', ['inbox/a.md'])
    vi.mocked(api.getStatus)
      .mockResolvedValueOnce({ dirty: [{ path: 'inbox/a.md', index: ' ', worktree: 'M' }], available: true })
      .mockResolvedValue({ dirty: [], available: true })
    vi.mocked(api.getLog).mockImplementation(async (options = {}) => ({
      commits: options.path
        ? (vi.mocked(api.createCommit).mock.calls.length ? [newCommit, oldCommit] : [oldCommit])
        : (vi.mocked(api.createCommit).mock.calls.length ? [newCommit, oldCommit] : [oldCommit]),
    }))
    vi.mocked(api.createCommit).mockResolvedValue({ sha: 'new', filesCommitted: ['inbox/a.md'] })
    const wrapper = mountPanel({
      props: {
        posts: [{ path: 'inbox/a', title: 'A', created: '', updated: '', tags: [], size: 0, mtime: 0 }],
      },
    })
    await flushPromises()
    await wrapper.get('.history-document-row').trigger('click')
    await flushPromises()
    await wrapper.get('.history-revision-row').trigger('click')
    expect(wrapper.get('.history-revision-row').attributes('aria-selected')).toBe('true')

    await wrapper.get('#history-version-message').setValue('New version')
    await wrapper.get('.history-create-version').trigger('click')
    await flushPromises()

    expect(wrapper.get('.history-document-header').text()).toContain('A')
    expect(wrapper.findAll('.history-revision-row')).toHaveLength(2)
    expect(wrapper.findAll('.history-revision-row').every((row) => row.attributes('aria-selected') === 'false')).toBe(true)
    expect(vi.mocked(api.getLog).mock.calls.filter(([options]) => options?.path === 'inbox/a.md')).toHaveLength(2)
  })

  it('distinguishes an initial Timeline failure from an empty repository and retries', async () => {
    vi.mocked(api.getLog).mockRejectedValueOnce(new Error('History API unavailable'))
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.get('.history-error').text()).toContain('History API unavailable')
    expect(wrapper.text()).not.toContain('No history yet.')

    vi.mocked(api.getLog).mockResolvedValueOnce({ commits: [] })
    await wrapper.get('.history-error button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.history-error').exists()).toBe(false)
    expect(wrapper.text()).toContain('No history yet.')
  })

  it('groups recent documents and opens one document revision list', async () => {
    const commits = [
      commit('today', NOW - 60_000, 'Update cache section', ['inbox/redis.md']),
      commit('yesterday', NOW - 86_400_000, 'Add prompt examples', ['inbox/ai-prompt.md']),
      commit('last-week', NOW - 8 * 86_400_000, 'Start cache note', ['inbox/redis.md']),
    ]
    vi.mocked(api.getLog).mockImplementation(async (options = {}) => ({
      commits: options.path
        ? commits.filter((entry) => entry.files.includes(options.path!))
        : commits,
    }))

    const wrapper = mountPanel({
      props: {
        posts: [
          { path: 'inbox/redis', title: 'Redis Notes', created: '', updated: '', tags: [], size: 0, mtime: 0 },
          { path: 'inbox/ai-prompt', title: 'AI Prompt', created: '', updated: '', tags: [], size: 0, mtime: 0 },
        ],
      },
    })
    await flushPromises()

    expect(wrapper.findAll('.history-timeline-group-title').map((node) => node.text())).toEqual([
      'Today',
      'Yesterday',
    ])
    expect(wrapper.findAll('.history-document-row')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('today')
    expect(wrapper.text()).not.toContain('last-week')

    await wrapper.findAll('.history-document-row')[0]!.trigger('click')
    await flushPromises()

    expect(api.getLog).toHaveBeenLastCalledWith({ path: 'inbox/redis.md', limit: 200 })
    expect(wrapper.get('.history-document-header').text()).toContain('Redis Notes')
    expect(wrapper.get('.history-document-header').text()).toContain('2 revisions')
    expect(wrapper.findAll('.history-revision-row')).toHaveLength(2)
    expect(wrapper.text()).toContain('Update cache section')
    expect(wrapper.text()).toContain('Start cache note')
    expect(wrapper.text()).not.toContain('author')
  })

  it('refreshes the selected document revisions after an external HEAD conflict', async () => {
    const first = commit('first', NOW - 60_000, 'First version', ['inbox/redis.md'])
    const external = commit('external', NOW, 'External version', ['inbox/redis.md'])
    let documentRequests = 0
    vi.mocked(api.getLog).mockImplementation(async (options = {}) => {
      if (!options.path) return { commits: [external, first] }
      documentRequests += 1
      return { commits: documentRequests === 1 ? [first] : [external, first] }
    })
    const history = useHistory()
    const historyCommit = useHistoryCommit({ history, saveSelected: vi.fn() })
    const withdraw = createWithdraw(history, historyCommit)
    const wrapper = mount(HistoryPanel, {
      props: {
        history,
        commit: historyCommit,
        withdraw,
        posts: [{
          path: 'inbox/redis',
          title: 'Redis Notes',
          created: '',
          updated: '',
          tags: [],
          size: 0,
          mtime: 0,
        }],
      },
    })
    await flushPromises()
    await wrapper.get('.history-document-row').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.history-revision-row')).toHaveLength(1)

    historyCommit.repositoryChangeId.value += 1
    await flushPromises()

    expect(documentRequests).toBe(2)
    expect(wrapper.findAll('.history-revision-row')).toHaveLength(2)
  })

  it('shows Created for a document with one revision', async () => {
    const only = commit('created-sha', NOW, 'Initial commit', ['inbox/first.md'])
    vi.mocked(api.getLog).mockResolvedValue({ commits: [only] })

    const wrapper = mountPanel({
      props: {
        posts: [{ path: 'inbox/first', title: 'First Note', created: '', updated: '', tags: [], size: 0, mtime: 0 }],
      },
    })
    await flushPromises()
    await wrapper.get('.history-document-row').trigger('click')
    await flushPromises()

    expect(wrapper.get('.history-revision-row').text()).toContain('Created')
    expect(wrapper.text()).not.toContain('Initial commit')
  })

  it('ignores a stale revision response after navigating from document A to B', async () => {
    const a = commit('a-global', NOW, 'A global', ['inbox/a.md'])
    const b = commit('b-global', NOW - 60_000, 'B global', ['inbox/b.md'])
    const aRequest = deferred<{ commits: api.CommitRecord[] }>()
    const bRequest = deferred<{ commits: api.CommitRecord[] }>()
    vi.mocked(api.getLog).mockImplementation((options = {}) => {
      if (options.path === 'inbox/a.md') return aRequest.promise
      if (options.path === 'inbox/b.md') return bRequest.promise
      return Promise.resolve({ commits: [a, b] })
    })

    const wrapper = mountPanel({
      props: {
        posts: [
          { path: 'inbox/a', title: 'Document A', created: '', updated: '', tags: [], size: 0, mtime: 0 },
          { path: 'inbox/b', title: 'Document B', created: '', updated: '', tags: [], size: 0, mtime: 0 },
        ],
      },
    })
    await flushPromises()

    await wrapper.findAll('.history-document-row')[0]!.trigger('click')
    await wrapper.get('.history-back-button').trigger('click')
    await wrapper.findAll('.history-document-row')[1]!.trigger('click')

    bRequest.resolve({
      commits: [commit('b-detail', NOW - 60_000, 'B detail', ['inbox/b.md'])],
    })
    await flushPromises()
    expect(wrapper.get('.history-document-header').text()).toContain('Document B')
    expect(wrapper.get('.history-revision-row').text()).toContain('Created')

    aRequest.resolve({
      commits: [commit('a-detail', NOW, 'A detail', ['inbox/a.md'])],
    })
    await flushPromises()
    expect(wrapper.get('.history-document-header').text()).toContain('Document B')
    expect(wrapper.text()).not.toContain('Document A')
  })

  it('renders an empty state when a document history request has no revisions', async () => {
    const global = commit('global', NOW, 'Global revision', ['inbox/empty.md'])
    vi.mocked(api.getLog).mockImplementation(async (options = {}) => ({
      commits: options.path ? [] : [global],
    }))

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('.history-document-row').trigger('click')
    await flushPromises()

    expect(wrapper.get('.history-empty-inline').text()).toBe('No revisions available for this document.')
  })

  it('uses an i18n fallback when revision loading throws a non-Error value', async () => {
    const global = commit('global', NOW, 'Global revision', ['inbox/error.md'])
    vi.mocked(api.getLog).mockImplementation((options = {}) => (
      options.path ? Promise.reject('failed') : Promise.resolve({ commits: [global] })
    ))
    useI18n().setLocale('zh')

    const wrapper = mountPanel()
    await flushPromises()
    await wrapper.get('.history-document-row').trigger('click')
    await flushPromises()

    expect(wrapper.get('.history-error').text()).toContain('加载历史记录失败。')
    expect(wrapper.get('.history-error button').text()).toBe('重试')
  })

  it('supports arrow navigation, Enter selection, and Escape back navigation', async () => {
    const commits = [
      commit('a', NOW, 'A', ['inbox/a.md']),
      commit('b', NOW - 60_000, 'B', ['inbox/b.md']),
    ]
    vi.mocked(api.getLog).mockImplementation(async (options = {}) => ({
      commits: options.path ? commits.filter((entry) => entry.files.includes(options.path!)) : commits,
    }))

    const host = document.createElement('div')
    document.body.appendChild(host)
    const wrapper = mountPanel({ attachTo: host })
    await flushPromises()
    const rows = wrapper.findAll<HTMLButtonElement>('.history-document-row')
    rows[0]!.element.focus()
    await rows[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1]!.element)

    await rows[1]!.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(wrapper.get('.history-document-header').text()).toContain('B')

    await wrapper.get('.history-revision-row').trigger('keydown', { key: 'Enter' })
    expect(wrapper.get('.history-revision-row').attributes('aria-selected')).toBe('true')
    expect(wrapper.emitted('open-revision')?.[0]?.[0]).toMatchObject({
      documentPath: 'inbox/b',
      documentTitle: 'B',
      revisionId: 'b',
      summary: 'B',
    })

    await wrapper.get('.history-revision-row').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('.history-document-header').exists()).toBe(false)
    expect(wrapper.findAll('.history-document-row')).toHaveLength(2)
    wrapper.unmount()
    host.remove()
  })

  it('renders translated empty and loading states', async () => {
    let resolveLog!: (value: { commits: api.CommitRecord[] }) => void
    vi.mocked(api.getLog).mockReturnValue(new Promise((resolve) => { resolveLog = resolve }))
    useI18n().setLocale('zh')

    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.get('.history-title').text()).toBe('历史')
    expect(wrapper.get('.history-skeleton').attributes('aria-label')).toBe('正在加载历史记录…')

    resolveLog({ commits: [] })
    await flushPromises()
    expect(wrapper.get('.history-empty-inline').text()).toBe('还没有历史记录。')
  })
})
