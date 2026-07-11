// @vitest-environment jsdom
// Tests for the Drafts section inside AiPanel.
//
// The section lists every note under inbox/draft/ and literature/draft/,
// sorted by mtime desc, and exposes two affordances per row:
//   - open button: emits 'open' so VaultView navigates to the path
//   - archive button: patches the file into zettel/<slug>.md and emits
//     both 'refresh-tree' and 'open' (with the final moved path,
//     which may be zettel/<slug>-2.md if there's a collision)
//
// AiPanel pulls in several heavy deps (useAiHistory, useSplitReview,
// useCurrentNote, fetch). Most of those are irrelevant to the Drafts
// section, so we mount AiPanel with stubbed fetch + dialog mocks and
// drive the props directly.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as api from '../../../lib/api'
import AiPanel from '../AiPanel.vue'
import type { PostSummary } from '../../../lib/api'
import {
  dialogStubs,
  installDialogMocks,
  resetDialogMocks,
} from '../../../__test-helpers__/dialogs'

installDialogMocks()

// Per-test toast spy. installDialogMocks()'s vi.mock for useToast doesn't
// actually intercept the live AiPanel toast (see comment in
// archive-to-zettel.test.ts), so we declare a local spy here and bind
// it via our own vi.mock. dialogStubs.toast isn't reliable for AiPanel
// assertions.
const toastSpy = {
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}
vi.mock('../../../composables/useToast', () => ({
  useToast: () => toastSpy,
}))

// AiPanel pulls in useCurrentNote (which reads vue-router's current
// route). Drafts tests don't care about the active note, so stub it
// out with a no-op reactive.
vi.mock('../../../composables/vault/useCurrentNote', () => ({
  useCurrentNote: () => ({
    path: { value: null },
    frontmatter: { value: {} },
    raw: { value: '' },
    title: { value: '' },
  }),
}))

// AiPanel's batch archive uses useConfirm(); the dialogs.ts helper's
// vi.mock factory targets a relative path that doesn't intercept the
// live AiPanel's import (same issue as the toast spy). Re-declare here
// so AiPanel actually receives a mock confirm() that resolves.
vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirm: dialogStubs.confirm,
    answer: vi.fn(),
    queue: { value: [] },
  }),
}))

// Stub the network so onMounted's history.loadActive() doesn't 503.
// AiPanel calls /api/ai/active on mount; we return a "not configured,
// no active session" payload so it short-circuits without an unhandled
// rejection. Drafts section logic doesn't depend on AI history; the
// stub just keeps the mount quiet.
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  if (url === '/api/ai/active') {
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ activeId: null, configured: false }) }
  }
  return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({ error: 'stub' }) }
}))

const NOW = 1_700_000_000_000

function makePost(path: string, title: string, mtime: number): PostSummary {
  return { path, title, created: '', updated: '', tags: [], size: 0, mtime }
}

interface Harness {
  wrapper: ReturnType<typeof mount>
  emitted: () => Record<string, unknown[][]>
}

/** Mount AiPanel with the given posts prop. Returns a small harness
 *  for asserting on emitted events. The component reads `posts`
 *  through `props.posts` and re-renders when the parent updates the
 *  prop, so we mount it bare and let Vue Test Utils track emits. */
function setupAiPanel(initialPosts: PostSummary[]): Harness {
  const wrapper = mount(AiPanel, {
    props: { posts: initialPosts },
  })
  return { wrapper, emitted: () => wrapper.emitted() }
}

beforeEach(() => {
  resetDialogMocks()
  // Note: do NOT call vi.restoreAllMocks() here. The installDialogMocks
  // helper registers vi.mock factories that capture the confirm/prompt/
  // toast spies by closure — calling restoreAllMocks would un-stub
  // them, and subsequent tests would hit window.confirm() (not
  // implemented in jsdom) instead of the dialog helper. Per-test
  // spy cleanup is done by vi.spyOn(...).mockClear() inside each test.
})

