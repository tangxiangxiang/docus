import { expect, test } from './fixtures/auth'

test('canonical Ledger renders inside the shared Docus App Shell', async ({ page }) => {
  await page.goto('/ledger')

  await expect(page.getByTestId('ledger-page')).toBeVisible()
  await expect(page.locator('.navbar')).toHaveCount(1)
  await expect(page.locator('.scope-chips')).toBeVisible()
  await expect(page.locator('.scope-chip').filter({ hasText: 'ledger' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('body')).toHaveClass(/ledger-mode/)
  await expect(page.locator('html')).toHaveClass(/ledger-mode/)
  await expect(page.locator('body')).not.toHaveClass(/bills-mode/)
  await expect(page.locator('html')).not.toHaveClass(/bills-mode/)

  // Ledger is a body workspace, not a second Vault shell. The global actions
  // stay in the single navbar while Vault-only controls and sidebars do not.
  await expect(page.getByTestId('account-button')).toHaveCount(1)
  await expect(page.locator('.theme-toggle')).toHaveCount(1)
  await expect(page.getByTestId('view-toggle')).toHaveCount(0)
  await expect(page.locator('.right-rail-toggle')).toHaveCount(0)
  await expect(page.locator('.activity-bar')).toHaveCount(0)
  await expect(page.locator('.navbar + .navbar')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('billsMockData')
  await expect(page.locator('body')).not.toContainText('Bills')
})

test('legacy Bills URLs redirect to the canonical Ledger routes', async ({ page }) => {
  await page.goto('/bills/transactions?period=month#recent')
  await expect(page).toHaveURL(/\/ledger\/transactions\?period=month#recent$/)
  await expect(page.getByTestId('ledger-transactions-page')).toBeVisible()

  await page.goto('/bills?period=month#summary')
  await expect(page).toHaveURL(/\/ledger\?period=month#summary$/)
  await expect(page.getByTestId('ledger-page')).toBeVisible()
})

test('Ledger scope switches back to the shared Vault body', async ({ page }) => {
  await page.goto('/ledger')
  await page.locator('.scope-chip').filter({ hasText: 'note' }).click()

  await expect(page).toHaveURL(/\/vault(?:[/?#]|$)/)
  await expect(page.locator('body')).not.toHaveClass(/ledger-mode/)
  await expect(page.locator('html')).not.toHaveClass(/ledger-mode/)
  await expect(page.locator('.navbar')).toHaveCount(1)
  await expect(page.locator('.scope-chip').filter({ hasText: 'note' })).toHaveAttribute('aria-pressed', 'true')
})

test('Ledger keeps the shared theme readable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('docus.theme', 'dark')
  })
  await page.goto('/ledger')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('ledger-page')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('Bills')
})
