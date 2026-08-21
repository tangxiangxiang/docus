import {
  bundledLanguages,
  bundledLanguagesBase,
  bundledLanguagesInfo,
  createHighlighter,
  type Highlighter,
} from 'shiki'
import { transformerStyleToClass } from '@shikijs/transformers'

const SHIKI_THEMES = ['github-light', 'github-dark'] as const
const SHIKI_CLASS_PREFIX = 'docus-shiki-'

type ShikiHighlighter = Highlighter
type ShikiHighlighterFactory = typeof createHighlighter
type ShikiHighlighterOptions = Parameters<ShikiHighlighterFactory>[0]
type ShikiLanguageLoader = (typeof bundledLanguagesInfo)[number]['import']

const SHIKI_RUNTIME_OPTIONS: ShikiHighlighterOptions = {
  themes: [...SHIKI_THEMES],
  langs: [],
}

const styleTransformer = transformerStyleToClass({
  classPrefix: SHIKI_CLASS_PREFIX,
})

let highlighterFactory: ShikiHighlighterFactory = createHighlighter
let highlighterPromise: Promise<ShikiHighlighter> | null = null
let activeHighlighter: ShikiHighlighter | null = null

const canonicalLanguageByLookupId = new Map<string, string>()
for (const language of bundledLanguagesInfo) {
  const canonicalId = language.id.toLowerCase()
  canonicalLanguageByLookupId.set(canonicalId, canonicalId)
  for (const alias of language.aliases ?? []) {
    canonicalLanguageByLookupId.set(alias.toLowerCase(), canonicalId)
  }
}

const loadedLanguageSet = new Set<string>()
const inFlightLanguageLoads = new Map<string, Promise<PreparedShikiLanguage>>()
const unsupportedLanguageSet = new Set<string>()
let languageStateGeneration = 0

export type ShikiLanguageResolution =
  | {
      kind: 'empty'
      identifier: string
    }
  | {
      kind: 'special'
      identifier: string
      specialFence: 'markmap' | 'mermaid'
    }
  | {
      kind: 'unsupported'
      identifier: string
      normalizedId: string
    }
  | {
      kind: 'language'
      identifier: string
      normalizedId: string
      canonicalId: string
      loader: ShikiLanguageLoader
    }

export interface PreparedShikiLanguage {
  resolution: ShikiLanguageResolution
  status: 'skipped' | 'loaded' | 'already-loaded' | 'unavailable'
  error?: unknown
}

/**
 * Extract only the first whitespace-delimited fence info token.
 * MarkdownIt owns fence recognition; this helper only interprets token.info.
 */
export function extractFenceLanguageIdentifier(info: string): string {
  const trimmed = info.trim()
  return trimmed ? (trimmed.split(/\s+/u, 1)[0] ?? '') : ''
}

/**
 * Resolve a user-facing fence identifier through Shiki's official bundled
 * language metadata. Docus special-fence semantics are checked before the
 * registry lookup and intentionally remain case-sensitive.
 */
export function resolveShikiLanguage(identifier: string): ShikiLanguageResolution {
  const rawIdentifier = extractFenceLanguageIdentifier(identifier)
  if (!rawIdentifier) {
    return { kind: 'empty', identifier: '' }
  }

  if (rawIdentifier === 'markmap' || rawIdentifier === 'mermaid') {
    return {
      kind: 'special',
      identifier: rawIdentifier,
      specialFence: rawIdentifier,
    }
  }

  const normalizedId = rawIdentifier.toLowerCase()
  if (unsupportedLanguageSet.has(normalizedId)) {
    return {
      kind: 'unsupported',
      identifier: rawIdentifier,
      normalizedId,
    }
  }

  const canonicalId = canonicalLanguageByLookupId.get(normalizedId)
  const registryLoader = bundledLanguages[normalizedId as keyof typeof bundledLanguages]
  const canonicalLoader = canonicalId
    ? bundledLanguagesBase[canonicalId as keyof typeof bundledLanguagesBase]
    : undefined

  if (!canonicalId || typeof registryLoader !== 'function' || typeof canonicalLoader !== 'function') {
    unsupportedLanguageSet.add(normalizedId)
    return {
      kind: 'unsupported',
      identifier: rawIdentifier,
      normalizedId,
    }
  }

  return {
    kind: 'language',
    identifier: rawIdentifier,
    normalizedId,
    canonicalId,
    loader: canonicalLoader,
  }
}

