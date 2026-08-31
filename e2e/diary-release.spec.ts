import { expect, test, type APIRequestContext, type Page } from './fixtures/diary'

const TEST_TIME_ZONE = 'Asia/Shanghai'

test.use({ trace: 'off', screenshot: 'only-on-failure' })

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
  expect([200, 404, 422]).toContain(response.status())
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
  // The caller is already returned to Calendar Home after closing the last
  // Diary tab. Avoid an unnecessary full navigation that would replace the
  // browser JS process and force another process-local access bootstrap.
  if (new URL(page.url()).pathname !== '/vault') await page.goto('/vault')
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
      const title = document.querySelector<HTMLElement>('.vc-title')
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
        title: rect(title),
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
    const titleOffset = (metrics.title?.right ?? 0) - (metrics.title?.width ?? 0) / 2
      - ((metrics.surface?.right ?? 0) - (metrics.surface?.width ?? 0) / 2)
    expect(Math.abs(titleOffset), `${viewport.name} month title alignment`)
      .toBeLessThanOrEqual((metrics.surface?.width ?? 0) * 0.1)
    expect(metrics.previous?.width, `${viewport.name} previous target`).toBeGreaterThanOrEqual(40)
    expect(metrics.previous?.height, `${viewport.name} previous target`).toBeGreaterThanOrEqual(40)
    expect(metrics.next?.width, `${viewport.name} next target`).toBeGreaterThanOrEqual(40)
    expect(metrics.next?.height, `${viewport.name} next target`).toBeGreaterThanOrEqual(40)
    expect(metrics.dayCount, `${viewport.name} visible date count`).toBeGreaterThan(0)
    expect(metrics.minDayWidth, `${viewport.name} minimum date target width`).toBeGreaterThanOrEqual(36)
    expect(metrics.minDayHeight, `${viewport.name} minimum date target height`).toBeGreaterThanOrEqual(40)

    await expect(page.locator('.diary-calendar-surface-header')).toHaveCount(0)
    await expect(page.locator('.diary-calendar-toolbar')).toHaveCount(0)
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

