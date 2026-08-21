import { createHighlighter, type Highlighter } from 'shiki'
import { transformerStyleToClass } from '@shikijs/transformers'

const SHIKI_THEMES = ['github-light', 'github-dark'] as const
const SHIKI_CLASS_PREFIX = 'docus-shiki-'

type ShikiHighlighter = Highlighter
type ShikiHighlighterFactory = typeof createHighlighter
type ShikiHighlighterOptions = Parameters<ShikiHighlighterFactory>[0]

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

/**
 * Return the one long-lived Shiki runtime promise.
 *
 * H1 deliberately initializes themes only. Language loading and Markdown
 * integration belong to H2/H3 and must not be added here.
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
 * H1 exposes the instance but does not attach its CSS to the DOM.
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
 * H1-only test seam for exercising single-flight and retry semantics without
 * changing normal application behavior or exposing mutable runtime state.
 */
function resetForTesting(): void {
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
