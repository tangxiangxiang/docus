import { expect, test } from './fixtures/auth'

test('Ledger renders inside the shared Docus App Shell', async ({ page }) => {
  await page.goto('/bills')

  await expect(page.locator('.navbar')).toHaveCount(1)
  await expect(page.locator('.scope-chips')).toBeVisible()
  await expect(page.locator('.scope-chip').filter({ hasText: 'ledger' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('bills-page')).toBeVisible()

  // Ledger is a body workspace, not a second Vault shell. The global actions
  // stay in the single navbar while Vault-only controls and sidebars do not.
  await expect(page.getByTestId('account-button')).toHaveCount(1)
  await expect(page.locator('.theme-toggle')).toHaveCount(1)
  await expect(page.getByTestId('view-toggle')).toHaveCount(0)
  await expect(page.locator('.right-rail-toggle')).toHaveCount(0)
  await expect(page.locator('.activity-bar')).toHaveCount(0)
  await expect(page.locator('.navbar + .navbar')).toHaveCount(0)
})

test('Ledger scope switches back to the shared Vault body', async ({ page }) => {
  await page.goto('/bills')
  await page.locator('.scope-chip').filter({ hasText: 'note' }).click()

  await expect(page).toHaveURL(/\/vault(?:[/?#]|$)/)
  await expect(page.locator('.navbar')).toHaveCount(1)
  await expect(page.locator('.scope-chip').filter({ hasText: 'note' })).toHaveAttribute('aria-pressed', 'true')
})