test('Diary Calendar navigation exposes keyboard-only focus indicators', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await openDiaryScope(page)
  const previous = page.locator('.vc-pane-header-wrapper .vc-prev')
  const next = page.locator('.vc-pane-header-wrapper .vc-next')
  const title = page.locator('.vc-title:visible').first()

  async function focusPreviousWithKeyboard(): Promise<void> {
    await page.locator('.vault').focus()
    for (let attempt = 0; attempt < 32; attempt += 1) {
      await page.keyboard.press('Tab')
      if (await previous.evaluate((element) => element === document.activeElement)) return
    }
    throw new Error('Prev did not receive focus through keyboard Tab navigation')
  }

  async function assertKeyboardFocus(control: typeof previous): Promise<void> {
    const before = await control.boundingBox()
    await expect(control).toBeFocused()
    const style = await control.evaluate((element) => {
      const computed = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return {
        outlineStyle: computed.outlineStyle,
        outlineWidth: computed.outlineWidth,
        outlineColor: computed.outlineColor,
        outlineOffset: computed.outlineOffset,
        backgroundColor: computed.backgroundColor,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }
    })

    expect(style.outlineStyle).toBe('solid')
    expect(style.outlineWidth).toBe('2px')
    expect(style.outlineOffset).toBe('2px')
    expect(style.outlineColor).not.toMatch(/transparent|rgba?\(0,\s*0,\s*0(?:,\s*0)?\)/i)
    expect(style.backgroundColor).toMatch(/rgba?\(0,\s*0,\s*0(?:,\s*0)?\)/i)
    expect(style.rect.width).toBe(44)
    expect(style.rect.height).toBe(44)
    expect(style.rect.x - 2).toBeGreaterThanOrEqual(0)
    expect(style.rect.y - 2).toBeGreaterThanOrEqual(0)
    expect(style.rect.x + style.rect.width + 2).toBeLessThanOrEqual(style.viewport.width)
    expect(style.rect.y + style.rect.height + 2).toBeLessThanOrEqual(style.viewport.height)
    expect(before).not.toBeNull()
    expect(style.rect.width).toBe(before?.width)
    expect(style.rect.height).toBe(before?.height)
    expect(style.rect.x).toBe(before?.x)
    expect(style.rect.y).toBe(before?.y)
  }

  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') {
      await page.getByRole('button', { name: /Theme: Light|主题：浅色/ }).click()
      await expect(page.locator('.vc-container.vc-dark')).toBeVisible()
    }

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 375, height: 812 },
    ]) {
      await page.setViewportSize(viewport)
      await expect(title).toHaveText('2026-08')
      await focusPreviousWithKeyboard()
      await assertKeyboardFocus(previous)

      await page.keyboard.press('Tab')
      await assertKeyboardFocus(next)
    }
  }

  await expect(page.getByRole('button', { name: '今天', exact: true })).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('Diary scope keeps Calendar hidden while managed document tabs are open', async ({ page, request }) => {
  const date = localCivilDate()
  const diary = diaryPath(date)
  const note = 'inbox/d6-hidden-shortcut-note'
  const state = diagnostics(page)

  try {
    await seedExistingDiary(request, date)
    await seedOrdinaryNote(request, note)
    await openDiaryScope(page)

    await page.locator(`[data-diary-day-content][data-date="${date}"]`).click()
    await expect(page.locator(`[role="tab"][data-tab-id="${diary}"]`)).toHaveCount(1)

    await page.locator('.scope-chip').filter({ hasText: 'note' }).click()
    await expect(page.locator('.file-tree')).toBeVisible()
    const noteRow = page.locator(`[data-tree-key="file:${note}"]`)
    const inboxRow = page.locator('[data-tree-key="folder:inbox"]')
    if (await noteRow.count() === 0 && await inboxRow.count() > 0) await inboxRow.click()
    await expect(noteRow).toBeVisible()
    await noteRow.click()
    await expect(page).toHaveURL(new RegExp(`/vault/${note.replace('/', '\\/')}(?:[?#]|$)`))

    await page.locator('.scope-chip').filter({ hasText: 'diary' }).click()
    await expect(page.getByTestId('diary-calendar')).toBeHidden()
    await expect(page.locator('.tabs')).toBeVisible()
    await expect(page.locator(`[role="tab"][data-tab-id="${diary}"]`)).toHaveCount(1)
    await expect(page.locator(`[role="tab"][data-tab-id="${note}"]`)).toHaveCount(1)
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
    const previous = page.locator('.vc-prev')
    const next = page.locator('.vc-next')
    const dateButton = surface.locator(`[data-diary-day-content][data-date="${date}"]`)

    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(previous).toHaveAccessibleName('Previous month')
    await expect(next).toHaveAccessibleName('Next month')
    await expect(dateButton).toHaveAccessibleName(/Diary exists/i)

    await dateButton.focus()
    await page.keyboard.press('Enter')
    const tab = page.locator(`[role="tab"][data-tab-id="${diaryPath(date)}"]`)
    await expect(tab).toHaveCount(1)
    await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
    await expect(page.locator('.reading-pane')).toHaveCount(1)
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
    await expect(tab).toHaveCount(1)
    await expect(page.locator('.reading-pane')).toHaveCount(1)
    await tab.locator('.tab-close').click()
    await expect(tab).toHaveCount(0)
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

test('Diary markers remain structural when managed delete is fail-closed', async ({ page, request }) => {
  const date = localCivilDate()
  await seedExistingDiary(request, date)

  try {
    await openDiaryScope(page)
    const dayButton = page.locator(`[data-diary-day-content][data-date="${date}"]`)
    await expect(dayButton).toBeVisible()
    await expect(dayButton.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " vc-day ")]').locator('.vc-dot')).toHaveCount(1)
    await expect(dayButton).toHaveAccessibleName(/Diary exists/i)

    const rejected = await request.delete(`/api/posts/${diaryPath(date)}`)
    expect(rejected.status(), await rejected.text()).toBe(422)
    expect(await rejected.json()).toMatchObject({ code: 'diary-encrypted-delete-unsupported' })
    await page.reload()
    await openDiaryScope(page)
    const retainedDayButton = page.locator(`[data-diary-day-content][data-date="${date}"]`)
    await expect(retainedDayButton).toBeVisible()
    await expect(retainedDayButton.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " vc-day ")]').locator('.vc-dot')).toHaveCount(1)
    await expect(retainedDayButton).toHaveAccessibleName(/Diary exists/i)
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
      await expect(tab).toHaveCount(1)
      await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
      await expect(page.locator('.reading-pane article').first())
        .toContainText('D5 release evidence.', { timeout: 15_000 })
      await expect(page.locator('.reading-pane')).toHaveCount(1)
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
