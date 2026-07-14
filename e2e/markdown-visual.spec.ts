import { expect, test } from '@playwright/test'

const mode = 'reading'
for (const theme of ['light', 'dark'] as const) {
  test(`${mode} ${theme} Markdown visual regression`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('docus.theme', value), theme)
    await page.goto(`/__markdown-test?mode=${mode}`)
    const article = page.locator(`.article.${mode}`)
    await expect(article).toBeVisible()
    await expect(article.locator('table')).toBeVisible()
    await expect(article.locator('.wiki-link-missing')).toBeVisible()
    await expect(article.locator('.mermaid-svg > svg')).toBeVisible()
    await expect(article.locator('svg.markmap-svg')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(page).toHaveScreenshot(`markdown-${mode}-${theme}.png`, {
      fullPage: true,
      animations: 'disabled',
      mask: [article.locator('.mermaid-widget-host'), article.locator('.markmap-widget-host')],
      maxDiffPixelRatio: 0.01,
    })
  })
}
