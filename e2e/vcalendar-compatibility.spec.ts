import { test, expect } from '@playwright/test'

test('VCalendar browser compatibility across desktop and narrow viewports', async ({ browser, page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []

  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.setViewportSize({ width: 1280, height: 800 })
  // The probe is a static Vite entry under e2e/vcalendar-compatibility;
  // the application root is no longer the compatibility fixture.
  await page.goto('/e2e/vcalendar-compatibility/')

  await expect(page.locator('.vc-monthly')).toBeVisible()
  await expect(page.locator('.vc-title').filter({ hasText: 'August 2026' })).toHaveCount(1)
  await expect(page.locator('.vc-dot')).toHaveCount(1)
  await expect(page.locator('[data-testid="custom-marker"]')).toHaveText('mood-probe')

  const weekdaysBeforeToggle = await page.locator('.vc-weekday').allTextContents()
  expect(weekdaysBeforeToggle).toHaveLength(7)

  await page.getByTestId('next-page').click()
  await expect(page.locator('.vc-title').filter({ hasText: 'September 2026' })).toHaveCount(1)
  await page.getByTestId('prev-page').click()
  await expect(page.locator('.vc-title').filter({ hasText: 'August 2026' })).toHaveCount(1)

  await page.getByTestId('toggle-indicator').click()
  await expect(page.locator('.vc-dot')).toHaveCount(0)
  await page.getByTestId('toggle-indicator').click()
  await expect(page.locator('.vc-dot')).toHaveCount(1)

  await page.locator('[data-date="2026-08-24"]').click()
  await expect(page.getByTestId('selected-date')).toHaveText('2026-08-24')
  await expect(page.getByTestId('clicked-custom-data')).toHaveText('2026-08-24')

  await page.getByTestId('toggle-week-start').click()
  const weekdaysAfterToggle = await page.locator('.vc-weekday').allTextContents()
  expect(weekdaysAfterToggle).toHaveLength(7)
  expect(weekdaysAfterToggle).not.toEqual(weekdaysBeforeToggle)

  await page.getByTestId('toggle-locale').click()
  await expect(page.getByTestId('vcalendar-probe')).toHaveAttribute('data-locale', 'zh-CN')
  await expect(page.locator('.vc-title').filter({ hasText: '八月 2026' })).toHaveCount(1)

  await page.getByTestId('toggle-theme').click()
  await expect(page.getByTestId('vcalendar-probe')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.vc-container.vc-dark')).toBeVisible()

  await page.getByTestId('toggle-calendar').click()
  await expect(page.locator('.vc-container')).toHaveCount(0)
  await page.getByTestId('toggle-calendar').click()
  await expect(page.locator('.vc-monthly')).toBeVisible()

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.locator('.vc-monthly')).toBeVisible()
  await expect(page.locator('.vc-container')).toBeVisible()
  await expect(page.locator('[data-testid="custom-marker"]')).toHaveText('mood-probe')
  await page.locator('[data-date="2026-08-24"]').click()
  await expect(page.getByTestId('selected-date')).toHaveText('2026-08-24')

  for (const timezoneId of ['Pacific/Kiritimati', 'Etc/GMT+12', 'America/New_York']) {
    const boundaryContext = await browser.newContext({ timezoneId, viewport: { width: 800, height: 600 } })
    const boundaryPage = await boundaryContext.newPage()
    await boundaryPage.goto('/e2e/vcalendar-compatibility/')
    await boundaryPage.locator('[data-date="2026-08-24"]').click()
    await expect(boundaryPage.getByTestId('selected-date')).toHaveText('2026-08-24')
    await boundaryContext.close()
  }

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
