import { expect, test } from './fixtures/auth'

test('transaction category creation popover is visible above Settings', async ({ page, request }) => {
  const settingsResponse = await request.get('/api/ledger/settings')
  if (settingsResponse.status() === 404) {
    const initialize = await request.post('/api/ledger/settings', {
      data: { baseCurrency: 'CNY', timezone: 'Asia/Shanghai' },
      headers: { 'Idempotency-Key': `settings-categories-${Date.now()}` },
    })
    expect(initialize.status(), await initialize.text()).toBe(201)
  }

  await page.goto('/vault')
  await expect(page.locator('.vault')).toBeVisible({ timeout: 15_000 })
  await page.locator('.navbar [data-testid="account-button"]').click()
  await page.locator('[data-testid="account-settings"]').click()

  const settings = page.locator('.settings-modal')
  await expect(settings).toBeVisible()
  await settings.getByRole('button', { name: /交易分类|Transaction categories/i }).click()

  const addButton = settings.getByRole('button', { name: '＋ 添加分类' })
  await addButton.click()

  const form = page.locator('form[aria-label="添加交易分类"]')
  await expect(form).toBeVisible()
  const backdropZIndex = await page.locator('.settings-backdrop').evaluate((element) => (
    Number.parseInt(getComputedStyle(element).zIndex, 10)
  ))
  const follower = form.locator('xpath=ancestor::*[contains(@class, "v-binder-follower-container")]').first()
  await expect(follower).toHaveCSS('z-index', '10000')
  expect(await follower.boundingBox()).not.toBeNull()
  expect(backdropZIndex).toBe(9997)
})
