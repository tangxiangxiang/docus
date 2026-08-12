import { expect, test } from '@playwright/test'

const mode = 'reading'
for (const theme of ['light', 'dark'] as const) {
  test(`${mode} ${theme} Markdown visual regression`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('docus.theme', value), theme)
    await page.goto(`/__markdown-test?mode=${mode}`)
    const article = page.locator(`.article.${mode}`)
    await expect(article).toBeVisible()
    await expect(article).toContainText('Emoji: 😄 🚀 👍')
    await expect(article).toContainText('完成 🚀')
    await expect(article).toContainText('Unknown :not_an_emoji:')
    await expect(article.locator('code').filter({ hasText: ':smile:' }).first()).toBeVisible()
    await expect(article.locator('a').filter({ hasText: '😄' }).first()).toHaveAttribute('href', 'https://example.com')
    await expect(article.locator('table')).toBeVisible()
    await expect(article.locator('.wiki-link-missing')).toBeVisible()
    await expect(article.locator('.callout-note')).toBeVisible()
    await expect(article.locator('.callout-warning')).toBeVisible()
    await expect(article.locator('.callout-success')).toBeVisible()
    await expect(article.locator('.math-inline .katex')).toBeVisible()
    await expect(article.locator('.math-block .katex-display')).toBeVisible()
    await expect(article.locator('.mermaid-svg > svg')).toBeVisible()
    await expect(article.locator('svg.markmap-svg')).toBeVisible()
    const markmap = article.locator('.markmap-widget-host')
    await expect(markmap).toBeVisible()
    /* The page also contains ordinary Markdown math. Scope this assertion
       to the Markmap host so it proves browser KaTeX autoload → retransform
       → setData, rather than accidentally matching the article's math. */
    await expect(markmap.locator('.katex').first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page).toHaveScreenshot(`markdown-${mode}-${theme}.png`, {
      fullPage: true,
      animations: 'disabled',
      mask: [article.locator('.mermaid-widget-host'), article.locator('.markmap-widget-host')],
      maxDiffPixelRatio: 0.01,
    })
  })
}
