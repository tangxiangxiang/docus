import { expect, test } from '@playwright/test'

const mode = 'reading'
const alertTypes = ['note', 'tip', 'important', 'warning', 'caution'] as const
const alertColors = {
  light: {
    note: { foreground: 'rgb(9, 105, 218)', border: 'rgb(9, 105, 218)' },
    tip: { foreground: 'rgb(26, 127, 55)', border: 'rgb(26, 127, 55)' },
    important: { foreground: 'rgb(130, 80, 223)', border: 'rgb(130, 80, 223)' },
    warning: { foreground: 'rgb(154, 103, 0)', border: 'rgb(154, 103, 0)' },
    caution: { foreground: 'rgb(209, 36, 47)', border: 'rgb(207, 34, 46)' },
  },
  dark: {
    note: { foreground: 'rgb(68, 147, 248)', border: 'rgb(31, 111, 235)' },
    tip: { foreground: 'rgb(63, 185, 80)', border: 'rgb(35, 134, 54)' },
    important: { foreground: 'rgb(171, 125, 248)', border: 'rgb(137, 87, 229)' },
    warning: { foreground: 'rgb(210, 153, 34)', border: 'rgb(158, 106, 3)' },
    caution: { foreground: 'rgb(248, 81, 73)', border: 'rgb(218, 54, 51)' },
  },
} as const
const alertTitles = ['Note', 'Tip', 'Important', 'Warning', 'Caution']

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
      const icon = callout?.querySelector<HTMLElement>('.callout-icon')
      const iconStyle = icon ? getComputedStyle(icon, '::before') : null
      const calloutStyle = callout ? getComputedStyle(callout) : null
      return {
        type,
        title: title?.querySelector('.callout-title-text')?.textContent ?? '',
        foreground: title ? getComputedStyle(title).color : '',
        border: calloutStyle?.borderLeftColor ?? '',
        borderWidth: calloutStyle?.borderLeftWidth ?? '',
        borderStyle: calloutStyle?.borderLeftStyle ?? '',
        background: calloutStyle?.backgroundColor ?? '',
        radius: calloutStyle?.borderRadius ?? '',
        fontWeight: title ? getComputedStyle(title).fontWeight : '',
        fontSize: title ? getComputedStyle(title).fontSize : '',
        lineHeight: title ? getComputedStyle(title).lineHeight : '',
        iconWidth: icon ? getComputedStyle(icon).width : '',
        iconHeight: icon ? getComputedStyle(icon).height : '',
        mask: iconStyle
          ? (iconStyle.getPropertyValue('-webkit-mask-image') || iconStyle.getPropertyValue('mask-image'))
          : '',
      }
    }), alertTypes)

    expect(alerts).toHaveLength(5)
    alerts.forEach((alert, index) => {
      const colors = alertColors[theme][alert.type]
      expect(alert.title).toBe(alertTitles[index])
      expect(alert.foreground).toBe(colors.foreground)
      expect(alert.border).toBe(colors.border)
      expect(alert.borderWidth).toBe('4px')
      expect(alert.borderStyle).toBe('solid')
      expect(alert.background).toMatch(/transparent|rgba\(0, 0, 0, 0\)/)
      expect(alert.radius).toBe('0px')
      expect(alert.fontWeight).toBe('500')
      expect(alert.lineHeight).toBe(alert.fontSize)
      expect(alert.iconWidth).toBe('16px')
      expect(alert.iconHeight).toBe('16px')
      expect(alert.mask).toContain('data:image/svg+xml')
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
  await expect(noteTitle).toHaveCSS('color', 'rgb(9, 105, 218)')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  const forcedDarkPage = await page.context().newPage()
  try {
    await forcedDarkPage.emulateMedia({ colorScheme: 'light' })
    await forcedDarkPage.addInitScript(() => localStorage.setItem('docus.theme', 'dark'))
    await forcedDarkPage.goto('/__markdown-test?mode=reading')
    const darkNoteTitle = forcedDarkPage.locator('.article.reading .callout-note .callout-title')
    await expect(darkNoteTitle).toBeVisible()
    await expect(darkNoteTitle).toHaveCSS('color', 'rgb(68, 147, 248)')
    await expect(forcedDarkPage.locator('html')).toHaveAttribute('data-theme', 'dark')
  } finally {
    await forcedDarkPage.close()
  }
})
