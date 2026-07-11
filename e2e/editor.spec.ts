import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/__editor-test')
  await page.evaluate(() => localStorage.removeItem('docus.e2e.editor-content'))
  await page.reload()
  await expect(page.locator('.monaco-editor')).toBeVisible()
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
