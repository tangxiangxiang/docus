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

function diaryPath(date: string): string {
  return `diary/${date}`
}

async function deleteDiaryDate(request: APIRequestContext, date: string): Promise<void> {
  const response = await request.delete(`/api/posts/${diaryPath(date)}`)
  expect([200, 404]).toContain(response.status())
}

async function seedExistingDiary(request: APIRequestContext, date: string): Promise<void> {
  await deleteDiaryDate(request, date)
  const created = await request.post('/api/diary/dates', {
    data: { date, timeZone: TEST_TIME_ZONE },
  })
  expect(created.status(), await created.text()).toBe(201)
  const saved = await request.put(`/api/posts/${diaryPath(date)}`, {
    data: { raw: `# ${date}\n\nD5 release evidence.\n`, baseRaw: `# ${date}\n` },
  })
  expect(saved.status(), await saved.text()).toBe(200)
}

async function seedOrdinaryNote(request: APIRequestContext, path: string): Promise<void> {
  const removed = await request.delete(`/api/posts/${path}`)
  expect([200, 404]).toContain(removed.status())
  const created = await request.post('/api/posts', {
    data: { path, title: 'D6 hidden shortcut note' },
  })
  expect([200, 201]).toContain(created.status())
  const initial = await request.get(`/api/posts/${path}`)
  expect(initial.status()).toBe(200)
  const saved = await request.put(`/api/posts/${path}`, {
    data: { raw: '# Hidden shortcut note\n', baseRaw: (await initial.json()).raw },
  })
  expect(saved.status(), await saved.text()).toBe(200)
}

async function openDiaryScope(page: Page): Promise<void> {
  await page.goto('/vault')
  const surface = page.getByTestId('diary-calendar-surface')
  if (await surface.count() === 0) {
    await page.locator('.scope-chip').filter({ hasText: 'note' }).click()
    await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()
  }
  await expect(surface).toBeVisible()
}

function diagnostics(page: Page): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  return { pageErrors, consoleErrors }
}

test('Diary Calendar remains usable across the D5 responsive matrix', async ({ page }) => {
  await openDiaryScope(page)
  const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 812 },
    { name: 'narrow', width: 320, height: 700 },
  ]

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    const metrics = await page.evaluate(() => {
      const calendar = document.querySelector<HTMLElement>('[data-testid="diary-calendar"]')
      const surface = document.querySelector<HTMLElement>('[data-testid="diary-calendar-surface"]')
      const host = document.querySelector<HTMLElement>('.diary-calendar-host')
      const vcContainer = document.querySelector<HTMLElement>('.diary-calendar-host .vc-container')
      const today = document.querySelector<HTMLElement>('[data-testid="diary-calendar-today"]')
      const previous = document.querySelector<HTMLElement>('.vc-prev')
      const next = document.querySelector<HTMLElement>('.vc-next')
      const rect = (element: HTMLElement | null) => {
        if (!element) return null
        const box = element.getBoundingClientRect()
        return { width: box.width, height: box.height, right: box.right }
      }
      const visibleDayRects = [...document.querySelectorAll<HTMLElement>('[data-diary-day-content]')]
        .map((element) => {
          const box = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return {
            width: box.width,
            height: box.height,
            visible: style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0,
          }
        })
        .filter((day) => day.visible)
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        surface: rect(surface),
        calendar: rect(calendar),
        host: rect(host),
        vcContainer: rect(vcContainer),
        today: rect(today),
        previous: rect(previous),
        next: rect(next),
        minDayWidth: Math.min(...visibleDayRects.map((day) => day.width)),
        minDayHeight: Math.min(...visibleDayRects.map((day) => day.height)),
        dayCount: visibleDayRects.length,
      }
    })
    expect(metrics.scrollWidth, `${viewport.name} horizontal overflow`).toBeLessThanOrEqual(metrics.viewport + 1)
    expect(metrics.surface?.width, `${viewport.name} surface width`).toBeGreaterThan(0)
    expect(metrics.surface?.height, `${viewport.name} surface height`).toBeGreaterThan(0)
    expect(metrics.calendar?.right, `${viewport.name} calendar overflow`).toBeLessThanOrEqual(metrics.viewport + 1)
    expect(metrics.host?.right, `${viewport.name} host overflow`).toBeLessThanOrEqual(metrics.viewport + 1)
    expect(metrics.host?.width, `${viewport.name} host fills surface width`)
      .toBeGreaterThanOrEqual((metrics.surface?.width ?? 0) * 0.95)
    expect(metrics.vcContainer?.width, `${viewport.name} VCalendar fills host width`)
      .toBeGreaterThanOrEqual((metrics.host?.width ?? 0) * 0.95)
    expect(metrics.host?.height, `${viewport.name} host fills surface height`)
      .toBeGreaterThanOrEqual((metrics.surface?.height ?? 0) * 0.9)
    expect(metrics.vcContainer?.height, `${viewport.name} VCalendar fills host height`)
      .toBeGreaterThanOrEqual((metrics.host?.height ?? 0) * 0.9)
    expect(metrics.today?.width, `${viewport.name} Today target`).toBeGreaterThanOrEqual(40)
    expect(metrics.today?.height, `${viewport.name} Today target`).toBeGreaterThanOrEqual(40)
    expect(metrics.previous?.width, `${viewport.name} previous target`).toBeGreaterThanOrEqual(40)
    expect(metrics.previous?.height, `${viewport.name} previous target`).toBeGreaterThanOrEqual(40)
    expect(metrics.next?.width, `${viewport.name} next target`).toBeGreaterThanOrEqual(40)
    expect(metrics.next?.height, `${viewport.name} next target`).toBeGreaterThanOrEqual(40)
    expect(metrics.dayCount, `${viewport.name} visible date count`).toBeGreaterThan(0)
    expect(metrics.minDayWidth, `${viewport.name} minimum date target width`).toBeGreaterThanOrEqual(40)
    expect(metrics.minDayHeight, `${viewport.name} minimum date target height`).toBeGreaterThanOrEqual(40)

    await expect(page.locator('.diary-calendar-surface-header')).toHaveCount(0)
    await expect(page.locator('.diary-calendar-toolbar')).toHaveCount(0)
    await expect(page.getByTestId('diary-calendar-today')).toBeVisible()
    await expect(page.locator('.vc-title')).toBeVisible()
    await expect(page.locator('.file-tree')).toBeHidden()
    await expect(page.locator('.right-rail-slot')).toBeHidden()
    await expect(page.locator('.status-bar-row')).toBeHidden()
    await expect(page.locator('.diary-calendar-content')).toBeVisible()
  }

  await page.locator('.scope-chip').filter({ hasText: 'note' }).click()
  await expect(page.getByTestId('diary-calendar-surface')).toHaveCount(0)
  await expect(page.locator('.file-tree')).toBeVisible()
  await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()
  await expect(page.getByTestId('diary-calendar-surface')).toBeVisible()
  await expect(page.locator('.file-tree')).toBeHidden()
})

