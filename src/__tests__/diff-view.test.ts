// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DiffView from '../components/vault/DiffView.vue'
import { useHistory, __resetHistoryStateForTesting } from '../composables/vault/useHistory'
import { useI18n } from '../composables/useI18n'
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
    restoreFile: vi.fn(),
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

  it('renders the empty state in Chinese when the locale is zh', () => {
    const { setLocale } = useI18n()
    setLocale('zh')
    try {
      const wrapper = renderDiffView()
      expect(wrapper.text()).toContain('未选择文件')
      expect(wrapper.attributes('aria-label')).toBe('差异')
    } finally {
      setLocale('en')
    }
  })
})

// Module-level helper: pre-populate the singleton's currentDiff via
// the public composable action. Used by both the row-pairing tests
// (which render diff content) and the restore-button tests (which
// need a non-empty diff so the button shows up). Hoisted to module
// scope so multiple `describe` blocks can share it.
async function loadDiffWith(
  diff: api.FileDiff,
  file = 'inbox/a.md',
  refs: { oldRef?: string; newRef?: string } = {},
) {
  const oldRef = refs.oldRef ?? 'HEAD~1'
  const newRef = refs.newRef ?? 'HEAD'
  vi.mocked(api.getDiff).mockResolvedValue({
    path: file, oldRef, newRef, diff,
  })
  const h = useHistory()
  await h.selectFile(file, { oldRef, newRef })
}

function paneRows(wrapper: ReturnType<typeof renderDiffView>, side: 'old' | 'new') {
  return wrapper
    .find(`.diff-pane-${side}`)
    .findAll('.diff-row')
}

function rowCells(wrapper: ReturnType<typeof renderDiffView>, side: 'old' | 'new', index: number) {
  return paneRows(wrapper, side)[index].findAll('.diff-cell')
}

describe('DiffView row pairing', () => {
  // Pre-populate the singleton's currentDiff via a direct write —
  // we don't want to round-trip through the mocked api just to
  // exercise the rendering layer. The composable's `_currentDiff`
  // ref is module-scoped, and `useHistory()` returns it; we just
  // call `selectFile` to set the file, then poke the ref via the
  // public action `loadDiffForSelection` after stubbing the api.

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
    expect(wrapper.find('.diff-pane-old .diff-pane-title').text()).toContain('HEAD~1')
    expect(wrapper.find('.diff-pane-new .diff-pane-title').text()).toContain('HEAD')
    expect(paneRows(wrapper, 'old')).toHaveLength(2)
    expect(paneRows(wrapper, 'new')).toHaveLength(2)
    const oldCells0 = rowCells(wrapper, 'old', 0)
    const newCells0 = rowCells(wrapper, 'new', 0)
    expect(oldCells0).toHaveLength(2)
    expect(oldCells0[0].text()).toBe('1')
    expect(oldCells0[1].text()).toBe('a')
    expect(newCells0[0].text()).toBe('1')
    expect(newCells0[1].text()).toBe('a')
  })

  it('labels sha~1 old refs as the resolved parent commit when available', async () => {
    await loadDiffWith({
      ops: [{ op: 'equal', oldLine: 1, newLine: 1, text: 'a' }],
      stats: { added: 0, removed: 0, equal: 1 },
    }, 'inbox/a.md', {
      oldRef: '6a057c9000000000000000000000000000000000~1',
      newRef: '6a057c9000000000000000000000000000000000',
    })
    useHistory().log.value = [
      {
        sha: '6a057c9000000000000000000000000000000000',
        author: 'A',
        date: new Date().toISOString(),
        subject: 'new',
        body: '',
        files: ['inbox/a.md'],
      },
      {
        sha: 'aeab6d6000000000000000000000000000000000',
        author: 'A',
        date: new Date().toISOString(),
        subject: 'old',
        body: '',
        files: ['inbox/a.md'],
      },
    ]
    const wrapper = renderDiffView()
    await flushPromises()
    expect(wrapper.find('.diff-pane-old .diff-pane-title').text()).toContain('aeab6d6')
    expect(wrapper.find('.diff-pane-new .diff-pane-title').text()).toContain('6a057c9')
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
    expect(paneRows(wrapper, 'old')[0].classes()).toContain('is-del')
    const oldCells = rowCells(wrapper, 'old', 0)
    const newCells = rowCells(wrapper, 'new', 0)
    expect(oldCells[0].text()).toBe('1')
    expect(oldCells[1].text()).toBe('gone')
    expect(newCells[0].text()).toBe('')
    expect(newCells[1].text()).toBe('')
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
    expect(paneRows(wrapper, 'new')[0].classes()).toContain('is-add')
    const oldCells = rowCells(wrapper, 'old', 0)
    const newCells = rowCells(wrapper, 'new', 0)
    expect(oldCells[0].text()).toBe('')
    expect(oldCells[1].text()).toBe('')
    expect(newCells[0].text()).toBe('1')
    expect(newCells[1].text()).toBe('fresh')
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
    expect(paneRows(wrapper, 'old')[0].classes()).toContain('is-edit')
    expect(paneRows(wrapper, 'new')[0].classes()).toContain('is-edit')
    const oldSpans = rowCells(wrapper, 'old', 0)[1].findAll('.diff-word')
    const newSpans = rowCells(wrapper, 'new', 0)[1].findAll('.diff-word')
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
    const oldRows = paneRows(wrapper, 'old')
    const newRows = paneRows(wrapper, 'new')
    // max(2 removes, 3 adds) = 3 paired rows per pane
    expect(oldRows).toHaveLength(3)
    expect(newRows).toHaveLength(3)
    expect(oldRows[0].classes()).toContain('is-edit')
    expect(newRows[0].classes()).toContain('is-edit')
    expect(oldRows[1].classes()).toContain('is-edit')
    expect(newRows[1].classes()).toContain('is-edit')
    expect(newRows[2].classes()).toContain('is-add')
    expect(rowCells(wrapper, 'old', 2)[1].text()).toBe('')
    expect(rowCells(wrapper, 'new', 2)[1].text()).toBe('a3')
  })

  it('synchronizes vertical scroll between the old and new panes', async () => {
    await loadDiffWith({
      ops: [
        { op: 'equal', oldLine: 1, newLine: 1, text: 'a' },
        { op: 'equal', oldLine: 2, newLine: 2, text: 'b' },
      ],
      stats: { added: 0, removed: 0, equal: 2 },
    })
    const wrapper = renderDiffView()
    await flushPromises()
    const oldPane = wrapper.get('.diff-pane-old').element as HTMLElement
    const newPane = wrapper.get('.diff-pane-new').element as HTMLElement

    oldPane.scrollTop = 42
    await wrapper.get('.diff-pane-old').trigger('scroll')
    expect(newPane.scrollTop).toBe(42)

    await new Promise((resolve) => requestAnimationFrame(resolve))
    newPane.scrollTop = 17
    await wrapper.get('.diff-pane-new').trigger('scroll')
    expect(oldPane.scrollTop).toBe(17)
  })
})

