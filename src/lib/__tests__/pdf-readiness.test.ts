// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mathWidgetsReady } from '../pdf-readiness'

function articleWithMath(markup: string): HTMLElement {
  const article = document.createElement('article')
  article.innerHTML = markup
  return article
}

describe('PDF math readiness', () => {
  it('blocks an explicitly pending placeholder', () => {
    const article = articleWithMath('<span class="math-mount" data-math-state="pending"></span>')

    expect(mathWidgetsReady(article)).toBe(false)
  })

  it('blocks a placeholder with no explicit state', () => {
    const article = articleWithMath('<span class="math-mount"></span>')

    expect(mathWidgetsReady(article)).toBe(false)
  })

  it('treats ready math as settled', () => {
    const article = articleWithMath(
      '<span class="math-mount" data-math-mounted="true" data-math-state="ready"></span>',
    )

    expect(mathWidgetsReady(article)).toBe(true)
  })

  it('treats error math as settled so export can continue', () => {
    const article = articleWithMath(
      '<span class="math-mount" data-math-mounted="true" data-math-state="error"></span>',
    )

    expect(mathWidgetsReady(article)).toBe(true)
  })

  it('allows articles without math placeholders', () => {
    expect(mathWidgetsReady(articleWithMath('<p>Plain text</p>'))).toBe(true)
  })
})
