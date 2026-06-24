// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import DiffView from '../components/vault/DiffView.vue'
import { useHistory, __resetHistoryStateForTesting } from '../composables/vault/useHistory'
import * as api from '../lib/history-api'

// Mock the network layer so the test doesn't need the dev server.
// We default to "no diff loaded" and let each test pre-populate the
// useHistory singleton's currentDiff ref via the composable's
// actions, which we'll then mock.
vi.mock('../lib/history-api', async () => {
  const actual = await vi.importActual<typeof api>('../lib/history-api')
  return {
    ...actual,
    getCapability: vi.fn().mockResolvedValue({ gitAvailable: true, repoInitialized: true }),
    getStatus: vi.fn().mockResolvedValue({ dirty: [], available: true }),
    getLog: vi.fn().mockResolvedValue({ commits: [] }),
    getDiff: vi.fn(),
    createCommit: vi.fn(),
  }
})

beforeEach(() => {
  __resetHistoryStateForTesting()
  vi.clearAllMocks()
})

afterEach(() => {
  __resetHistoryStateForTesting()
})

function renderDiffView() {
  return mount(DiffView, {
    global: {
      stubs: {
        // DiffView is a leaf component — no children to stub.
      },
    },
  })
}

describe('DiffView empty state', () => {
  it('shows the "no file selected" prompt when selectedFile is null', () => {
    const wrapper = renderDiffView()
    expect(wrapper.find('.diff-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('No file selected')
  })
})

describe('DiffView row pairing', () => {
  // Pre-populate the singleton's currentDiff via a direct write —
  // we don't want to round-trip through the mocked api just to
  // exercise the rendering layer. The composable's `_currentDiff`
  // ref is module-scoped, and `useHistory()` returns it; we just
  // call `selectFile` to set the file, then poke the ref via the
  // public action `loadDiffForSelection` after stubbing the api.
  async function loadDiffWith(diff: api.FileDiff, file = 'inbox/a.md') {
    vi.mocked(api.getDiff).mockResolvedValue({
      path: file, oldRef: 'HEAD~1', newRef: 'HEAD', diff,
    })
    const h = useHistory()
    await h.selectFile(file, { oldRef: 'HEAD~1', newRef: 'HEAD' })
    // selectFile already calls loadDiffForSelection, but we re-call
    // for clarity in case the test wants to override the mock
    // result post-selectFile. (No-op if the mock is already set.)
    return h
  }

  it('renders one row per equal op with line numbers on both sides', async () => {
    await loadDiffWith({
      ops: [
        { op: 'equal', oldLine: 1, newLine: 1, text: 'a' },
        { op: 'equal', oldLine: 2, newLine: 2, text: 'b' },
      ],
      stats: { added: 0, removed: 0, equal: 2 },
    })
    const wrapper = renderDiffView()
    await flushPromises()
    const rows = wrapper.findAll('.diff-row').filter((r) => !r.classes('diff-row-head'))
    expect(rows).toHaveLength(2)
    // Row layout: [old-num, old-text, new-num, new-text]
    const cells0 = rows[0].findAll('.diff-cell')
    expect(cells0).toHaveLength(4)
    expect(cells0[0].text()).toBe('1')
    expect(cells0[1].text()).toBe('a')
    expect(cells0[2].text()).toBe('1')
    expect(cells0[3].text()).toBe('a')
  })

  it('renders a remove row with the old line and a blank new side', async () => {
    await loadDiffWith({
      ops: [
        { op: 'remove', oldLine: 1, newLine: null, text: 'gone' },
      ],
      stats: { added: 0, removed: 1, equal: 0 },
    })
    const wrapper = renderDiffView()
    await flushPromises()
    const row = wrapper.find('.diff-row.is-del')
    expect(row.exists()).toBe(true)
    const cells = row.findAll('.diff-cell')
    expect(cells[0].text()).toBe('1')
    expect(cells[1].text()).toBe('gone')
    expect(cells[2].text()).toBe('')
    expect(cells[3].text()).toBe('')
  })

  it('renders an add row with the new line and a blank old side', async () => {
    await loadDiffWith({
      ops: [
        { op: 'add', oldLine: null, newLine: 1, text: 'fresh' },
      ],
      stats: { added: 1, removed: 0, equal: 0 },
    })
    const wrapper = renderDiffView()
    await flushPromises()
    const row = wrapper.find('.diff-row.is-add')
    expect(row.exists()).toBe(true)
    const cells = row.findAll('.diff-cell')
    expect(cells[0].text()).toBe('')
    expect(cells[1].text()).toBe('')
    expect(cells[2].text()).toBe('1')
    expect(cells[3].text()).toBe('fresh')
  })

  it('renders word-level diff chunks when the L1 layer attached them', async () => {
    await loadDiffWith({
      ops: [
        { op: 'remove', oldLine: 1, newLine: null, text: 'line one', words: [
          { op: 'equal', oldLine: 1, newLine: 1, text: 'line ' },
          { op: 'remove', oldLine: 1, newLine: 1, text: 'one' },
        ] },
        { op: 'add', oldLine: null, newLine: 1, text: 'LINE ONE', words: [
          { op: 'add', oldLine: 1, newLine: 1, text: 'LINE' },
          { op: 'equal', oldLine: 1, newLine: 1, text: ' ONE' },
        ] },
      ],
      stats: { added: 1, removed: 1, equal: 0 },
    })
    const wrapper = renderDiffView()
    await flushPromises()
    const row = wrapper.find('.diff-row.is-edit')
    expect(row.exists()).toBe(true)
    const cells = row.findAll('.diff-cell')
    // Old column is cells[1] (the diff-cell-text on the old side).
    // New column is cells[3].
    const oldSpans = cells[1].findAll('.diff-word')
    const newSpans = cells[3].findAll('.diff-word')
    expect(oldSpans.length).toBeGreaterThan(0)
    expect(newSpans.length).toBeGreaterThan(0)
    expect(oldSpans.some((s) => s.classes().includes('diff-word-equal'))).toBe(true)
    expect(oldSpans.some((s) => s.classes().includes('diff-word-remove'))).toBe(true)
    expect(newSpans.some((s) => s.classes().includes('diff-word-add'))).toBe(true)
    expect(newSpans.some((s) => s.classes().includes('diff-word-equal'))).toBe(true)
  })

  it('shows the "no changes" empty state when the diff is empty', async () => {
    await loadDiffWith({ ops: [], stats: { added: 0, removed: 0, equal: 0 } })
    const wrapper = renderDiffView()
    await flushPromises()
    expect(wrapper.find('.diff-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('No changes')
  })

  it('pairs multiple removes with multiple adds into N rows', async () => {
    await loadDiffWith({
      ops: [
        { op: 'remove', oldLine: 1, newLine: null, text: 'r1' },
        { op: 'remove', oldLine: 2, newLine: null, text: 'r2' },
        { op: 'add', oldLine: null, newLine: 1, text: 'a1' },
        { op: 'add', oldLine: null, newLine: 2, text: 'a2' },
        { op: 'add', oldLine: null, newLine: 3, text: 'a3' },
      ],
      stats: { added: 3, removed: 2, equal: 0 },
    })
    const wrapper = renderDiffView()
    await flushPromises()
    const rows = wrapper.findAll('.diff-row').filter((r) => !r.classes('diff-row-head'))
    // max(2 removes, 3 adds) = 3 rows
    expect(rows).toHaveLength(3)
    // First two rows: del on left, add on right
    expect(rows[0].classes()).toContain('is-edit')
    expect(rows[1].classes()).toContain('is-edit')
    // Last row: only an add (left blank, right has 'a3')
    expect(rows[2].classes()).toContain('is-add')
  })
})
