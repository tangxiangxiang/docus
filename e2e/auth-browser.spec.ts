import { expect, test } from '@playwright/test'

const SETUP_TOKEN = 'docus-auth-browser-setup-token-0123456789'

test('real setup, logout, and login UI paths establish the session', async ({ page }) => {
  let setupBody: Record<string, unknown> | null = null
  let loginBody: Record<string, unknown> | null = null
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/setup')) setupBody = request.postDataJSON() as Record<string, unknown>
    if (request.url().endsWith('/api/auth/login')) loginBody = request.postDataJSON() as Record<string, unknown>
  })
  await page.goto('/vault')
  await expect(page).toHaveURL(/\/setup(?:\?|$)/)
  await expect(page.locator('.navbar')).toHaveCount(0)
  await expect(page.locator('#setup-token')).toBeFocused()
  await expect(page.locator('#setup-token-help')).toContainText('DOCUS_SETUP_TOKEN')
  await expect(page.getByRole('button', { name: /logout|sign out/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /logout|sign out/i })).toHaveCount(0)

  await page.locator('#setup-token').fill(SETUP_TOKEN)
  await page.locator('#setup-username').fill('browser-owner')
  await page.locator('#setup-password').fill('browser-owner-password-strong-123')
  await page.locator('#setup-confirm-password').fill('different-password')
  await page.locator('#setup-confirm-password').press('Enter')
  await expect(page.locator('#setup-confirm-error')).toBeVisible()
  await expect(page.locator('#setup-confirm-password')).toBeFocused()
  expect(setupBody).toBeNull()

  await page.locator('#setup-confirm-password').fill('browser-owner-password-strong-123')
  await page.locator('.auth-submit').click()
  expect(setupBody).toEqual({
    bootstrapToken: SETUP_TOKEN,
    username: 'browser-owner',
    password: 'browser-owner-password-strong-123',
  })

  await expect(page).toHaveURL(/\/vault(?:$|\?)/)
  await expect(page.locator('.vault')).toBeVisible({ timeout: 15_000 })
  const identityAfterSetup = await page.request.get('/api/vault/identity')
  expect(identityAfterSetup.status()).toBe(200)
  expect((await identityAfterSetup.json()).vaultId).toMatch(/^[0-9a-f]{12}$/)
  expect((await page.request.get('/api/tree')).status()).toBe(200)
  const health = await page.request.get('/api/health')
  expect(await health.json()).toEqual({ ok: true })

  const browserStorage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }))
  expect(JSON.stringify(browserStorage)).not.toContain(SETUP_TOKEN)
  expect(JSON.stringify(browserStorage)).not.toContain('browser-owner-password-strong-123')

  const logoutButton = page.locator('[data-testid="logout-button"]')
  await expect(logoutButton).toBeVisible()
  await logoutButton.click()
  await expect(page).toHaveURL(/\/login(?:\?|$)/)
  expect((await page.request.get('/api/vault/identity')).status()).toBe(401)
  await expect(page.locator('.navbar')).toHaveCount(0)
  await expect(page.locator('#login-username')).toBeFocused()
  await expect(page.getByRole('button', { name: /logout|sign out/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /logout|sign out/i })).toHaveCount(0)

  await page.locator('#login-username').fill('browser-owner')
  await page.locator('#login-password').fill('wrong-password')
  await page.locator('.auth-submit').click()
  await expect(page.locator('[role="alert"]')).toContainText(/Invalid username or password\.|用户名或密码错误。?/)
  await expect(page.locator('#login-username')).toBeFocused()

  await page.locator('#login-username').fill('browser-owner')
  await page.locator('#login-password').fill('browser-owner-password-strong-123')
  await page.locator('.auth-submit').click()
  expect(loginBody).toEqual({ username: 'browser-owner', password: 'browser-owner-password-strong-123' })
  await expect(page).toHaveURL(/\/vault(?:$|\?)/)
  await expect(page.locator('.vault')).toBeVisible({ timeout: 15_000 })
  expect((await page.request.get('/api/vault/identity')).status()).toBe(200)
  expect((await page.request.get('/api/tree')).status()).toBe(200)

  await page.reload()
  await expect(page).toHaveURL(/\/vault(?:$|\?)/)
  await expect(page.locator('.auth-page')).toHaveCount(0)
  await expect(page.locator('.vault')).toBeVisible({ timeout: 15_000 })

  await page.goto('/login?redirect=https%3A%2F%2Fevil.example')
  await expect(page).toHaveURL(/\/vault(?:$|\?)/)
  await expect(page).not.toHaveURL(/evil\.example/)
  await expect(page.locator('.auth-page')).toHaveCount(0)
  await page.goto('/setup?redirect=%2Fvault%2Finbox%2Fnote')
  await expect(page).toHaveURL(/\/vault\/inbox\/note(?:$|\?)/)
  await expect(page.locator('.auth-page')).toHaveCount(0)
})
