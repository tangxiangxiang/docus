import { expect, test, type APIRequestContext, type Page } from './fixtures/auth'

const TEST_TIME_ZONE = 'Asia/Shanghai'

function localCivilDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TEST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('unable to resolve the E2E local civil date')
  return `${year}-${month}-${day}`
}

function nextCivilDate(value: string): string {
  const [yearText, monthText, dayText] = value.split('-')
  let year = Number(yearText)
  let month = Number(monthText)
  let day = Number(dayText) + 1
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
  const daysInMonth = month === 2
    ? (leap ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31
  if (day > daysInMonth) {
    day = 1
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function diaryPath(date: string): string {
  return `diary/${date}`
}

async function deleteDiaryDate(request: APIRequestContext, date: string): Promise<void> {
  const response = await request.delete(`/api/posts/${diaryPath(date)}`)
  expect([200, 404]).toContain(response.status())
}

async function seedExistingDiary(request: APIRequestContext, date: string, raw: string): Promise<void> {
  await deleteDiaryDate(request, date)
  const created = await request.post('/api/diary/dates', {
    data: { date, timeZone: TEST_TIME_ZONE },
  })
  expect(created.status(), await created.text()).toBe(201)
  const saved = await request.put(`/api/posts/${diaryPath(date)}`, {
    data: { raw, baseRaw: `# ${date}\n` },
  })
  expect(saved.status(), await saved.text()).toBe(200)
}

function browserDiagnostics(page: Page): {
  pageErrors: string[]
  consoleErrors: string[]
  notFoundResponses: Array<{ method: string; pathname: string; status: number }>
} {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const notFoundResponses: Array<{ method: string; pathname: string; status: number }> = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() !== 404) return
    const url = new URL(response.url())
    notFoundResponses.push({
      method: response.request().method(),
      pathname: url.pathname,
      status: response.status(),
    })
  })
  return { pageErrors, consoleErrors, notFoundResponses }
}

test('Diary scope shows the Calendar-first surface and month navigation', async ({ page }) => {
  await page.goto('/vault')
  await expect(page.locator('.file-tree')).toBeVisible()
  await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()

  const surface = page.getByTestId('diary-calendar-surface')
  const calendar = page.getByTestId('diary-calendar')
  await expect(surface).toBeVisible()
  await expect(calendar).toBeVisible()
  await expect(page.getByTestId('diary-calendar-surface-empty')).toBeVisible()

  const monthBefore = await calendar.getAttribute('data-month')
  await page.getByTestId('diary-calendar-next').click()
  await expect(calendar).not.toHaveAttribute('data-month', monthBefore ?? '')
  await page.getByTestId('diary-calendar-previous').click()
  await expect(calendar).toHaveAttribute('data-month', monthBefore ?? '')

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(surface).toBeVisible()
  // Phone-sized Diary Calendar-first mode gives the seven-column surface the
  // full primary width; the side panel is restored when leaving Diary or
  // opening a document.
  await expect(page.locator('.file-tree')).toBeHidden()
  await expect.poll(async () => page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ))).toBe(true)
})

test('Calendar click opens an existing Diary through the real Vault route, tab, and editor lifecycle', async ({ page, request }) => {
  const date = localCivilDate()
  const path = diaryPath(date)
  const raw = '# Existing Diary\n\nD4 lifecycle integration evidence.\n'
  const diagnostics = browserDiagnostics(page)
  const createMethods: string[] = []
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url())
    if (url.pathname === '/api/diary/dates') createMethods.push(requestEvent.method())
  })

  try {
    await seedExistingDiary(request, date, raw)
    await page.goto('/vault')
    await expect(page.locator('.file-tree')).toBeVisible()
    await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()

    const surface = page.getByTestId('diary-calendar-surface')
    await expect(surface).toBeVisible()
    const dateButton = surface.locator(`[data-diary-day-content][data-date="${date}"]`)
    await expect(dateButton).toBeVisible()
    await dateButton.click()

    await expect(page).toHaveURL(new RegExp(`/vault/${path.replace('/', '\\/')}(?:[?#]|$)`), { timeout: 15_000 })
    const tab = page.locator(`[role="tab"][data-tab-id="${path}"]`)
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.editor-pane .monaco-editor .view-lines').first())
      .toContainText('D4 lifecycle integration evidence.', { timeout: 15_000 })

    const calendar = page.getByTestId('diary-calendar')
    await expect(calendar).toBeAttached()
    await expect(calendar).toBeHidden()

    expect(createMethods).toEqual([])
    expect((await request.get(`/api/posts/${diaryPath(`${date}-2`)}`)).status()).toBe(404)

    await tab.locator('.tab-close').click()
    await expect(tab).toHaveCount(0)
    await expect(calendar).toBeVisible()
  } finally {
    await deleteDiaryDate(request, date)
  }

  expect(diagnostics.pageErrors).toEqual([])
  expect(diagnostics.consoleErrors).toEqual([])
  expect(diagnostics.notFoundResponses).toEqual([])
})

test('Calendar click on a missing future Diary is a browser-visible no-op', async ({ page, request }) => {
  const today = localCivilDate()
  const future = nextCivilDate(today)
  const futurePath = diaryPath(future)
  const diagnostics = browserDiagnostics(page)
  const createMethods: string[] = []
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url())
    if (url.pathname === '/api/diary/dates') createMethods.push(requestEvent.method())
  })

  try {
    await deleteDiaryDate(request, future)
    await page.goto('/vault')
    await expect(page.locator('.file-tree')).toBeVisible()
    await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()

    const surface = page.getByTestId('diary-calendar-surface')
    await expect(surface).toBeVisible()
    const routeBefore = new URL(page.url()).pathname
    const tabsBefore = await page.locator('.tabs').count()
    const dateButton = surface.locator(`[data-diary-day-content][data-date="${future}"]`)
    await expect(dateButton).toBeVisible()
    const probeResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname === `/api/posts/${futurePath}`
    })
    await dateButton.click()
    expect((await probeResponse).status()).toBe(404)
    await expect.poll(() => createMethods).toEqual([])

    expect(new URL(page.url()).pathname).toBe(routeBefore)
    expect(await page.locator('.tabs').count()).toBe(tabsBefore)
    expect((await request.get(`/api/posts/${futurePath}`)).status()).toBe(404)
  } finally {
    await deleteDiaryDate(request, future)
  }

  expect(diagnostics.pageErrors).toEqual([])
  expect(diagnostics.consoleErrors).toEqual([
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
  ])
  expect(diagnostics.notFoundResponses).toEqual([{
    method: 'GET',
    pathname: `/api/posts/${futurePath}`,
    status: 404,
  }])
})
