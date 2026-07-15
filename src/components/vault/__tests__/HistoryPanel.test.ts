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

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  __resetHistoryStateForTesting()
  vi.clearAllMocks()
  useI18n().setLocale('en')
  vi.mocked(api.getCapability).mockResolvedValue({ gitAvailable: true, repoInitialized: true })
  vi.mocked(api.getStatus).mockResolvedValue({ dirty: [], available: true })
  vi.mocked(api.getLog).mockResolvedValue({ commits: [] })
})

afterEach(() => {
  __resetHistoryStateForTesting()
  vi.useRealTimers()
})

describe('HistoryPanel document timeline', () => {
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

    const wrapper = mount(HistoryPanel, {
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

  it('shows Created for a document with one revision', async () => {
    const only = commit('created-sha', NOW, 'Initial commit', ['inbox/first.md'])
    vi.mocked(api.getLog).mockResolvedValue({ commits: [only] })

    const wrapper = mount(HistoryPanel, {
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

    const wrapper = mount(HistoryPanel, {
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

    const wrapper = mount(HistoryPanel)
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

    const wrapper = mount(HistoryPanel)
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
    const wrapper = mount(HistoryPanel, { attachTo: host })
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

    const wrapper = mount(HistoryPanel)
    await flushPromises()
    expect(wrapper.get('.history-title').text()).toBe('历史')
    expect(wrapper.get('.history-skeleton').attributes('aria-label')).toBe('正在加载历史记录…')

    resolveLog({ commits: [] })
    await flushPromises()
    expect(wrapper.get('.history-empty-inline').text()).toBe('还没有历史记录。')
  })
})
