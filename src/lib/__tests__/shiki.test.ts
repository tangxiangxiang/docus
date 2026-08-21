// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHighlighter, type Highlighter } from 'shiki'
import {
  __testing__,
  getGeneratedShikiCss,
  getShikiRuntime,
  getShikiStyleTransformer,
} from '../shiki'

const fakeHighlighter = (): Highlighter => ({
  dispose: vi.fn(),
} as unknown as Highlighter)

beforeEach(() => {
  __testing__.reset()
})

describe('Shiki H1 runtime foundation', () => {
  it('shares one highlighter promise across concurrent callers', async () => {
    let resolveRuntime: ((runtime: Highlighter) => void) | undefined
    const pendingRuntime = new Promise<Highlighter>((resolve) => {
      resolveRuntime = resolve
    })
    const runtime = fakeHighlighter()
    const factory = vi.fn<typeof createHighlighter>(() => pendingRuntime)
    __testing__.setHighlighterFactory(factory)

    const calls = [getShikiRuntime(), getShikiRuntime(), getShikiRuntime()]

    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith({
      themes: ['github-light', 'github-dark'],
      langs: [],
    })

    resolveRuntime?.(runtime)
    const resolved = await Promise.all(calls)

    expect(resolved).toEqual([runtime, runtime, runtime])
    expect(await getShikiRuntime()).toBe(runtime)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('retries after initialization failure instead of caching a rejection', async () => {
    const runtime = fakeHighlighter()
    const factory = vi.fn<typeof createHighlighter>()
      .mockRejectedValueOnce(new Error('initialization failed'))
      .mockResolvedValueOnce(runtime)
    __testing__.setHighlighterFactory(factory)

    await expect(getShikiRuntime()).rejects.toThrow('initialization failed')
    await expect(getShikiRuntime()).resolves.toBe(runtime)

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('loads both themes without eagerly loading application languages', async () => {
    const runtime = await getShikiRuntime()

    expect(runtime.getLoadedThemes()).toEqual(['github-light', 'github-dark'])
    expect(runtime.getLoadedLanguages()).toEqual([])
  })

  it('returns one transformer instance with a class-based CSS snapshot', async () => {
    const transformer = getShikiStyleTransformer()

    expect(transformer).toBe(getShikiStyleTransformer())
    expect(getGeneratedShikiCss()).toBe('')

    // Compatibility probe only: H1 tests the Shiki/transformer pair with one
    // JavaScript grammar, but the production H1 runtime remains langs: [].
    const probeHighlighter = await createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: ['javascript'],
    })
    try {
      const html = probeHighlighter.codeToHtml('const answer = 42', {
        lang: 'javascript',
        themes: {
          light: 'github-light',
          dark: 'github-dark',
        },
        defaultColor: false,
        transformers: [transformer],
      })

      expect(html).toContain('docus-shiki-')
      expect(html).not.toContain(' style=')
      expect(getGeneratedShikiCss()).toContain('.docus-shiki-')
      expect(getGeneratedShikiCss()).toContain('--shiki-light:')
      expect(getGeneratedShikiCss()).toContain('--shiki-dark:')
    } finally {
      probeHighlighter.dispose()
    }
  })

  it('does not create a DOM stylesheet owner', async () => {
    const documentBefore = globalThis.document
    const styleCount = documentBefore?.querySelectorAll('style').length

    await getShikiRuntime()

    expect(globalThis.document).toBe(documentBefore)
    if (documentBefore) {
      expect(documentBefore.querySelector('#docus-shiki-generated-styles')).toBeNull()
      expect(documentBefore.querySelectorAll('style')).toHaveLength(styleCount)
    }
  })

  it('does not require document to initialize or read the CSS snapshot', async () => {
    vi.stubGlobal('document', undefined)
    try {
      const runtime = await getShikiRuntime()

      expect(runtime.getLoadedThemes()).toEqual(['github-light', 'github-dark'])
      expect(getGeneratedShikiCss()).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