test('Diary Home does not give hidden document tabs keyboard ownership', async ({ page, request }) => {
  const date = localCivilDate()
  const diary = diaryPath(date)
  const note = 'inbox/d6-hidden-shortcut-note'
  const state = diagnostics(page)

  try {
    await seedExistingDiary(request, date)
    await seedOrdinaryNote(request, note)
    await openDiaryScope(page)

    await page.locator(`[data-diary-day-content][data-date="${date}"]`).click()
    await expect(page.locator(`[role="tab"][data-tab-id="${diary}"]`)).toBeVisible({ timeout: 15_000 })

    await page.locator('.scope-chip').filter({ hasText: 'note' }).click()
    await expect(page.locator('.file-tree')).toBeVisible()
    const noteRow = page.locator(`[data-tree-key="file:${note}"]`)
    const inboxRow = page.locator('[data-tree-key="folder:inbox"]')
    if (await noteRow.count() === 0 && await inboxRow.count() > 0) await inboxRow.click()
    await expect(noteRow).toBeVisible()
    await noteRow.click()
    await expect(page).toHaveURL(new RegExp(`/vault/${note.replace('/', '\\/')}(?:[?#]|$)`))

    await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(page.locator('.tabs')).toBeHidden()
    await expect(page.locator(`[role="tab"][data-tab-id="${diary}"]`)).toHaveCount(1)
    await expect(page.locator(`[role="tab"][data-tab-id="${note}"]`)).toHaveCount(1)

    const routeBefore = new URL(page.url()).pathname
    const activeTabBefore = await page.locator('[role="tab"][data-tab-id][aria-selected="true"]').getAttribute('data-tab-id')
    await page.locator('.vault').focus()
    await page.keyboard.press('Control+w')
    await page.keyboard.press('Control+Tab')

    expect(new URL(page.url()).pathname).toBe(routeBefore)
    expect(await page.locator('[role="tab"][data-tab-id][aria-selected="true"]').getAttribute('data-tab-id')).toBe(activeTabBefore)
    expect(await page.locator(`[role="tab"][data-tab-id="${diary}"]`).count()).toBe(1)
    expect(await page.locator(`[role="tab"][data-tab-id="${note}"]`).count()).toBe(1)
  } finally {
    await deleteDiaryDate(request, date)
    const removed = await request.delete(`/api/posts/${note}`)
    expect([200, 404]).toContain(removed.status())
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('Diary Home does not claim W or Tab when no workspace target exists', async ({ page }) => {
  const state = diagnostics(page)
  await openDiaryScope(page)
  await expect(page.locator('.tabs')).toHaveCount(0)

  const result = await page.locator('.vault').evaluate((element) => {
    const dispatch = (key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      element.dispatchEvent(event)
      return event.defaultPrevented
    }
    return { close: dispatch('w'), cycle: dispatch('Tab') }
  })

  expect(result).toEqual({ close: false, cycle: false })
  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('Diary Calendar keyboard flow does not strand focus in the hidden surface', async ({ page, request }) => {
  const date = localCivilDate()
  await seedExistingDiary(request, date)
  const state = diagnostics(page)

  try {
    await openDiaryScope(page)
    const calendar = page.getByTestId('diary-calendar')
    const surface = page.getByTestId('diary-calendar-surface')
    const today = page.getByTestId('diary-calendar-today')
    const previous = page.locator('.vc-prev')
    const next = page.locator('.vc-next')
    const dateButton = surface.locator(`[data-diary-day-content][data-date="${date}"]`)

    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(today).toHaveAccessibleName('Today')
    await expect(previous).toHaveAccessibleName('Previous month')
    await expect(next).toHaveAccessibleName('Next month')
    await expect(dateButton).toHaveAccessibleName(/Diary exists/i)

    await today.focus()
    await page.keyboard.press('Enter')
    const tab = page.locator(`[role="tab"][data-tab-id="${diaryPath(date)}"]`)
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await expect(calendar).toBeHidden()
    expect(await page.evaluate(() => {
      const active = document.activeElement
      const hiddenCalendar = document.querySelector<HTMLElement>('[data-testid="diary-calendar"]')
      return Boolean(active && hiddenCalendar?.contains(active))
    })).toBe(false)

    await tab.locator('.tab-close').click()
    await expect(tab).toHaveCount(0)
    await expect(calendar).toBeVisible()

    await dateButton.focus()
    await page.keyboard.press('Space')
    await expect(tab).toBeVisible({ timeout: 15_000 })
    await tab.locator('.tab-close').click()
    await expect(calendar).toBeVisible()

    await page.locator('.scope-chip').filter({ hasText: 'note' }).click()
    await expect(surface).toHaveCount(0)
    await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()
    await expect(surface).toBeVisible()
    expect(await page.evaluate(() => {
      const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map((element) => element.id)
      return ids.length === new Set(ids).size
    })).toBe(true)
  } finally {
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('Diary markers appear after create and disappear after managed delete', async ({ page, request }) => {
  const date = localCivilDate()
  await seedExistingDiary(request, date)

  try {
    await openDiaryScope(page)
    const dayButton = page.locator(`[data-diary-day-content][data-date="${date}"]`)
    await expect(dayButton).toBeVisible()
    await expect(dayButton.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " vc-day ")]').locator('.vc-dot')).toHaveCount(1)
    await expect(dayButton).toHaveAccessibleName(/Diary exists/i)

    await deleteDiaryDate(request, date)
    await page.reload()
    await openDiaryScope(page)
    const deletedDayButton = page.locator(`[data-diary-day-content][data-date="${date}"]`)
    await expect(deletedDayButton).toBeVisible()
    await expect(deletedDayButton.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " vc-day ")]').locator('.vc-dot')).toHaveCount(0)
    await expect(deletedDayButton).not.toHaveAccessibleName(/Diary exists/i)
  } finally {
    await deleteDiaryDate(request, date)
  }
})

test('Existing Diary lifecycle remains stable across five repeated opens', async ({ page, request }) => {
  const date = localCivilDate()
  await seedExistingDiary(request, date)
  const state = diagnostics(page)

  try {
    for (let run = 0; run < 5; run += 1) {
      await openDiaryScope(page)
      const path = diaryPath(date)
      await page.locator(`[data-diary-day-content][data-date="${date}"]`).click()
      const tab = page.locator(`[role="tab"][data-tab-id="${path}"]`)
      await expect(tab).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.editor-pane .monaco-editor .view-lines').first())
        .toContainText('D5 release evidence.', { timeout: 15_000 })
      await expect(page.getByTestId('diary-calendar')).toBeHidden()
      await tab.locator('.tab-close').click()
      await expect(tab).toHaveCount(0)
      await expect(page.getByTestId('diary-calendar')).toBeVisible()
    }
  } finally {
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})
