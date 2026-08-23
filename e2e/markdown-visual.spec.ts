import { expect, test } from '@playwright/test'

const mode = 'reading'
const alertTypes = ['note', 'tip', 'important', 'warning', 'caution'] as const
const alertBackgrounds = {
  light: {
    note: 'rgb(241, 242, 244)',
    tip: 'rgb(238, 240, 255)',
    important: 'rgb(243, 237, 255)',
    warning: 'rgb(255, 247, 227)',
    caution: 'rgb(255, 233, 236)',
  },
  dark: {
    note: 'rgb(36, 38, 43)',
    tip: 'rgb(34, 38, 58)',
    important: 'rgb(41, 35, 56)',
    warning: 'rgb(48, 41, 29)',
    caution: 'rgb(53, 34, 38)',
  },
} as const
const alertTitles = ['注意', '提示', '重要', '警告', '小心']

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
    await expect(article.locator('.callout-tip')).toBeVisible()
    await expect(article.locator('.callout-important')).toBeVisible()
    await expect(article.locator('.callout-warning')).toBeVisible()
    await expect(article.locator('.callout-caution')).toBeVisible()

    const alerts = await article.evaluate((root, values) => values.map((type) => {
      const callout = root.querySelector<HTMLElement>(`.callout-${type}`)
      const title = callout?.querySelector<HTMLElement>('.callout-title')
      const calloutStyle = callout ? getComputedStyle(callout) : null
      return {
        type,
        title: title?.querySelector('.callout-title-text')?.textContent ?? '',
        foreground: title ? getComputedStyle(title).color : '',
        borderLeftWidth: calloutStyle?.borderLeftWidth ?? '',
        borderTopWidth: calloutStyle?.borderTopWidth ?? '',
        background: calloutStyle?.backgroundColor ?? '',
        radius: calloutStyle?.borderRadius ?? '',
        shadow: calloutStyle?.boxShadow ?? '',
        paddingTop: calloutStyle?.paddingTop ?? '',
        paddingLeft: calloutStyle?.paddingLeft ?? '',
        fontSize: title ? getComputedStyle(title).fontSize : '',
        fontWeight: title ? getComputedStyle(title).fontWeight : '',
        lineHeight: title ? getComputedStyle(title).lineHeight : '',
        hasIcon: callout?.querySelector('.callout-icon') !== null,
      }
    }), alertTypes)

    expect(alerts).toHaveLength(5)
    alerts.forEach((alert, index) => {
      const background = alertBackgrounds[theme][alert.type]
      expect(alert.title).toBe(alertTitles[index])
      expect(alert.foreground).toBe(theme === 'light' ? 'rgb(31, 31, 31)' : 'rgb(212, 212, 212)')
      expect(alert.background).toBe(background)
      expect(alert.borderLeftWidth).toBe('0px')
      expect(alert.borderTopWidth).toBe('0px')
      expect(alert.radius).toBe('12px')
      expect(alert.shadow).toBe('none')
      expect(alert.paddingTop).toBe('12px')
      expect(alert.paddingLeft).toBe('16px')
      expect(alert.fontSize).toBe('14px')
      expect(alert.fontWeight).toBe('700')
      expect(Number.parseFloat(alert.lineHeight)).toBeCloseTo(19.6, 1)
      expect(alert.hasIcon).toBe(false)
    })

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

test('reading forced Alert theme overrides the operating-system color scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.addInitScript(() => localStorage.setItem('docus.theme', 'light'))
  await page.goto('/__markdown-test?mode=reading')
  const noteTitle = page.locator('.article.reading .callout-note .callout-title')
  await expect(noteTitle).toBeVisible()
  await expect(noteTitle).toHaveCSS('color', 'rgb(31, 31, 31)')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  const forcedDarkPage = await page.context().newPage()
  try {
    await forcedDarkPage.emulateMedia({ colorScheme: 'light' })
    await forcedDarkPage.addInitScript(() => localStorage.setItem('docus.theme', 'dark'))
    await forcedDarkPage.goto('/__markdown-test?mode=reading')
    const darkNoteTitle = forcedDarkPage.locator('.article.reading .callout-note .callout-title')
    await expect(darkNoteTitle).toBeVisible()
    await expect(darkNoteTitle).toHaveCSS('color', 'rgb(212, 212, 212)')
    await expect(forcedDarkPage.locator('html')).toHaveAttribute('data-theme', 'dark')
  } finally {
    await forcedDarkPage.close()
  }
})
