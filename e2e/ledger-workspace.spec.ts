import { expect, test } from './fixtures/auth'

test('Ledger renders inside the shared Docus App Shell', async ({ page }) => {
  await page.goto('/bills')

  await expect(page.locator('.navbar')).toHaveCount(1)
  await expect(page.locator('.scope-chips')).toBeVisible()
  await expect(page.locator('.scope-chip').filter({ hasText: 'ledger' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('bills-page')).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/bills-mode/)
  await expect(page.locator('html')).toHaveClass(/bills-mode/)
  const outerScrollbar = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).scrollbarWidth,
    body: getComputedStyle(document.body).scrollbarWidth,
  }))
  expect(outerScrollbar.html).toBe('none')
  expect(outerScrollbar.body).toBe('none')

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
  await expect(page.locator('body')).not.toHaveClass(/bills-mode/)
  await expect(page.locator('html')).not.toHaveClass(/bills-mode/)
  await expect(page.locator('.navbar')).toHaveCount(1)
  await expect(page.locator('.scope-chip').filter({ hasText: 'note' })).toHaveAttribute('aria-pressed', 'true')
})

test('Ledger dark theme keeps dashboard surfaces and asset totals readable', async ({ page }) => {
  await page.goto('/bills')
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))

  const colors = await page.evaluate(() => {
    const pageElement = document.querySelector('.bills-page') as HTMLElement | null
    const cardElement = document.querySelector('[data-testid="bills-asset-overview"]') as HTMLElement | null
    const totalElement = document.querySelector('.bills-asset-total-primary') as HTMLElement | null
    const totalValue = totalElement?.querySelector('strong') as HTMLElement | null

    return {
      pageBackground: pageElement ? getComputedStyle(pageElement).backgroundColor : '',
      cardBackground: cardElement ? getComputedStyle(cardElement).backgroundColor : '',
      totalBackground: totalElement ? getComputedStyle(totalElement).backgroundColor : '',
      totalText: totalValue ? getComputedStyle(totalValue).color : '',
    }
  })

  expect(colors.pageBackground).toBe('rgb(30, 30, 30)')
  expect(colors.cardBackground).toBe('rgb(37, 37, 38)')
  expect(colors.totalBackground).toBe('rgb(45, 45, 45)')
  expect(colors.totalText).toBe('rgb(212, 212, 212)')
})
