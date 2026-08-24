import { expect, test } from './fixtures/auth'

test('Diary scope shows Calendar-first surface without opening or creating a Diary', async ({ page }) => {
  await page.goto('/vault')
  await expect(page.locator('.file-tree')).toBeVisible()
  await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()

  const surface = page.getByTestId('diary-calendar-surface')
  const calendar = page.getByTestId('diary-calendar')
  await expect(surface).toBeVisible()
  await expect(calendar).toBeVisible()
  await expect(page.getByTestId('diary-calendar-surface-empty')).toBeVisible()

  const diaryDateRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/diary/dates') diaryDateRequests.push(request.method())
  })
  const routeBefore = new URL(page.url()).pathname
  const tabsBefore = await page.locator('.tabs').count()
  await page.getByTestId('diary-calendar-today').click()
  await expect.poll(() => diaryDateRequests).toEqual([])
  expect(new URL(page.url()).pathname).toBe(routeBefore)
  expect(await page.locator('.tabs').count()).toBe(tabsBefore)
  await expect(surface).toBeVisible()

  const monthBefore = await calendar.getAttribute('data-month')
  await page.getByTestId('diary-calendar-next').click()
  await expect(calendar).not.toHaveAttribute('data-month', monthBefore ?? '')
  await page.getByTestId('diary-calendar-previous').click()
  await expect(calendar).toHaveAttribute('data-month', monthBefore ?? '')

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(surface).toBeVisible()
  await expect(page.locator('.file-tree')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true)
})
