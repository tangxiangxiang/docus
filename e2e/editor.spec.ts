import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/__editor-test')
  await page.evaluate(() => {
    localStorage.removeItem('docus.e2e.editor-content')
    localStorage.removeItem('docus.monaco.view-state')
  })
  await page.reload()
  await expect(page.locator('.monaco-editor')).toBeVisible()
})

test('starts at the top and synchronizes both scroll directions', async ({ page }) => {
  const editor = page.locator('.editor-pane .monaco-editor')
  const preview = page.locator('.preview-pane')
  await expect.poll(() => preview.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
  await expect(page.getByTestId('editor-scroll')).toHaveText('0')
  expect(await preview.evaluate((element) => element.scrollTop)).toBe(0)

  await editor.hover()
  await page.mouse.wheel(0, 1200)
  await expect.poll(async () => Number(await page.getByTestId('editor-scroll').textContent())).toBeGreaterThan(0)
  const editorFraction = Number(await page.getByTestId('editor-scroll').textContent())
  await expect.poll(() => preview.evaluate((element) => element.scrollTop / (element.scrollHeight - element.clientHeight))).toBeCloseTo(editorFraction, 1)

  await page.waitForTimeout(50)
  await preview.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.25
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await expect.poll(() => page.getByTestId('editor-scroll').textContent().then(Number)).toBeCloseTo(0.25, 1)
})

test('uses the shared vault scrollbar tokens', async ({ page }) => {
  const host = page.locator('.monaco-host')
  const slider = host.locator('.editor-scrollable .scrollbar.vertical > .slider').first()
  await expect(slider).toBeVisible()
  const normal = await slider.evaluate((element) => getComputedStyle(element).backgroundColor)
  const expectedNormal = await page.locator('html').evaluate((element) =>
    getComputedStyle(element).getPropertyValue('--sb-thumb').trim(),
  )
  expect(normal).toBe(expectedNormal)
  expect(await slider.evaluate((element) => getComputedStyle(element).width)).toBe('6px')
  await expect(host.locator('.decorationsOverviewRuler')).toBeHidden()

  await host.hover()
  await page.waitForTimeout(180)
  const hovered = await slider.evaluate((element) => getComputedStyle(element).backgroundColor)
  const expectedHover = await page.locator('html').evaluate((element) =>
    getComputedStyle(element).getPropertyValue('--sb-thumb-hover').trim(),
  )
  expect(hovered).toBe(expectedHover)
})

test('writes Chinese, persists it, and restores it after reload', async ({ page }) => {
  const editor = page.locator('.monaco-editor')
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
  await page.keyboard.type('\n中文输入（完整标点）。')
  await expect(page.getByTestId('save-state')).toHaveText('saved')
  await page.reload()
  await expect(page.locator('.view-lines')).toContainText('中文输入（完整标点）。')
})

test('opens a Wiki Link with the platform modifier and follows theme changes', async ({ page }) => {
  const link = page.locator('.monaco-md-link').last()
  await link.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await expect(page.getByTestId('opened-link')).toHaveText('zettel/linked-note')

  const before = await page.locator('html').getAttribute('data-theme')
  await page.locator('.theme-toggle').click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '')
  await expect(page.locator('.monaco-editor')).toBeVisible()
})
