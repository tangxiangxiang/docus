import { expect, test, type APIRequestContext, type Page } from './fixtures/auth'
import {
  appendEditorText,
  clearDraftDatabase,
  draftRowCount,
  gotoVaultReady,
  interceptAutosaveAborted,
  interceptAutosaveHeld,
  interceptHistory,
  setEditorContent,
} from './helpers/edit-program'

const TEST_TIME_ZONE = 'Asia/Shanghai'
const RUN_ID = String(Date.now())

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

function normalizeLineEndings(raw: string): string {
  return raw.replace(/\r\n?/g, '\n')
}

async function deleteDiaryDate(request: APIRequestContext, date: string): Promise<void> {
  const response = await request.delete(`/api/posts/${diaryPath(date)}`)
  expect([200, 404]).toContain(response.status())
}

async function seedDiary(
  request: APIRequestContext,
  date: string,
  raw: string,
): Promise<{ documentId: string; raw: string }> {
  await deleteDiaryDate(request, date)
  const created = await request.post('/api/diary/dates', {
    data: { date, timeZone: TEST_TIME_ZONE },
  })
  expect(created.status(), await created.text()).toBe(201)

  const initialResponse = await request.get(`/api/posts/${diaryPath(date)}`)
  expect(initialResponse.status()).toBe(200)
  const initial = await initialResponse.json()
  const saved = await request.put(`/api/posts/${diaryPath(date)}`, {
    data: { raw, baseRaw: initial.raw },
  })
  expect(saved.status(), await saved.text()).toBe(200)

  const detailResponse = await request.get(`/api/posts/${diaryPath(date)}`)
  expect(detailResponse.status()).toBe(200)
  const detail = await detailResponse.json()
  return {
    documentId: detail.metadata.id as string,
    raw: detail.raw as string,
  }
}

async function openDiaryHome(page: Page): Promise<void> {
  await page.goto('/vault')
  await expect(page.locator('.file-tree')).toBeVisible()
  const diaryChip = page.locator('.scope-chip').filter({ hasText: 'diary' })
  if (await diaryChip.getAttribute('aria-pressed') !== 'true') await diaryChip.click()
  await expect(page.getByTestId('diary-calendar-surface')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('diary-calendar')).toBeVisible()
}

async function moveToMonth(page: Page, date: string): Promise<void> {
  const targetMonth = date.slice(0, 7)
  const calendar = page.getByTestId('diary-calendar')
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const currentMonth = await calendar.getAttribute('data-month')
    if (currentMonth === targetMonth) return
    if (!currentMonth) throw new Error('Calendar did not expose its current month')
    await page.getByTestId(currentMonth < targetMonth ? 'diary-calendar-next' : 'diary-calendar-previous').click()
  }
  throw new Error(`Calendar did not reach ${targetMonth}`)
}

async function clickDiaryDate(page: Page, date: string): Promise<void> {
  await moveToMonth(page, date)
  const button = page.locator(`[data-diary-day-content][data-date="${date}"]`)
  await expect(button).toBeVisible()
  await button.click()
}

function diagnostics(page: Page, ignoredConsoleFragments: string[] = []): { pageErrors: string[]; consoleErrors: string[] } {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (ignoredConsoleFragments.some((fragment) => message.text().includes(fragment))) return
    consoleErrors.push(message.text())
  })
  return { pageErrors, consoleErrors }
}

async function assertNativeReader(page: Page, date: string): Promise<void> {
  const path = diaryPath(date)
  await expect(page).toHaveURL(new RegExp(`/vault/${path.replace('/', '\\/')}(?:[?#]|$)`))
  await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
  await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.reading-pane')).toHaveCount(1)
  await expect(page.locator('.reading-pane')).toBeVisible()
  await expect(page.locator('.file-tree')).toBeVisible()
  await expect(page.getByTestId('file-tree-exact-context')).toContainText(date)
  await expect(page.locator(`[data-tree-key="file:${path}"]`)).toHaveCount(1)
  await expect(page.getByTestId('diary-calendar')).toBeAttached()
  await expect(page.getByTestId('diary-calendar')).toBeHidden()
}

async function enterEditor(page: Page): Promise<void> {
  const toggle = page.getByTestId('view-toggle')
  const label = await toggle.getAttribute('aria-label')
  if (/edit|编辑/i.test(label ?? '')) await toggle.click()
  await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible()
  await expect(page.locator('.editor-pane .monaco-editor')).toHaveCount(1)
}

async function returnToCalendar(page: Page): Promise<void> {
  await page.getByTestId('file-tree-exact-context-action').click()
  await expect(page.getByTestId('diary-calendar')).toBeVisible()
  await expect(page.getByTestId('file-tree-exact-context')).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')
  await clearDraftDatabase(page)
  await gotoVaultReady(page)
})