function syncLoadedLanguageState(runtime: ShikiHighlighter): void {
  for (const loadedLanguage of runtime.getLoadedLanguages()) {
    const canonicalId = canonicalLanguageByLookupId.get(loadedLanguage.toLowerCase())
    if (canonicalId) loadedLanguageSet.add(canonicalId)
  }
}

function skippedPreparation(resolution: ShikiLanguageResolution): PreparedShikiLanguage {
  return { resolution, status: 'skipped' }
}

async function ensureResolvedShikiLanguage(
  resolution: Extract<ShikiLanguageResolution, { kind: 'language' }>,
): Promise<PreparedShikiLanguage> {
  const { canonicalId, loader } = resolution

  if (loadedLanguageSet.has(canonicalId)) {
    return { resolution, status: 'already-loaded' }
  }

  const existingLoad = inFlightLanguageLoads.get(canonicalId)
  if (existingLoad) return existingLoad

  const generation = languageStateGeneration
  const loadPromise = (async (): Promise<PreparedShikiLanguage> => {
    // Runtime initialization is a system-level failure. Let getShikiRuntime()
    // reject so its existing singleton retry handler can clear the rejected
    // promise and the caller can observe the async render failure.
    const runtime = await getShikiRuntime()
    if (generation !== languageStateGeneration) {
      return { resolution, status: 'unavailable' }
    }

    // Shiki is the source of truth for languages loaded outside this
    // helper. The set is only a canonicalized fast path for later calls.
    syncLoadedLanguageState(runtime)
    if (loadedLanguageSet.has(canonicalId)) {
      return { resolution, status: 'already-loaded' }
    }

    try {
      await runtime.loadLanguage(loader)
    } catch (error) {
      // A known grammar can fail transiently. Do not poison the singleton or
      // put the identifier in the deterministic unsupported set; the next
      // render may retry this loader.
      return { resolution, status: 'unavailable', error }
    }

    if (generation !== languageStateGeneration) {
      return { resolution, status: 'unavailable' }
    }

    syncLoadedLanguageState(runtime)
    loadedLanguageSet.add(canonicalId)
    return { resolution, status: 'loaded' }
  })()

  inFlightLanguageLoads.set(canonicalId, loadPromise)
  void loadPromise.then(
    () => {
      if (inFlightLanguageLoads.get(canonicalId) === loadPromise) {
        inFlightLanguageLoads.delete(canonicalId)
      }
    },
    () => {
      if (inFlightLanguageLoads.get(canonicalId) === loadPromise) {
        inFlightLanguageLoads.delete(canonicalId)
      }
    },
  )
  return loadPromise
}

/**
 * Prepare the unique supported languages requested by one or more Markdown
 * fences. Unknown and Docus-special identifiers are intentionally skipped;
 * known loader failures are reported as unavailable but do not reject the
 * caller or poison the shared highlighter. Runtime initialization failures
 * intentionally reject the caller and remain retryable through the singleton.
 */
export async function prepareShikiLanguages(
  identifiers: readonly string[],
): Promise<PreparedShikiLanguage[]> {
  const uniqueResolutions: ShikiLanguageResolution[] = []
  const seen = new Set<string>()

  for (const identifier of identifiers) {
    const resolution = resolveShikiLanguage(identifier)
    const key = resolution.kind === 'language'
      ? `language:${resolution.canonicalId}`
      : `${resolution.kind}:${'normalizedId' in resolution ? resolution.normalizedId : resolution.identifier}`
    if (seen.has(key)) continue
    seen.add(key)
    uniqueResolutions.push(resolution)
  }

  return Promise.all(uniqueResolutions.map((resolution) => {
    if (resolution.kind !== 'language') {
      return Promise.resolve(skippedPreparation(resolution))
    }
    return ensureResolvedShikiLanguage(resolution)
  }))
}

