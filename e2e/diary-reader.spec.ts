import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page } from './fixtures/auth'

const TEST_TIME_ZONE = 'Asia/Shanghai'

function civilParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function daysInMonth(year: number, month: number): number {
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
  if (month === 2) return leap ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

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
  const parts = civilParts(value)
  let { year, month, day } = parts
  day += 1
  if (day > daysInMonth(year, month)) {
    day = 1
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function previousCivilDate(value: string): string {
  const parts = civilParts(value)
  let { year, month, day } = parts
  day -= 1
  if (day === 0) {
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
    day = daysInMonth(year, month)
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

/**
 * The public Diary create command intentionally rejects future dates. This
 * fixture writes one pre-existing managed file directly so the browser can
 * exercise the separate "existing future → opened" branch without weakening
 * that server contract.
 */
async function seedExistingFutureDiary(date: string, raw: string): Promise<void> {
  const vault = process.env.DOCUS_DRAFT_E2E_VAULT
  if (!vault) throw new Error('DOCUS_DRAFT_E2E_VAULT is not configured')
  const diaryDirectory = join(vault, 'diary')
  const file = join(diaryDirectory, `${date}.md`)
  await mkdir(diaryDirectory, { recursive: true })
  await rm(file, { force: true })
  await writeFile(file, raw, 'utf8')
}

async function openDiaryScope(page: Page): Promise<void> {
  await page.goto('/vault')
  const surface = page.getByTestId('diary-calendar-surface')
  if (await surface.count() === 0) {
    await page.locator('.scope-chip').filter({ hasText: 'note' }).click()
    await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()
  }
  await expect(surface).toBeVisible({ timeout: 15_000 })
}

async function moveToMonth(page: Page, date: string): Promise<void> {
  const targetMonth = date.slice(0, 7)
  const calendar = page.getByTestId('diary-calendar')
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const currentMonth = await calendar.getAttribute('data-month')
    if (currentMonth === targetMonth) return
    if (!currentMonth) throw new Error('Calendar did not expose its current month')
    const control = currentMonth < targetMonth
      ? page.getByTestId('diary-calendar-next')
      : page.getByTestId('diary-calendar-previous')
    await control.click()
  }
  throw new Error(`Calendar did not reach ${targetMonth}`)
}

async function clickDiaryDate(page: Page, date: string): Promise<void> {
  await moveToMonth(page, date)
  const button = page.locator(`[data-diary-day-content][data-date="${date}"]`)
  await expect(button).toBeVisible()
  await button.click()
}

function diagnostics(page: Page): {
  pageErrors: string[]
  consoleErrors: string[]
  notFoundResponses: Array<{ method: string; pathname: string }>
} {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const notFoundResponses: Array<{ method: string; pathname: string }> = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() !== 404) return
    const url = new URL(response.url())
    notFoundResponses.push({ method: response.request().method(), pathname: url.pathname })
  })
  return { pageErrors, consoleErrors, notFoundResponses }
}

async function assertReader(page: Page, date: string): Promise<void> {
  const path = diaryPath(date)
  const reader = page.getByTestId('diary-reader-dialog')
  const calendar = page.getByTestId('diary-calendar')
  const tab = page.locator(`[role="tab"][data-tab-id="${path}"]`)

  await expect(reader).toBeVisible({ timeout: 15_000 })
  await expect(reader).toHaveAttribute('data-path', path)
  await expect(reader.locator('#diary-reader-title')).toHaveText(date)
  await expect(tab).toHaveCount(1)
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(calendar).toBeAttached()
  await expect(calendar).toBeHidden()
  await expect(page.locator('.reading-pane')).toHaveCount(1)
  await expect(reader.getByTestId('diary-reader-back')).toBeFocused()
}