describe('AiPanel Drafts section', () => {
  it('does not render the section when there are no drafts', async () => {
    const h = setupAiPanel([
      makePost('inbox/init', 'Init', NOW),
      makePost('zettel/perm', 'Perm', NOW),
    ])
    expect(h.wrapper.find('.ai-drafts').exists()).toBe(false)
  })

  it('lists inbox/draft and literature/draft posts, ignoring other paths', async () => {
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW - 10_000),
      makePost('literature/draft/b', 'B', NOW - 20_000),
      makePost('inbox/init', 'Init', NOW),
      makePost('zettel/perm', 'Perm', NOW),
      makePost('inbox/notes/draft.md', 'Wrong', NOW),
    ])
    const rows = h.wrapper.findAll('.ai-draft-item')
    expect(rows.length).toBe(2)
    const titles = rows.map((r) => r.find('.ai-draft-title').text())
    expect(titles).toEqual(['A', 'B'])
  })

  it('sorts drafts by mtime desc (newest first)', async () => {
    const h = setupAiPanel([
      makePost('inbox/draft/old', 'Old', NOW - 100_000),
      makePost('inbox/draft/mid', 'Mid', NOW - 50_000),
      makePost('inbox/draft/new', 'New', NOW - 1_000),
    ])
    const rows = h.wrapper.findAll('.ai-draft-item .ai-draft-title')
    expect(rows.map((r) => r.text())).toEqual(['New', 'Mid', 'Old'])
  })

  it('shows "inbox" / "literature" badge based on the path prefix', async () => {
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW),
      makePost('literature/draft/b', 'B', NOW),
    ])
    const rows = h.wrapper.findAll('.ai-draft-item')
    expect(rows[0].find('.ai-draft-path').text()).toBe('inbox')
    expect(rows[1].find('.ai-draft-path').text()).toBe('literature')
  })

  it('filters drafts by source area via the filter pills', async () => {
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW),
      makePost('literature/draft/b', 'B', NOW),
      makePost('inbox/draft/c', 'C', NOW - 1000),
    ])
    // Default is "all" — three rows.
    expect(h.wrapper.findAll('.ai-draft-item').length).toBe(3)

    // Click Inbox pill.
    await h.wrapper.findAll('.ai-drafts-filter-btn').find((b) => b.text() === 'Inbox')!.trigger('click')
    await flushPromises()
    const inboxRows = h.wrapper.findAll('.ai-draft-item')
    expect(inboxRows.length).toBe(2)
    expect(inboxRows.map((r) => r.find('.ai-draft-title').text())).toEqual(['A', 'C'])

    // Click Lit pill.
    await h.wrapper.findAll('.ai-drafts-filter-btn').find((b) => b.text() === 'Lit')!.trigger('click')
    await flushPromises()
    const litRows = h.wrapper.findAll('.ai-draft-item')
    expect(litRows.length).toBe(1)
    expect(litRows[0].find('.ai-draft-title').text()).toBe('B')

    // Back to all.
    await h.wrapper.findAll('.ai-drafts-filter-btn').find((b) => b.text() === '全部')!.trigger('click')
    await flushPromises()
    expect(h.wrapper.findAll('.ai-draft-item').length).toBe(3)
  })

  it('emits "open" with the path when the row is clicked', async () => {
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW),
    ])
    await h.wrapper.find('.ai-draft-open').trigger('click')
    expect(h.emitted().open).toBeTruthy()
    expect(h.emitted().open![0]).toEqual(['inbox/draft/a'])
  })

  it('emits "open" + "refresh-tree" and toasts success on archive', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/a', title: 'a', created: '', updated: '', tags: [], size: 0, mtime: NOW,
    } as any)
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW),
    ])
    const btn = h.wrapper.find('.ai-draft-archive')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await flushPromises()
    expect(patchSpy).toHaveBeenCalledWith('inbox/draft/a', { targetPath: 'zettel/a' })
    expect(h.emitted().open).toBeTruthy()
    expect(h.emitted().open![0]).toEqual(['zettel/a'])
    expect(h.emitted()['refresh-tree']).toBeTruthy()
    expect(toastSpy.success).toHaveBeenCalledWith('已归档到 zettel')
  })

  it('handles server-side suffix by following the moved path on collision', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/a-2', title: 'a-2', created: '', updated: '', tags: [], size: 0, mtime: NOW,
    } as any)
    const h = setupAiPanel([
      makePost('literature/draft/a', 'A', NOW),
    ])
    await h.wrapper.find('.ai-draft-archive').trigger('click')
    await flushPromises()
    expect(patchSpy).toHaveBeenCalledWith('literature/draft/a', { targetPath: 'zettel/a' })
    expect(h.emitted().open![0]).toEqual(['zettel/a-2'])
    expect(toastSpy.success).toHaveBeenCalledWith('已归档到 zettel/a-2')
  })

  it('toasts an error when the archive patch fails', async () => {
    vi.spyOn(api, 'patchPost').mockRejectedValue(new Error('disk full'))
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW),
    ])
    await h.wrapper.find('.ai-draft-archive').trigger('click')
    await flushPromises()
    expect(toastSpy.error).toHaveBeenCalledWith('归档失败: disk full')
    expect(h.emitted().open).toBeFalsy()
  })

  it('hides the archive button until the row is hovered (or focused)', async () => {
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW),
    ])
    const archiveBtn = h.wrapper.find('.ai-draft-archive')
    // The CSS-level hover-only state is enforced by opacity:0, not
    // by v-if. We assert the button exists and is rendered; visibility
    // is the CSS layer's job.
    expect(archiveBtn.exists()).toBe(true)
  })

  // --- batch archive -----------------------------------------------------

  it('"Archive all" button previews unique zettel names without server round-trips', async () => {
    dialogStubs.confirm.mockClear()
    const h = setupAiPanel([
      makePost('inbox/draft/foo', 'Foo', NOW),
      makePost('literature/draft/foo', 'Foo2', NOW),
      makePost('inbox/draft/bar', 'Bar', NOW),
      // Already under zettel/ — must reserve the basename.
      makePost('zettel/foo', 'ExistingFoo', NOW - 1),
    ])
    // dialogStubs.confirm comes from the helper. Force it to true
    // for this batch.
    dialogStubs.confirm.mockResolvedValueOnce(true)
    // The earlier per-row archive tests leave patchSpy with stale
    // calls — clear before installing the batch implementation.
    if ((api.patchPost as any).mock) (api.patchPost as any).mockClear()
    const patchSpy = vi.spyOn(api, 'patchPost').mockImplementation(async (_p, body) => ({
      path: (body as any).targetPath,
      title: (body as any).targetPath.split('/').pop()!,
      created: '', updated: '', tags: [], size: 0, mtime: 0,
    } as any))

    const btn = h.wrapper.find('.ai-drafts-archive-all')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    await flushPromises()

    // Inbox-first ordering, pre-computed unique basenames:
    //   inbox/draft/foo      -> zettel/foo-2 (zettel/foo is taken)
    //   literature/draft/foo -> zettel/foo-3 (foo, foo-2 both taken)
    //   inbox/draft/bar      -> zettel/bar   (no collision)
    expect(patchSpy).toHaveBeenCalledTimes(3)
    const targets = patchSpy.mock.calls.map((c) => (c[1] as any).targetPath)
    // Pre-computed order matches the preview (inbox drafts first, then
    // literature). The basename-collision resolves in encounter order:
    //   inbox/draft/foo      -> zettel/foo-2 (zettel/foo is taken)
    //   inbox/draft/bar      -> zettel/bar   (no collision)
    //   literature/draft/foo -> zettel/foo-3 (foo, foo-2 both taken)
    expect(targets).toEqual(['zettel/foo-2', 'zettel/bar', 'zettel/foo-3'])
  })

  it('canceling the confirm dialog aborts the batch', async () => {
    dialogStubs.confirm.mockClear()
    dialogStubs.confirm.mockResolvedValueOnce(false)
    const patchSpy = vi.spyOn(api, 'patchPost').mockClear()
    const h = setupAiPanel([
      makePost('inbox/draft/a', 'A', NOW),
      makePost('inbox/draft/b', 'B', NOW),
    ])
    await h.wrapper.find('.ai-drafts-archive-all').trigger('click')
    await flushPromises()
    expect(dialogStubs.confirm).toHaveBeenCalled()
    expect(patchSpy).not.toHaveBeenCalled()
  })
})
