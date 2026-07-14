import { expect, test } from '@playwright/test'

test.describe('View mode toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/vault')
  })

  test('app opens in edit mode by default', async ({ page }) => {
    await expect(page.locator('[data-testid="view-toggle"]')).toHaveAttribute('aria-label', 'Switch to read')
  })

  test('clicking the NavBar toggle button switches to read mode', async ({ page }) => {
    await page.locator('[data-testid="view-toggle"]').click()
    await expect(page.locator('[data-testid="view-toggle"]')).toHaveAttribute('aria-label', 'Switch to edit')
  })

  test('clicking again returns to edit mode', async ({ page }) => {
    const btn = page.locator('[data-testid="view-toggle"]')
    await btn.click()
    await btn.click()
    await expect(btn).toHaveAttribute('aria-label', 'Switch to read')
  })

  test('Cmd+E toggles edit↔read from the editor', async ({ page }) => {
    const btn = page.locator('[data-testid="view-toggle"]')
    await expect(btn).toHaveAttribute('aria-label', 'Switch to read')
    // Focus the vault container so that @keydown fires on it
    await page.locator('.vault').focus()
    await page.keyboard.press('Meta+e')
    await expect(btn).toHaveAttribute('aria-label', 'Switch to edit')
    await page.keyboard.press('Meta+e')
    await expect(btn).toHaveAttribute('aria-label', 'Switch to read')
  })

  test('viewMode persists across a hard refresh', async ({ page }) => {
    const btn = page.locator('[data-testid="view-toggle"]')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-label', 'Switch to edit')
    await page.reload()
    await expect(btn).toHaveAttribute('aria-label', 'Switch to edit')
  })
})