test('Calendar → native Editor → Calendar preserves the backing tab, raw, dirty state, and identity', async ({ page, request }) => {
  const date = localCivilDate()
  const path = diaryPath(date)
  const baseRaw = `# D6.4 Native Editor ${RUN_ID} — Initial body ${RUN_ID}`
  const savedRaw = `# D6.4 Native Editor ${RUN_ID} — Saved body ${RUN_ID}`
  const dirtyMarker = `DIRTY_${RUN_ID}`
  const closeMarker = `CLOSE_${RUN_ID}`
  const state = diagnostics(page, ['net::ERR_FAILED'])
  let browserAutosaveInstalled = false

  try {
    const document = await seedDiary(request, date, baseRaw)
    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveCount(1)

    await enterEditor(page)
    await setEditorContent(page, savedRaw)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="saved"]`)).toBeVisible({ timeout: 15_000 })

    await interceptAutosaveAborted(page, path)
    browserAutosaveInstalled = true
    await appendEditorText(page, dirtyMarker)
    const dirtyRaw = `${savedRaw}\n${dirtyMarker}`
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => draftRowCount(page, dirtyMarker), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    const routeBeforeClose = new URL(page.url()).pathname
    await returnToCalendar(page)
    await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveCount(1)
    await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveAttribute('aria-selected', 'true')
    expect(new URL(page.url()).pathname).toBe(routeBeforeClose)
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)

    // Diary Home owns neither tab close nor tab cycling, even while the
    // backing native document remains mounted for reopen continuity.
    await page.locator('.vault').focus()
    await page.keyboard.press('ControlOrMeta+W')
    await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveCount(1)
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)

    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await expect(page.locator('.reading-pane article')).toContainText(dirtyMarker)
    const reopened = await (await request.get(`/api/posts/${path}`)).json()
    expect(reopened.metadata.id).toBe(document.documentId)
    expect(reopened.raw).toBe(savedRaw)

    await enterEditor(page)
    await page.unroute(`**/api/posts/${path}`)
    browserAutosaveInstalled = false
    await page.locator('.vault').focus()
    await page.keyboard.press('Control+s')
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="saved"]`)).toBeVisible({ timeout: 15_000 })
    const saved = await (await request.get(`/api/posts/${path}`)).json()
    expect(normalizeLineEndings(saved.raw)).toBe(dirtyRaw)
    expect(saved.metadata.id).toBe(document.documentId)
    await expect.poll(() => draftRowCount(page, dirtyMarker), { timeout: 15_000 }).toBe(0)

    // A real document close still uses the existing dirty confirmation. The
    // presentation-only Calendar close above did not invoke it.
    await interceptAutosaveAborted(page, path)
    browserAutosaveInstalled = true
    await appendEditorText(page, closeMarker)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await page.locator(`[data-tab-id="${path}"] .tab-close`).click()
    const confirmation = page.locator('.confirm-dialog')
    await expect(confirmation).toBeVisible()
    await confirmation.locator('.confirm-actions .btn').first().click()
    await expect(confirmation).toHaveCount(0)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible()
    await page.locator(`[data-tab-id="${path}"] .tab-close`).click()
    await expect(confirmation).toBeVisible()
    await confirmation.locator('.confirm-actions .btn').last().click()
    await expect(page.locator(`[data-tab-id="${path}"]`)).toHaveCount(0)
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
  } finally {
    if (browserAutosaveInstalled) await page.unroute(`**/api/posts/${path}`)
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('native Diary Editor yields to History Comparison without mutating the live document', async ({ page, request }) => {
  const date = localCivilDate()
  const path = diaryPath(date)
  const liveRaw = `# D6.4 History ${RUN_ID} — Live body ${RUN_ID}`
  const revisionRaw = `# D6.4 History ${RUN_ID} — Historical body ${RUN_ID}`
  const state = diagnostics(page)
  let putCount = 0

  try {
    const document = await seedDiary(request, date, liveRaw)
    await interceptHistory(page, {
      files: [`${path}.md`],
      raw: revisionRaw,
      sha: `d64history${RUN_ID}`,
      parents: [`d64parent${RUN_ID}`],
    })
    await page.reload()
    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)

    await page.route(`**/api/posts/${path}`, (route) => {
      if (route.request().method() === 'PUT') putCount += 1
      return route.continue()
    })
    await page.locator('button.ab-btn[aria-label="History"], button.ab-btn[aria-label="历史"]').first().click()
    const history = page.locator('.history-panel')
    await expect(history).toBeVisible()

    const day = history.locator('.history-timeline-group-header').first()
    await expect(day).toBeVisible({ timeout: 15_000 })
    if (await day.getAttribute('aria-expanded') !== 'true') await day.click()
    const commit = history.locator('.history-commit-row').first()
    await expect(commit).toBeVisible()
    if (await commit.getAttribute('aria-expanded') !== 'true') await commit.click()
    const file = history.locator('.history-file-row').first()
    await expect(file).toBeVisible()
    await file.click()

    await expect(page.locator('.history-comparison-pane')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('diary-calendar')).toBeAttached()
    await expect(page.getByTestId('diary-calendar')).toBeHidden()
    expect(putCount).toBe(0)
    await expect(page.locator(`[data-tab-id="${path}"]`)).toHaveCount(1)

    const diffTab = page.locator(`[data-tab-id="diff:${path}"]`)
    await expect(diffTab).toBeVisible()
    await diffTab.locator('.tab-close').click()
    await expect(page.locator('.history-comparison-pane')).toHaveCount(0)
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(page.locator('.reading-pane')).toHaveCount(0)

    await page.locator('button.ab-btn[aria-label^="Explorer"], button.ab-btn[aria-label^="文件资源管理器"]').first().click()
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    const reopened = await (await request.get(`/api/posts/${path}`)).json()
    expect(reopened.metadata.id).toBe(document.documentId)
    expect(reopened.raw).toBe(liveRaw)
  } finally {
    await page.unroute(`**/api/posts/${path}`)
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('baseline Recovery adopts the native Diary buffer and keeps the same identity', async ({ page, request }) => {
  const date = localCivilDate()
  const path = diaryPath(date)
  const baseRaw = `# D6.4 Recovery ${RUN_ID} — Baseline body ${RUN_ID}`
  const recoveredMarker = `RECOVERED_${RUN_ID}`
  const recoveredRaw = `${baseRaw} — ${recoveredMarker}`
  const state = diagnostics(page, ['net::ERR_FAILED'])
  let browserAutosaveInstalled = false

  try {
    const document = await seedDiary(request, date, baseRaw)
    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await enterEditor(page)
    await interceptAutosaveAborted(page, path)
    browserAutosaveInstalled = true
    await setEditorContent(page, recoveredRaw)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => draftRowCount(page, recoveredMarker), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    await page.reload()
    await expect(page.getByTestId('diary-calendar')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.draft-recovery-backdrop')).toHaveCount(0)
    await expect(page.locator('.editor-pane .monaco-editor .view-lines').first()).toContainText(recoveredMarker, { timeout: 15_000 })
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toHaveCount(1)

    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await expect(page.locator('.reading-pane article')).toContainText(recoveredMarker)
    const adopted = await (await request.get(`/api/posts/${path}`)).json()
    expect(adopted.metadata.id).toBe(document.documentId)
    expect(adopted.raw).toBe(baseRaw)

    await enterEditor(page)
    await page.unroute(`**/api/posts/${path}`)
    browserAutosaveInstalled = false
    await page.locator('.vault').focus()
    await page.keyboard.press('Control+s')
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="saved"]`)).toBeVisible({ timeout: 15_000 })
    const saved = await (await request.get(`/api/posts/${path}`)).json()
    expect(saved.raw).toBe(recoveredRaw)
    expect(saved.metadata.id).toBe(document.documentId)
    await expect.poll(() => draftRowCount(page, recoveredMarker), { timeout: 15_000 }).toBe(0)
  } finally {
    if (browserAutosaveInstalled) await page.unroute(`**/api/posts/${path}`)
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('external conflict stays on the native Diary tab through Calendar and resolves via the existing save owner', async ({ page, request }) => {
  const date = localCivilDate()
  const path = diaryPath(date)
  const baseRaw = `# D6.4 External ${RUN_ID} — Base body ${RUN_ID}`
  const localMarker = `LOCAL_${RUN_ID}`
  const localRaw = `${baseRaw}\n${localMarker}`
  const externalRaw = `# D6.4 External ${RUN_ID} — External body ${RUN_ID}`
  const state = diagnostics(page, ['status of 409 (Conflict)'])
  const autosave = { seen: false, statuses: [] as number[] }
  let releaseAutosave: () => void = () => {}
  let browserAutosaveInstalled = false

  try {
    const document = await seedDiary(request, date, baseRaw)
    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await enterEditor(page)

    const gate = new Promise<void>((resolve) => { releaseAutosave = resolve })
    await interceptAutosaveHeld(page, path, autosave, gate)
    browserAutosaveInstalled = true
    await appendEditorText(page, localMarker)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => autosave.seen, { timeout: 15_000 }).toBe(true)

    const externalWrite = await request.put(`/api/posts/${path}`, {
      data: { raw: externalRaw, baseRaw },
    })
    expect(externalWrite.status(), await externalWrite.text()).toBe(200)
    const external = await (await request.get(`/api/posts/${path}`)).json()
    expect(external.metadata.id).toBe(document.documentId)
    releaseAutosave()
    await expect.poll(() => autosave.statuses.length, { timeout: 15_000 }).toBe(1)
    expect(autosave.statuses[0]).toBe(409)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="external"]`)).toBeVisible({ timeout: 15_000 })

    await returnToCalendar(page)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="external"]`)).toHaveCount(1)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await expect(page.locator('.reading-pane article')).toContainText(localMarker)

    await enterEditor(page)
    const keepLocal = page.locator('button[aria-label="Keep local version and overwrite disk"]')
    await expect(keepLocal).toBeVisible({ timeout: 15_000 })
    await keepLocal.click()
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="saved"]`)).toBeVisible({ timeout: 15_000 })
    const resolved = await (await request.get(`/api/posts/${path}`)).json()
    expect(normalizeLineEndings(resolved.raw)).toBe(localRaw)
    expect(resolved.metadata.id).toBe(document.documentId)
  } finally {
    if (browserAutosaveInstalled) await page.unroute(`**/api/posts/${path}`)
    await deleteDiaryDate(request, date)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})
