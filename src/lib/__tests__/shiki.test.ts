// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHighlighter, type Highlighter } from 'shiki'
import {
  __testing__,
  ensureShikiLanguage,
  extractFenceLanguageIdentifier,
  getGeneratedShikiCss,
  getShikiRuntime,
  getShikiStyleTransformer,
  prepareShikiLanguages,
  resolveShikiLanguage,
} from '../shiki'

const fakeHighlighter = (): Highlighter => ({
  dispose: vi.fn(),
} as unknown as Highlighter)

type LanguageInput = Parameters<Highlighter['loadLanguage']>[0]

function fakeLanguageHighlighter(
  loadLanguage: (language: LanguageInput) => Promise<void>,
  loadedLanguages: string[] = [],
): Highlighter {
  return {
    dispose: vi.fn(),
    getLoadedLanguages: vi.fn(() => [...loadedLanguages]),
    loadLanguage: vi.fn(loadLanguage),
  } as unknown as Highlighter
}

function useFakeLanguageRuntime(runtime: Highlighter) {
  const factory = vi.fn<typeof createHighlighter>(() => Promise.resolve(runtime))
  __testing__.setHighlighterFactory(factory)
  return factory
}

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

describe('Shiki H2 language preparation', () => {
  it('extracts only the first info token and resolves official aliases', () => {
    expect(extractFenceLanguageIdentifier('  js title=demo  ')).toBe('js')
    expect(extractFenceLanguageIdentifier('python linenums')).toBe('python')
    expect(extractFenceLanguageIdentifier('   ')).toBe('')

    const javascript = resolveShikiLanguage('js')
    const javascriptLong = resolveShikiLanguage('JavaScript')
    const python = resolveShikiLanguage('py')
    const yaml = resolveShikiLanguage('YML')

    expect(javascript).toMatchObject({ kind: 'language', normalizedId: 'js', canonicalId: 'javascript' })
    expect(javascriptLong).toMatchObject({ kind: 'language', normalizedId: 'javascript', canonicalId: 'javascript' })
    expect(python).toMatchObject({ kind: 'language', normalizedId: 'py', canonicalId: 'python' })
    expect(yaml).toMatchObject({ kind: 'language', normalizedId: 'yml', canonicalId: 'yaml' })
  })

  it('keeps the full official registry available beyond the short acceptance list', () => {
    const identifiers = [
      'tsx',
      'jsx',
      'vue',
      'html',
      'css',
      'scss',
      'json',
      'java',
      'sql',
      'powershell',
      'c',
      'cpp',
      'csharp',
      'go',
      'rust',
      'php',
      'kotlin',
      'docker',
      'dockerfile',
      'xml',
      'diff',
    ]

    expect(identifiers.every((identifier) => resolveShikiLanguage(identifier).kind === 'language')).toBe(true)
  })

  it('checks exact Docus special fences before case-normalized registry lookup', () => {
    expect(resolveShikiLanguage('markmap')).toMatchObject({ kind: 'special', specialFence: 'markmap' })
    expect(resolveShikiLanguage('mermaid')).toMatchObject({ kind: 'special', specialFence: 'mermaid' })
    expect(resolveShikiLanguage('MARKMAP')).toMatchObject({ kind: 'unsupported', normalizedId: 'markmap' })
    expect(resolveShikiLanguage('Mermaid')).toMatchObject({ kind: 'language', canonicalId: 'mermaid' })
    expect(resolveShikiLanguage('mmap').kind).toBe('unsupported')
    expect(resolveShikiLanguage('merm').kind).toBe('unsupported')
    expect(resolveShikiLanguage('mark-map').kind).toBe('unsupported')
    expect(resolveShikiLanguage('mer-maid').kind).toBe('unsupported')
  })

  it('skips empty, special, and unknown identifiers without creating Shiki', async () => {
    const runtime = fakeLanguageHighlighter(async () => {})
    const factory = useFakeLanguageRuntime(runtime)

    const results = await prepareShikiLanguages([
      '',
      '   ',
      'markmap',
      'mermaid',
      'definitely-not-a-language',
    ])

    expect(results.map((result) => [result.resolution.kind, result.status])).toEqual([
      ['empty', 'skipped'],
      ['special', 'skipped'],
      ['special', 'skipped'],
      ['unsupported', 'skipped'],
    ])
    expect(factory).not.toHaveBeenCalled()
    expect((runtime.loadLanguage as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it('deduplicates repeated identifiers and official aliases by canonical language', async () => {
    const loadLanguage = vi.fn(async (_language: LanguageInput) => {})
    const runtime = fakeLanguageHighlighter(loadLanguage)
    const factory = useFakeLanguageRuntime(runtime)

    const results = await prepareShikiLanguages([
      'js',
      'javascript',
      'js title=demo',
      'py',
      'python',
      'yml',
      'yaml',
    ])

    expect(results).toHaveLength(3)
    expect(results.map((result) => result.resolution.kind === 'language'
      ? result.resolution.canonicalId
      : undefined)).toEqual([
      'javascript',
      'python',
      'yaml',
    ])
    expect(loadLanguage).toHaveBeenCalledTimes(3)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight load across same-language and alias concurrency', async () => {
    let resolveLoad: (() => void) | undefined
    const loadLanguage = vi.fn((_language: LanguageInput) => new Promise<void>((resolve) => {
      resolveLoad = resolve
    }))
    const runtime = fakeLanguageHighlighter(loadLanguage)
    const factory = useFakeLanguageRuntime(runtime)

    const preparation = Promise.all([
      ensureShikiLanguage('js'),
      ensureShikiLanguage('javascript'),
      ensureShikiLanguage('js'),
    ])
    for (let attempt = 0; attempt < 5 && loadLanguage.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve()
    }

    expect(loadLanguage).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(1)
    resolveLoad?.()
    expect((await preparation).map((result) => result.status)).toEqual(['loaded', 'loaded', 'loaded'])
  })

  it('loads different canonical languages concurrently', async () => {
    let activeLoads = 0
    let maxActiveLoads = 0
    const loadLanguage = vi.fn(async (_language: LanguageInput) => {
      activeLoads += 1
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads)
      await Promise.resolve()
      activeLoads -= 1
    })
    const runtime = fakeLanguageHighlighter(loadLanguage)
    useFakeLanguageRuntime(runtime)

    await prepareShikiLanguages(['js', 'java', 'python'])

    expect(loadLanguage).toHaveBeenCalledTimes(3)
    expect(maxActiveLoads).toBe(3)
  })

  it('seeds canonical loaded state from the runtime and retries transient failures', async () => {
    const alreadyLoaded = vi.fn(async (_language: LanguageInput) => {})
    useFakeLanguageRuntime(fakeLanguageHighlighter(alreadyLoaded, ['javascript', 'js']))

    await expect(ensureShikiLanguage('js')).resolves.toMatchObject({ status: 'already-loaded' })
    expect(alreadyLoaded).not.toHaveBeenCalled()

    __testing__.reset()
    const loadLanguage = vi.fn()
      .mockRejectedValueOnce(new Error('temporary grammar failure'))
      .mockResolvedValueOnce(undefined)
    const runtime = fakeLanguageHighlighter(loadLanguage)
    const factory = useFakeLanguageRuntime(runtime)

    await expect(ensureShikiLanguage('typescript')).resolves.toMatchObject({ status: 'unavailable' })
    await expect(ensureShikiLanguage('ts')).resolves.toMatchObject({ status: 'loaded' })
    expect(loadLanguage).toHaveBeenCalledTimes(2)
    expect(factory).toHaveBeenCalledTimes(1)
    await expect(getShikiRuntime()).resolves.toBe(runtime)
  })

  it('propagates runtime initialization failure and retries language preparation', async () => {
    const healthyLoadLanguage = vi.fn(async (_language: LanguageInput) => {})
    const healthyRuntime = fakeLanguageHighlighter(healthyLoadLanguage)
    const factory = vi.fn<typeof createHighlighter>()
      .mockRejectedValueOnce(new Error('runtime initialization failed'))
      .mockResolvedValueOnce(healthyRuntime)
    __testing__.setHighlighterFactory(factory)

    await expect(ensureShikiLanguage('js')).rejects.toThrow('runtime initialization failed')
    expect(factory).toHaveBeenCalledTimes(1)
    expect(healthyLoadLanguage).not.toHaveBeenCalled()

    await expect(ensureShikiLanguage('js')).resolves.toMatchObject({ status: 'loaded' })
    expect(factory).toHaveBeenCalledTimes(2)
    expect(healthyLoadLanguage).toHaveBeenCalledTimes(1)
  })

  it('keeps the real runtime lazy and prepares only the requested grammar', async () => {
    const runtime = await getShikiRuntime()
    expect(runtime.getLoadedLanguages()).toEqual([])

    await expect(ensureShikiLanguage('javascript')).resolves.toMatchObject({ status: 'loaded' })

    const loaded = runtime.getLoadedLanguages()
    expect(loaded).toContain('javascript')
    expect(loaded).not.toContain('java')
    expect(loaded.length).toBeLessThan(20)
  })

  it('does not let a reset during a pending load leak into the next runtime', async () => {
    let resolveLoad: (() => void) | undefined
    const firstLoad = vi.fn((_language: LanguageInput) => new Promise<void>((resolve) => {
      resolveLoad = resolve
    }))
    const firstRuntime = fakeLanguageHighlighter(firstLoad)
    useFakeLanguageRuntime(firstRuntime)

    const firstPreparation = ensureShikiLanguage('js')
    for (let attempt = 0; attempt < 5 && firstLoad.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve()
    }
    __testing__.reset()
    resolveLoad?.()
    await expect(firstPreparation).resolves.toMatchObject({ status: 'unavailable' })

    const secondLoad = vi.fn(async (_language: LanguageInput) => {})
    const secondRuntime = fakeLanguageHighlighter(secondLoad)
    useFakeLanguageRuntime(secondRuntime)
    await expect(ensureShikiLanguage('js')).resolves.toMatchObject({ status: 'loaded' })
    expect(secondLoad).toHaveBeenCalledTimes(1)
  })
})