describe('DiffView restore button', () => {
  // The restore button is destructive: it overwrites the on-disk
  // file via `git checkout <ref> -- <path>`. We confirm with a
  // native window.confirm() and only call the composable action
  // when the user accepts. These tests stub window.confirm and
  // spy on the composable's restoreFile to verify the flow.
  async function loadDiffWithOneRemove() {
    await loadDiffWith({
      ops: [
        { op: 'remove', oldLine: 1, newLine: null, text: 'gone' },
        { op: 'add', oldLine: null, newLine: 1, text: 'fresh' },
      ],
      stats: { added: 1, removed: 1, equal: 0 },
    })
  }

  it('renders the Restore old version button when a diff is loaded', async () => {
    await loadDiffWithOneRemove()
    const wrapper = renderDiffView()
    await flushPromises()
    const btn = wrapper.find('.diff-restore-btn')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('Restore old version')
  })

  it('hides the button when the diff is empty (no-op would be confusing)', async () => {
    await loadDiffWith({ ops: [], stats: { added: 0, removed: 0, equal: 0 } })
    const wrapper = renderDiffView()
    await flushPromises()
    expect(wrapper.find('.diff-restore-btn').exists()).toBe(false)
  })

  it('hides the button for a newly added file with no old-side blob', async () => {
    await loadDiffWith({
      ops: [{ op: 'add', oldLine: null, newLine: 1, text: 'new file' }],
      stats: { added: 1, removed: 0, equal: 0 },
    }, { oldRef: 'HEAD', newRef: api.WORKTREE_REF })
    const wrapper = renderDiffView()
    await flushPromises()
    expect(wrapper.find('.diff-restore-btn').exists()).toBe(false)
  })

  it('hides the button when no file is selected', () => {
    const wrapper = renderDiffView()
    expect(wrapper.find('.diff-restore-btn').exists()).toBe(false)
  })

  it('does NOT call restoreFile when the user cancels the confirm dialog', async () => {
    await loadDiffWithOneRemove()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      const wrapper = renderDiffView()
      await flushPromises()
      await wrapper.find('.diff-restore-btn').trigger('click')
      // The composable's restoreFile is mocked at the module level;
      // it should NOT have been invoked because confirm returned
      // false.
      expect(api.restoreFile).not.toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('calls restoreFile when the user accepts the confirm dialog', async () => {
    await loadDiffWithOneRemove()
    vi.mocked(api.restoreFile).mockResolvedValue({ path: 'inbox/a.md', ref: 'HEAD~1' })
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      const wrapper = renderDiffView()
      await flushPromises()
      await wrapper.find('.diff-restore-btn').trigger('click')
      // The click triggers an async chain (confirm → composable →
      // fetch). flush twice so the awaited restoreFile mock
      // resolves before we assert.
      await flushPromises()
      await flushPromises()
      expect(api.restoreFile).toHaveBeenCalledWith('inbox/a.md', 'HEAD~1')
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
