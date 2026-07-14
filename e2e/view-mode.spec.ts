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

  test('Cmd+E toggles edit↔read from the vault', async ({ page }) => {
    const toggle = page.getByTestId('view-toggle')
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to read')
    // Focus the vault container so that @keydown fires on it
    await page.locator('.vault').focus()
    await page.keyboard.press('Meta+e')
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to edit')
    await page.keyboard.press('Meta+e')
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to read')
  })

  test('Cmd+E toggles mode while Monaco editor has focus', async ({ page }) => {
    const toggle = page.getByTestId('view-toggle')

    // Open a file so Monaco is mounted — click the first tree row.
    const treeRow = page.locator('.tree-row').first()
    const rowCount = await treeRow.count()
    if (rowCount === 0) {
      test.skip(true, 'No vault files to open — skipping Monaco-focus test')
    }
    await treeRow.click()
    // Wait for the async Monaco component to load
    const editor = page.locator('.monaco-editor')
    await editor.waitFor({ state: 'visible', timeout: 10_000 })
    await editor.click()

    await page.keyboard.press('Meta+e')
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to edit')

    // Verify Monaco's Find Widget did NOT open
    await expect(
      page.locator('.monaco-editor .find-widget.visible'),
    ).toHaveCount(0)

    await page.keyboard.press('Meta+e')
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to read')
  })

  test('Control+E toggles mode while Monaco editor has focus (non-macOS)', async ({ page }) => {
    const toggle = page.getByTestId('view-toggle')

    const treeRow = page.locator('.tree-row').first()
    if ((await treeRow.count()) === 0) {
      test.skip(true, 'No vault files to open — skipping Monaco-focus test')
    }
    await treeRow.click()
    const editor = page.locator('.monaco-editor')
    await editor.waitFor({ state: 'visible', timeout: 10_000 })
    await editor.click()

    await page.keyboard.press('Control+e')
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to edit')
  })

  test('Cmd+F still opens Find Widget normally', async ({ page }) => {
    const treeRow = page.locator('.tree-row').first()
    if ((await treeRow.count()) === 0) {
      test.skip(true, 'No vault files to open — skipping Monaco-focus test')
    }
    await treeRow.click()
    const editor = page.locator('.monaco-editor')
    await editor.waitFor({ state: 'visible', timeout: 10_000 })
    await editor.click()

    await page.keyboard.press('Meta+f')
    await expect(
      page.locator('.monaco-editor .find-widget.visible'),
    ).toHaveCount(1)
  })

  test('viewMode persists across a hard refresh', async ({ page }) => {
    const btn = page.locator('[data-testid="view-toggle"]')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-label', 'Switch to edit')
    await page.reload()
    await expect(btn).toHaveAttribute('aria-label', 'Switch to edit')
  })
})