test('existing Diary opens in one Reader, closes presentation-only, and restores Calendar focus', async ({ page, request }) => {
  const date = localCivilDate()
  const path = diaryPath(date)
  const raw = '# Reader evidence\n\nA heading, a [link](https://example.com), and a code block.\n\n```ts\nconst answer = 42\n```\n'
  const state = diagnostics(page)

  try {
    await seedExistingDiary(request, date, raw)
    await openDiaryScope(page)
    const dateButton = page.locator(`[data-diary-day-content][data-date="${date}"]`)
    const monthBefore = await page.getByTestId('diary-calendar').getAttribute('data-month')

    await clickDiaryDate(page, date)
    await expect(page).toHaveURL(new RegExp(`/vault/${path.replace('/', '\\/')}(?:[?#]|$)`))
    await assertReader(page, date)
    await expect(page.getByTestId('diary-reader-dialog').locator('article.article')).toContainText('Reader evidence')
    await expect(page.getByTestId('diary-reader-dialog').locator('pre')).toContainText('const answer = 42')
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0)
    await expect(page.locator('.vc-title')).toHaveText(/\d{4}-\d{2}/)

    const hiddenCalendarOwnsFocus = await page.evaluate(() => {
      const active = document.activeElement
      const calendar = document.querySelector<HTMLElement>('[data-testid="diary-calendar"]')
      return Boolean(active && calendar?.contains(active))
    })
    expect(hiddenCalendarOwnsFocus).toBe(false)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => {
        const active = document.activeElement
        const calendar = document.querySelector<HTMLElement>('[data-testid="diary-calendar"]')
        return Boolean(active && calendar?.contains(active))
      })).toBe(false)
    }

    const routeBeforeClose = new URL(page.url()).pathname
    await page.getByTestId('diary-reader-close').click()
    await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`${routeBeforeClose.replace('/', '\\/')}(?:[?#]|$)`))
    await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveCount(1)
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(page.getByTestId('diary-calendar')).toHaveAttribute('data-month', monthBefore ?? '')
    await expect(dateButton).toBeFocused()

    await dateButton.click()
    await assertReader(page, date)
    await page.getByTestId('diary-reader-back').click()
    await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(dateButton).toBeFocused()

    await dateButton.click()
    await assertReader(page, date)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(dateButton).toBeFocused()

    // Presentation close deliberately preserves the backing tab. The
    // isolated browser context cleans up that tab after the test.
  } finally {
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('created and existing future Diaries enter Reader, while missing future stays Home', async ({ page, request }) => {
  const today = localCivilDate()
  const past = previousCivilDate(today)
  const existingFuture = nextCivilDate(today)
  const missingFuture = nextCivilDate(existingFuture)
  const createdDates = [today, past]
  const seededDates = [existingFuture]
  const state = diagnostics(page)
  const createMethods: string[] = []
  page.on('request', (event) => {
    const url = new URL(event.url())
    if (url.pathname === '/api/diary/dates') createMethods.push(event.method())
  })

  try {
    for (const date of [...createdDates, ...seededDates, missingFuture]) await deleteDiaryDate(request, date)

    await openDiaryScope(page)
    await clickDiaryDate(page, today)
    await assertReader(page, today)
    await expect.poll(() => createMethods.filter((method) => method === 'POST').length).toBe(1)
    await page.goto('/vault')

    await openDiaryScope(page)
    await clickDiaryDate(page, past)
    await assertReader(page, past)
    await expect.poll(() => createMethods.filter((method) => method === 'POST').length).toBe(2)
    await page.goto('/vault')

    await seedExistingFutureDiary(existingFuture, `# Existing future\n\n${existingFuture}\n`)
    await openDiaryScope(page)
    await clickDiaryDate(page, existingFuture)
    await assertReader(page, existingFuture)
    await page.goto('/vault')

    await openDiaryScope(page)
    await clickDiaryDate(page, missingFuture)
    await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect.poll(() => createMethods.filter((method) => method === 'POST').length).toBe(2)
    expect(new URL(page.url()).pathname).not.toBe(`/vault/${missingFuture}`)
  } finally {
    for (const date of [...createdDates, ...seededDates, missingFuture]) await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.notFoundResponses.length).toBeGreaterThan(0)
  const expectedNotFoundPaths = new Set([
    ...createdDates,
    missingFuture,
  ].map((date) => `/api/posts/${diaryPath(date)}`))
  for (const response of state.notFoundResponses) {
    expect(response.method).toBe('GET')
    expect(expectedNotFoundPaths.has(response.pathname)).toBe(true)
  }
  expect(state.consoleErrors).toEqual(expect.arrayContaining([
    'Failed to load resource: the server responded with a status of 404 (Not Found)',
  ]))
})

test('Reader Edit is only the existing D5 editor fallback and remains responsive', async ({ page, request }) => {
  const date = localCivilDate()
  const path = diaryPath(date)
  const state = diagnostics(page)
  const documentGets: string[] = []
  page.on('request', (event) => {
    const url = new URL(event.url())
    if (event.method() === 'GET' && url.pathname === `/api/posts/${path}`) documentGets.push(url.pathname)
  })

  try {
    await seedExistingDiary(request, date, `# Edit fallback\n\nD6.3 reader content.\n`)
    await openDiaryScope(page)
    await clickDiaryDate(page, date)
    await assertReader(page, date)
    const getsAfterReader = documentGets.length

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 375, height: 812 },
      { width: 320, height: 700 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(page.getByTestId('diary-reader-dialog')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      for (const testId of ['diary-reader-back', 'diary-reader-edit', 'diary-reader-close']) {
        const box = await page.getByTestId(testId).boundingBox()
        expect(box?.width ?? 0, `${testId} width at ${viewport.width}`).toBeGreaterThanOrEqual(40)
        expect(box?.height ?? 0, `${testId} height at ${viewport.width}`).toBeGreaterThanOrEqual(40)
      }
    }

    const themeRoot = page.locator('html')
    const initialTheme = await themeRoot.getAttribute('data-theme')
    const nextTheme = initialTheme === 'dark' ? 'light' : 'dark'
    await page.locator('.theme-toggle').click()
    await expect(themeRoot).toHaveAttribute('data-theme', nextTheme)
    await expect(page.getByTestId('diary-reader-dialog')).toBeVisible()
    await page.locator('.theme-toggle').click()
    await expect(themeRoot).toHaveAttribute('data-theme', initialTheme ?? 'light')

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByTestId('diary-reader-edit').click()
    await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveCount(1)
    await expect(page).toHaveURL(new RegExp(`/vault/${path.replace('/', '\\/')}(?:[?#]|$)`))
    await expect(page.getByTestId('diary-calendar')).toBeAttached()
    await expect(page.getByTestId('diary-calendar')).toBeHidden()
    await expect.poll(() => documentGets.length).toBe(getsAfterReader)

    // The backing tab remains intentionally open after the D5 fallback.
  } finally {
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('Reader presentation remains stable across five open/close cycles without dayIndex errors', async ({ page, request }) => {
  const date = localCivilDate()
  await seedExistingDiary(request, date, '# Repeated Reader\n\ncycle evidence\n')
  const state = diagnostics(page)

  try {
    await openDiaryScope(page)
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await clickDiaryDate(page, date)
      await assertReader(page, date)
      await page.getByTestId('diary-reader-close').click()
      await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
      await expect(page.getByTestId('diary-calendar')).toBeVisible()
      await expect(page.locator(`[role="tab"][data-tab-id="${diaryPath(date)}"]`)).toHaveCount(1)
    }
  } finally {
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})
