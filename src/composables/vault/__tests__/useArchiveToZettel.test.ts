// @vitest-environment jsdom
// Tests for useArchiveToZettel.
//
// The composable owns the patch + toast + collision-suffix handling
// shared by FileTree's right-click "归档到 zettel" and AiPanel's
// Drafts archive button. Tests cover:
//   - happy path: returns the server's moved path
//   - collision: server returns zettel/foo-2, composable toasts the
//     suffixed path
//   - error: composable toasts the error message, returns null
//   - early-out: target equals source (e.g. zettel/foo when called
//     on zettel/foo), returns null without a round-trip

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import * as api from '../../../lib/api'
import { useArchiveToZettel } from '../useArchiveToZettel'

// Per-test toast spy. The shared __test-helpers__/dialogs vi.mock
// doesn't intercept the live useToast() reliably here (see comment in
// archive-to-zettel.test.ts), so we set up a local one.
const toastSpy = {
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}
vi.mock('../../useToast', () => ({
  useToast: () => toastSpy,
}))

beforeEach(() => {
  vi.restoreAllMocks()
  toastSpy.info.mockClear()
  toastSpy.success.mockClear()
  toastSpy.error.mockClear()
  toastSpy.dismiss.mockClear()
})

interface Harness {
  archive: (path: string) => Promise<string | null>
}

function setup(): Harness {
  let captured: Harness | null = null
  const Comp = defineComponent({
    setup() {
      const { archive } = useArchiveToZettel()
      captured = { archive }
      return () => h('div')
    },
  })
  mount(Comp)
  return captured!
}

describe('useArchiveToZettel', () => {
  it('patches the file to zettel/<filename>.md and returns the moved path', async () => {
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo', title: 'foo', created: '', updated: '', tags: [], size: 0, mtime: 0,
    } as any)
    const h = setup()
    const result = await h.archive('inbox/draft/foo')
    expect(patchSpy).toHaveBeenCalledWith('inbox/draft/foo', { targetPath: 'zettel/foo' })
    expect(result).toBe('zettel/foo')
    expect(toastSpy.success).toHaveBeenCalledWith('已归档到 zettel')
  })

  it('toasts the suffixed path when the server auto-collides', async () => {
    vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo-2', title: 'foo-2', created: '', updated: '', tags: [], size: 0, mtime: 0,
    } as any)
    const h = setup()
    const result = await h.archive('literature/draft/foo')
    expect(result).toBe('zettel/foo-2')
    expect(toastSpy.success).toHaveBeenCalledWith('已归档到 zettel/foo-2')
  })

  it('returns null and toasts the error when patchPost rejects', async () => {
    vi.spyOn(api, 'patchPost').mockRejectedValue(new Error('disk full'))
    const h = setup()
    const result = await h.archive('inbox/draft/foo')
    expect(result).toBeNull()
    expect(toastSpy.error).toHaveBeenCalledWith('归档失败: disk full')
  })

  it('returns null without a network call when target equals source', async () => {
    // Path already in zettel/. The composable should skip — re-issuing
    // the patch would 409 on the server.
    const patchSpy = vi.spyOn(api, 'patchPost')
    const h = setup()
    const result = await h.archive('zettel/foo')
    expect(result).toBeNull()
    expect(patchSpy).not.toHaveBeenCalled()
    expect(toastSpy.success).not.toHaveBeenCalled()
    expect(toastSpy.error).not.toHaveBeenCalled()
  })

  it('accepts an explicit targetPath so the caller can pre-compute unique names', async () => {
    // Batch archive pre-computes zettel/foo-2 to avoid the server-side
    // -2 suffix scattering (-2, -3, -4, -5). The caller passes the
    // pre-computed target; the composable just sends it through.
    const patchSpy = vi.spyOn(api, 'patchPost').mockResolvedValue({
      path: 'zettel/foo-2', title: 'foo-2', created: '', updated: '', tags: [], size: 0, mtime: 0,
    } as any)
    const h = setup()
    const result = await h.archive('inbox/draft/foo', 'zettel/foo-2')
    expect(patchSpy).toHaveBeenCalledWith('inbox/draft/foo', { targetPath: 'zettel/foo-2' })
    expect(result).toBe('zettel/foo-2')
  })
})