export async function ensureShikiLanguage(identifier: string): Promise<PreparedShikiLanguage> {
  const [result] = await prepareShikiLanguages([identifier])
  return result ?? {
    resolution: { kind: 'empty', identifier: '' },
    status: 'skipped',
  }
}

/**
 * Render one already-prepared normal Markdown fence synchronously.
 *
 * MarkdownIt's highlight callback cannot await a Promise. H2 therefore owns
 * all runtime and grammar preparation before md.render(), while H3 uses only
 * this ready-runtime path inside the callback. A missing runtime or grammar
 * is a per-fence fallback condition; it must never initialize Shiki here.
 */
export function highlightShikiFence(source: string, identifier: string): string | null {
  const resolution = resolveShikiLanguage(identifier)
  if (resolution.kind !== 'language' || !activeHighlighter || !loadedLanguageSet.has(resolution.canonicalId)) {
    return null
  }

  try {
    return activeHighlighter.codeToHtml(source, {
      lang: resolution.canonicalId,
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
    })
  } catch {
    // A single fence rendering failure must not poison the shared runtime or
    // reject the whole Markdown document.
    return null
  }
}

/**
 * Return the one long-lived Shiki runtime promise.
 *
 * H1 established the themes and H2 now prepares only the canonical languages
 * requested by the current document. H3 consumes the ready runtime
 * synchronously from MarkdownIt's highlight callback.
 */
export function getShikiRuntime(): Promise<ShikiHighlighter> {
  if (highlighterPromise) {
    return highlighterPromise
  }

  let pending: Promise<ShikiHighlighter>
  try {
    pending = highlighterFactory({
      themes: [...SHIKI_RUNTIME_OPTIONS.themes],
      langs: [...SHIKI_RUNTIME_OPTIONS.langs],
    })
  } catch (error) {
    // A synchronous factory failure must not be cached either.
    return Promise.reject(error)
  }

  highlighterPromise = pending

  void pending.then(
    (highlighter) => {
      if (highlighterPromise === pending) {
        activeHighlighter = highlighter
      } else {
        // A test reset may have happened while initialization was pending.
        highlighter.dispose()
      }
    },
    () => {
      // Do not permanently cache a rejected initialization promise.
      if (highlighterPromise === pending) {
        highlighterPromise = null
        activeHighlighter = null
      }
    },
  )

  return pending
}

/**
 * Return the one class-based transformer used by later Shiki integration.
 * H1/H2 expose the instance but do not attach its CSS to the DOM.
 */
export function getShikiStyleTransformer() {
  return styleTransformer
}

/**
 * Return the transformer's current trusted CSS snapshot.
 * DOM stylesheet ownership is intentionally deferred to H4/H5.
 */
export function getGeneratedShikiCss(): string {
  return styleTransformer.getCSS()
}

/**
 * Narrow H1/H2 test seam for exercising single-flight, retry and reset
 * semantics without changing normal application behavior or exposing
 * mutable runtime state.
 */
function resetForTesting(): void {
  languageStateGeneration += 1
  loadedLanguageSet.clear()
  inFlightLanguageLoads.clear()
  unsupportedLanguageSet.clear()
  activeHighlighter?.dispose()
  activeHighlighter = null
  highlighterPromise = null
  highlighterFactory = createHighlighter
  styleTransformer.clearRegistry()
}

export const __testing__ = {
  reset: resetForTesting,

  setHighlighterFactory(factory: ShikiHighlighterFactory): void {
    resetForTesting()
    highlighterFactory = factory
  },
}
