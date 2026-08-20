const SETTLED_MATH_STATES = new Set(['ready', 'error'])

/** Math errors are settled render outcomes, not export-blocking failures. */
export function mathWidgetsReady(article: HTMLElement): boolean {
  for (const placeholder of article.querySelectorAll<HTMLElement>('.math-mount')) {
    if (!SETTLED_MATH_STATES.has(placeholder.dataset.mathState ?? '')) return false
  }
  return true
}
