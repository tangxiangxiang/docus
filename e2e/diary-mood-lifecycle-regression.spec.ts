import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import nodePath from 'node:path'
import { expect, test, type APIRequestContext, type Page } from './fixtures/auth'
import {
  appendEditorText,
  clearDraftDatabase,
  draftRowCount,
  gotoVaultReady,
  interceptAutosaveAborted,
  reloadApp,
} from './helpers/edit-program'

const TEST_TIME_ZONE = 'Asia/Shanghai'
const RUN_ID = String(Date.now())
const E2E_VAULT = process.env.DOCUS_DRAFT_E2E_VAULT ?? nodePath.join('src', 'content')

test.use({
  timezoneId: TEST_TIME_ZONE,
})

type DiaryMetadata = {
  id: string
  mood: string | null
  updatedAt: number
}

type DiaryPost = {
  path: string
  raw: string
  metadata: DiaryMetadata
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

function civilParts(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function daysInMonth(year: number, month: number): number {
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
  if (month === 2) return leap ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function shiftCivilDate(value: string, amount: -1 | 1): string {
  let { year, month, day } = civilParts(value)
  day += amount
  if (day > daysInMonth(year, month)) {
    day = 1
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  } else if (day === 0) {
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

function normalizeLineEndings(raw: string): string {
  return raw.replace(/\r\n?/g, '\n')
}

async function readPost(request: APIRequestContext, path: string): Promise<DiaryPost> {
  const response = await request.get(`/api/posts/${path}`)
  const body = await response.text()
  expect(response.status(), body).toBe(200)
  return JSON.parse(body) as DiaryPost
}

async function readDiary(request: APIRequestContext, date: string): Promise<DiaryPost> {
  return readPost(request, diaryPath(date))
}

async function deletePost(request: APIRequestContext, path: string): Promise<void> {
  const response = await request.delete(`/api/posts/${path}`)
  expect([200, 404]).toContain(response.status())
}

async function findUnusedDiaryDate(
  request: APIRequestContext,
  excluded: readonly string[] = [],
): Promise<string> {
  const excludedSet = new Set(excluded)
  let candidate = localCivilDate()
  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (!excludedSet.has(candidate)) {
      const response = await request.get(`/api/posts/${diaryPath(candidate)}`)
      if (response.status() === 404) return candidate
      const body = await response.text()
      expect(response.status(), body).toBe(200)
    }
    candidate = shiftCivilDate(candidate, -1)
  }
  throw new Error('unable to find an unused Diary date for D7.4 E2E')
}

async function seedDiary(
  request: APIRequestContext,
  date: string,
  raw: string,
): Promise<{ documentId: string; raw: string }> {
  const path = diaryPath(date)
  const existing = await request.get(`/api/posts/${path}`)
  if (existing.status() !== 404) {
    const body = await existing.text()
    throw new Error(`D7.4 test date was not unused: ${path} (${existing.status()}): ${body}`)
  }

  const created = await request.post('/api/diary/dates', {
    data: { date, timeZone: TEST_TIME_ZONE },
  })
  expect(created.status(), await created.text()).toBe(201)

  const initial = await readDiary(request, date)
  const saved = await request.put(`/api/posts/${path}`, {
    data: { raw, baseRaw: initial.raw },
  })
  expect(saved.status(), await saved.text()).toBe(200)

  const detail = await readDiary(request, date)
  return {
    documentId: detail.metadata.id,
    raw: detail.raw,
  }
}

async function setDiaryMood(
  request: APIRequestContext,
  date: string,
  mood: string | null,
  expectedUpdatedAt?: number,
): Promise<DiaryPost['metadata']> {
  const current = await readDiary(request, date)
  const response = await request.patch(`/api/metadata/documents/${diaryPath(date)}`, {
    data: {
      mood,
      expectedUpdatedAt: expectedUpdatedAt ?? current.metadata.updatedAt,
    },
  })
  const body = await response.text()
  expect(response.status(), body).toBe(200)
  return JSON.parse(body) as DiaryPost['metadata']
}

async function commitDiaryRevision(
  request: APIRequestContext,
  date: string,
  raw: string,
  subject: string,
): Promise<string> {
  const historyPath = `${diaryPath(date)}.md`
  const response = await request.post('/api/history/commits', {
    data: {
      paths: [historyPath],
      message: subject,
      expected: {
        [historyPath]: createHash('sha256').update(raw).digest('hex'),
      },
    },
  })
  const body = await response.text()
  expect(response.status(), body).toBe(201)
  const result = JSON.parse(body) as { sha?: unknown }
  expect(result.sha).toEqual(expect.stringMatching(/^[0-9a-f]{40}$/))
  return result.sha as string
}

function diagnostics(page: Page, ignoredConsoleFragments: string[] = []): {
  pageErrors: string[]
  consoleErrors: string[]
} {
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

async function openDiaryHome(page: Page): Promise<void> {
  await page.goto('/vault')
  const diaryChip = page.locator('.scope-chip').filter({ hasText: 'diary' })
  if (await diaryChip.getAttribute('aria-pressed') !== 'true') await diaryChip.click()
  await expect(page.getByTestId('diary-calendar-surface')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('diary-calendar')).toBeVisible()
}

async function ensureExplorerVisible(page: Page): Promise<void> {
  const fileTree = page.locator('.file-tree')
  if (!(await fileTree.isVisible())) {
    const explorer = page.locator('button.ab-btn[aria-label^="Explorer"], button.ab-btn[aria-label^="文件资源管理器"]').first()
    await expect(explorer).toBeVisible()
    if (await explorer.getAttribute('aria-pressed') !== 'true') await explorer.click()
  }
  await expect(fileTree).toBeVisible({ timeout: 15_000 })
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

async function assertNativeReader(page: Page, date: string): Promise<void> {
  const path = diaryPath(date)
  await expect(page).toHaveURL(new RegExp(`/vault/${path.replace('/', '\\/')}(?:[?#]|$)`))
  await expect(page.getByTestId('diary-reader-dialog')).toHaveCount(0)
  await expect(page.locator(`[role="tab"][data-tab-id="${path}"]`)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.reading-pane')).toHaveCount(1)
  await expect(page.locator('.reading-pane')).toBeVisible()
  await ensureExplorerVisible(page)
  await expect(page.locator('.search-input')).toHaveValue(date)
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

test.beforeEach(async ({ page }) => {
  await page.goto('/__markdown-test?mode=reading')
  await clearDraftDatabase(page)
  await gotoVaultReady(page)
})

test('Mood set/change/clear stays separate from a dirty native Diary body', async ({ page, request }) => {
  const date = await findUnusedDiaryDate(request)
  const path = diaryPath(date)
  const baseRaw = `# D7.4 metadata/body separation ${RUN_ID}\n`
  const dirtyMarker = `D74_DIRTY_${RUN_ID}`
  const dirtyRaw = `${baseRaw}\n${dirtyMarker}`
  const state = diagnostics(page, ['net::ERR_FAILED'])
  let autosaveInstalled = false

  try {
    const document = await seedDiary(request, date, baseRaw)
    const first = await setDiaryMood(request, date, 'happy')
    const second = await setDiaryMood(request, date, 'sad', first.updatedAt)
    expect(second.id).toBe(document.documentId)
    const cleared = await setDiaryMood(request, date, null, second.updatedAt)
    expect(cleared.id).toBe(document.documentId)
    expect((await readDiary(request, date)).metadata.mood).toBeNull()

    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await enterEditor(page)
    await interceptAutosaveAborted(page, path)
    autosaveInstalled = true
    await appendEditorText(page, dirtyMarker)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => draftRowCount(page, dirtyMarker), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    const dirtySet = await setDiaryMood(request, date, 'happy')
    const dirtyChanged = await setDiaryMood(request, date, 'angry', dirtySet.updatedAt)
    const dirtyCleared = await setDiaryMood(request, date, null, dirtyChanged.updatedAt)
    expect(dirtyCleared.id).toBe(document.documentId)

    const whileDirty = await readDiary(request, date)
    expect(normalizeLineEndings(whileDirty.raw)).toBe(normalizeLineEndings(baseRaw))
    expect(whileDirty.metadata.mood).toBeNull()
    expect(whileDirty.metadata.id).toBe(document.documentId)
    await expect(page).toHaveURL(new RegExp(`/vault/${path.replace('/', '\\/')}(?:[?#]|$)`))
    const dirtyTab = page.locator(`[data-tab-id="${path}"]`)
    await expect(dirtyTab).toHaveCount(1)
    await expect(dirtyTab.locator('.tab-dirty-indicator')).toHaveCount(1)
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)

    await page.unroute(`**/api/posts/${path}`)
    autosaveInstalled = false
    await page.locator('.vault').focus()
    await page.keyboard.press('Control+s')
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="saved"]`)).toBeVisible({ timeout: 15_000 })
    const saved = await readDiary(request, date)
    expect(normalizeLineEndings(saved.raw)).toBe(normalizeLineEndings(dirtyRaw))
    expect(saved.metadata.mood).toBeNull()
    expect(saved.metadata.id).toBe(document.documentId)
    await expect.poll(() => draftRowCount(page, dirtyMarker), { timeout: 15_000 }).toBe(0)
  } finally {
    if (autosaveInstalled) await page.unroute(`**/api/posts/${path}`)
    await deletePost(request, path)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('external metadata conflict keeps the Calendar winner and allows a fresh retry', async ({ page, request }) => {
  const date = await findUnusedDiaryDate(request)
  const path = diaryPath(date)
  const baseRaw = `# D7.4 clean metadata conflict ${RUN_ID}\n`
  const state = diagnostics(page)

  try {
    const document = await seedDiary(request, date, baseRaw)
    const localMood = await setDiaryMood(request, date, 'happy')

    await openDiaryHome(page)
    await moveToMonth(page, date)
    const moodButton = page.locator(`[data-testid="diary-calendar-mood"][data-date="${date}"]`)
    await expect(moodButton).toBeVisible()
    await expect(moodButton.locator('img')).toHaveAttribute('src', '/emoji/开心.svg')

    // Keep the browser's Calendar projection at the old version while an
    // external writer wins the authoritative metadata CAS.
    const external = await setDiaryMood(request, date, 'sad', localMood.updatedAt)
    expect(external.id).toBe(document.documentId)
    expect(external.updatedAt).toBeGreaterThan(localMood.updatedAt)

    await moodButton.click()
    const picker = page.getByTestId('diary-mood-picker')
    await expect(picker).toBeVisible()
    const staleResponse = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === `/api/metadata/documents/${path}`
    ))
    await picker.getByRole('radio', { name: '愤怒 / Angry' }).click()
    expect((await staleResponse).status()).toBe(409)

    await expect.poll(async () => (await readDiary(request, date)).metadata.mood).toBe('sad')
    const winner = await readDiary(request, date)
    expect(winner.raw).toBe(baseRaw)
    expect(winner.metadata.id).toBe(document.documentId)
    expect(winner.metadata.mood).toBe('sad')
    expect(winner.metadata.updatedAt).toBe(external.updatedAt)
    await expect(moodButton.locator('img')).toHaveAttribute('src', '/emoji/伤心.svg')
    await expect(page).toHaveURL(/\/vault(?:[?#]|$)/)
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(page.locator('[role="tab"][data-tab-id^="diary/"]')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await moodButton.click()
    await page.getByTestId('diary-mood-picker').getByRole('radio', { name: '愤怒 / Angry' }).click()
    await expect.poll(async () => (await readDiary(request, date)).metadata.mood).toBe('angry')
    await expect(moodButton.locator('img')).toHaveAttribute('src', '/emoji/愤怒.svg')
    await expect(page).toHaveURL(/\/vault(?:[?#]|$)/)
    await expect(page.locator('[role="tab"][data-tab-id^="diary/"]')).toHaveCount(0)
  } finally {
    await deletePost(request, path)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([
    'Failed to load resource: the server responded with a status of 409 (Conflict)',
  ])
})

test('external metadata conflict leaves a dirty native body untouched', async ({ page, request }) => {
  const date = await findUnusedDiaryDate(request)
  const path = diaryPath(date)
  const baseRaw = `# D7.4 dirty metadata conflict ${RUN_ID}\n`
  const dirtyMarker = `D74_METADATA_CONFLICT_DIRTY_${RUN_ID}`
  const dirtyRaw = `${baseRaw}\n${dirtyMarker}`
  const state = diagnostics(page, ['net::ERR_FAILED'])
  let autosaveInstalled = false

  try {
    const document = await seedDiary(request, date, baseRaw)
    await setDiaryMood(request, date, 'happy')

    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await enterEditor(page)
    await interceptAutosaveAborted(page, path)
    autosaveInstalled = true
    await appendEditorText(page, dirtyMarker)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => draftRowCount(page, dirtyMarker), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    const stale = await readDiary(request, date)
    expect(stale.metadata.mood).toBe('happy')
    const external = await setDiaryMood(request, date, 'sad', stale.metadata.updatedAt)
    expect(external.id).toBe(document.documentId)

    // Native Mood UI is intentionally not reintroduced for this phase. The
    // API request below is the external/stale CAS boundary while the native
    // editor keeps the unsaved body buffer mounted and dirty.
    const conflict = await request.patch(`/api/metadata/documents/${path}`, {
      data: { mood: 'angry', expectedUpdatedAt: stale.metadata.updatedAt },
    })
    expect(conflict.status(), await conflict.text()).toBe(409)

    const whileDirty = await readDiary(request, date)
    expect(normalizeLineEndings(whileDirty.raw)).toBe(normalizeLineEndings(baseRaw))
    expect(whileDirty.metadata.id).toBe(document.documentId)
    expect(whileDirty.metadata.mood).toBe('sad')
    const dirtyTab = page.locator(`[data-tab-id="${path}"]`)
    await expect(dirtyTab).toHaveCount(1)
    await expect(dirtyTab.locator('.tab-dirty-indicator')).toHaveCount(1)
    await expect(page.locator('.editor-pane .monaco-editor .view-lines').first()).toContainText(dirtyMarker)
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/vault/${path.replace('/', '\\/')}(?:[?#]|$)`))
    await expect(page.getByTestId('diary-calendar')).toBeHidden()

    const retry = await setDiaryMood(request, date, 'angry', external.updatedAt)
    expect(retry.id).toBe(document.documentId)
    expect(retry.updatedAt).toBeGreaterThan(external.updatedAt)
    const afterRetry = await readDiary(request, date)
    expect(afterRetry.metadata.mood).toBe('angry')
    expect(afterRetry.raw).toBe(baseRaw)
    await expect(dirtyTab.locator('.tab-dirty-indicator')).toHaveCount(1)

    await page.unroute(`**/api/posts/${path}`)
    autosaveInstalled = false
    await page.locator('.vault').focus()
    await page.keyboard.press('Control+s')
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="saved"]`)).toBeVisible({ timeout: 15_000 })

    const saved = await readDiary(request, date)
    expect(normalizeLineEndings(saved.raw)).toBe(normalizeLineEndings(dirtyRaw))
    expect(saved.metadata.id).toBe(document.documentId)
    expect(saved.metadata.mood).toBe('angry')
    await expect.poll(() => draftRowCount(page, dirtyMarker), { timeout: 15_000 }).toBe(0)
  } finally {
    if (autosaveInstalled) await page.unroute(`**/api/posts/${path}`)
    await deletePost(request, path)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('v2 History Restore restores matching Mood and keeps the native tab identity', async ({ page, request }) => {
  const date = await findUnusedDiaryDate(request)
  const path = diaryPath(date)
  const historicalRaw = `# D7.4 history A ${RUN_ID}\nHistorical body ${RUN_ID}\n`
  const currentRaw = `# D7.4 history B ${RUN_ID}\nCurrent body ${RUN_ID}\n`
  const subject = `D7.4 Mood history ${RUN_ID}`
  const state = diagnostics(page)

  try {
    const document = await seedDiary(request, date, historicalRaw)
    await setDiaryMood(request, date, 'happy')
    const revisionId = await commitDiaryRevision(request, date, historicalRaw, subject)

    const changed = await request.put(`/api/posts/${path}`, {
      data: { raw: currentRaw, baseRaw: historicalRaw },
    })
    expect(changed.status(), await changed.text()).toBe(200)
    const changedMood = await setDiaryMood(request, date, 'sad')
    const current = await readDiary(request, date)
    expect(current.metadata.id).toBe(document.documentId)
    expect(current.metadata.mood).toBe('sad')

    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await page.locator('button.ab-btn[aria-label="History"], button.ab-btn[aria-label="历史"]').first().click()
    const history = page.locator('.history-panel')
    await expect(history).toBeVisible()
    const day = history.locator('.history-timeline-group-header').first()
    await expect(day).toBeVisible({ timeout: 15_000 })
    if (await day.getAttribute('aria-expanded') !== 'true') await day.click()
    const commit = history.locator('.history-commit-row').filter({ hasText: subject })
    await expect(commit).toBeVisible({ timeout: 15_000 })
    if (await commit.getAttribute('aria-expanded') !== 'true') await commit.click()
    const file = history.locator('.history-file-row').filter({ hasText: date }).first()
    await expect(file).toBeVisible({ timeout: 15_000 })
    await file.click()

    const comparison = page.locator('.history-comparison-pane')
    await expect(comparison).toBeVisible({ timeout: 15_000 })
    await expect(comparison).toContainText('Historical body')
    await comparison.getByRole('button', { name: 'More actions' }).click()
    const restoreAction = page.getByRole('menuitem', { name: /Restore to this version/ })
    await expect(restoreAction).toBeVisible()
    await restoreAction.click()
    const confirmation = page.locator('.confirm-dialog')
    await expect(confirmation).toBeVisible()
    await confirmation.locator('.confirm-actions .btn-danger').click()

    await expect.poll(async () => (await readDiary(request, date)).raw).toBe(historicalRaw)
    const restored = await readDiary(request, date)
    expect(restored.metadata.id).toBe(document.documentId)
    expect(restored.metadata.mood).toBe('happy')
    expect(restored.metadata.updatedAt).toBeGreaterThan(current.metadata.updatedAt)
    expect(changedMood.id).toBe(document.documentId)
    expect(revisionId).toMatch(/^[0-9a-f]{40}$/)

    const diffTab = page.locator(`[data-tab-id="diff:${path}"]`)
    await expect(diffTab).toHaveCount(1)
    await diffTab.locator('.tab-close').click()
    const diaryTab = page.locator(`[role="tab"][data-tab-id="${path}"]`)
    await expect(diaryTab).toHaveCount(1)
    await diaryTab.locator('.tab-close').click()
    await expect(page.getByTestId('diary-calendar')).toBeVisible()
    await expect(page.locator(`[data-testid="diary-calendar-mood"][data-date="${date}"] img`)).toHaveAttribute('src', '/emoji/开心.svg')
  } finally {
    await deletePost(request, path)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('baseline Recovery adopts body draft while preserving current Mood and identity', async ({ page, request }) => {
  const date = await findUnusedDiaryDate(request)
  const path = diaryPath(date)
  const baseRaw = `# D7.4 baseline recovery ${RUN_ID}\n`
  const recoveredMarker = `D74_RECOVERED_${RUN_ID}`
  const recoveredRaw = `${baseRaw}\n${recoveredMarker}`
  const state = diagnostics(page, ['net::ERR_FAILED'])
  let autosaveInstalled = false

  try {
    const document = await seedDiary(request, date, baseRaw)
    await setDiaryMood(request, date, 'happy')
    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await enterEditor(page)
    await interceptAutosaveAborted(page, path)
    autosaveInstalled = true
    await appendEditorText(page, recoveredMarker)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => draftRowCount(page, recoveredMarker), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    await page.reload()
    await expect(page.getByTestId('diary-calendar')).toBeHidden({ timeout: 15_000 })
    await expect(page.locator('.draft-recovery-backdrop')).toHaveCount(0)
    await expect(page.locator('.editor-pane .monaco-editor .view-lines').first()).toContainText(recoveredMarker, { timeout: 15_000 })
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toHaveCount(1)

    const adopted = await readDiary(request, date)
    expect(adopted.metadata.id).toBe(document.documentId)
    expect(adopted.metadata.mood).toBe('happy')
    expect(normalizeLineEndings(adopted.raw)).toBe(normalizeLineEndings(baseRaw))

    await page.unroute(`**/api/posts/${path}`)
    autosaveInstalled = false
    await page.locator('.vault').focus()
    await page.keyboard.press('Control+s')
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="saved"]`)).toBeVisible({ timeout: 15_000 })
    const saved = await readDiary(request, date)
    expect(normalizeLineEndings(saved.raw)).toBe(normalizeLineEndings(recoveredRaw))
    expect(saved.metadata.id).toBe(document.documentId)
    expect(saved.metadata.mood).toBe('happy')
  } finally {
    if (autosaveInstalled) await page.unroute(`**/api/posts/${path}`)
    await deletePost(request, path)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('divergent Recovery keeps the externally current Mood while resolving the body through native Recovery', async ({ page, request }) => {
  const date = await findUnusedDiaryDate(request)
  const path = diaryPath(date)
  const baseRaw = `# D7.4 divergent recovery ${RUN_ID}\n`
  const draftMarker = `D74_DRAFT_${RUN_ID}`
  const diskMarker = `D74_DISK_${RUN_ID}`
  const diskRaw = `${baseRaw}\n${diskMarker}\n`
  const state = diagnostics(page, ['net::ERR_FAILED'])
  let autosaveInstalled = false

  try {
    const document = await seedDiary(request, date, baseRaw)
    await setDiaryMood(request, date, 'happy')
    await openDiaryHome(page)
    await clickDiaryDate(page, date)
    await assertNativeReader(page, date)
    await enterEditor(page)
    await interceptAutosaveAborted(page, path)
    autosaveInstalled = true
    await appendEditorText(page, draftMarker)
    await expect(page.locator(`[data-tab-id="${path}"][data-save-status="dirty"]`)).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => draftRowCount(page, draftMarker), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    await fs.appendFile(nodePath.join(E2E_VAULT, `${path}.md`), `\n${diskMarker}\n`, 'utf8')
    const current = await readDiary(request, date)
    await setDiaryMood(request, date, 'sad', current.metadata.updatedAt)
    await page.reload()

    const dialog = page.locator('.draft-recovery-dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText('The draft and disk version may both have changed.')
    await dialog.getByRole('button', { name: 'View Diff' }).click()
    const pane = page.locator('.draft-recovery-pane')
    await expect(pane).toBeVisible({ timeout: 15_000 })
    await expect(pane).toContainText(draftMarker)
    await expect(pane).toContainText(diskMarker)
    await expect(page.getByTestId('diary-calendar')).toBeHidden()
    await pane.getByRole('button', { name: 'Open Recovered Content' }).click()
    await expect(pane).toContainText(draftMarker)
    await pane.getByRole('button', { name: 'Use Disk Version' }).click()
    await expect(pane).toHaveCount(0)
    await expect.poll(() => draftRowCount(page, draftMarker), { timeout: 15_000 }).toBe(0)

    const resolved = await readDiary(request, date)
    expect(resolved.metadata.id).toBe(document.documentId)
    expect(resolved.metadata.mood).toBe('sad')
    expect(normalizeLineEndings(resolved.raw)).toBe(normalizeLineEndings(diskRaw))

    await page.unroute(`**/api/posts/${path}`)
    autosaveInstalled = false
    await reloadApp(page)
    await expect(page.getByTestId('diary-calendar')).toBeHidden()
    await expect(page.locator(`[data-tab-id="${path}"]`)).toHaveCount(1)
    const reopened = await readDiary(request, date)
    expect(reopened.metadata.id).toBe(document.documentId)
    expect(reopened.metadata.mood).toBe('sad')
    expect(normalizeLineEndings(reopened.raw)).toBe(normalizeLineEndings(diskRaw))
  } finally {
    if (autosaveInstalled) await page.unroute(`**/api/posts/${path}`)
    await deletePost(request, path)
  }

  expect(state.pageErrors).toEqual([])
  expect(state.consoleErrors).toEqual([])
})

test('Mood CAS rejects stale metadata and delete/recreate creates a fresh Diary generation', async ({ request }) => {
  const date = await findUnusedDiaryDate(request)
  const path = diaryPath(date)

  try {
    const original = await seedDiary(request, date, `# D7.4 CAS ${RUN_ID}\n`)
    const happy = await setDiaryMood(request, date, 'happy')
    const changed = await setDiaryMood(request, date, 'sad', happy.updatedAt)
    const stale = await request.patch(`/api/metadata/documents/${path}`, {
      data: { mood: null, expectedUpdatedAt: happy.updatedAt },
    })
    const staleBody = await stale.text()
    expect(stale.status(), staleBody).toBe(409)

    const current = await readDiary(request, date)
    expect(current.raw).toBe(original.raw)
    expect(current.metadata.id).toBe(original.documentId)
    expect(current.metadata.mood).toBe('sad')
    expect(changed.id).toBe(original.documentId)

    await deletePost(request, path)
    const recreated = await request.post('/api/diary/dates', {
      data: { date, timeZone: TEST_TIME_ZONE },
    })
    expect(recreated.status(), await recreated.text()).toBe(201)
    const newGeneration = await readDiary(request, date)
    expect(newGeneration.metadata.id).not.toBe(original.documentId)
    expect(newGeneration.metadata.mood).toBeNull()

    const finalMood = await setDiaryMood(request, date, 'angry')
    expect(finalMood.id).toBe(newGeneration.metadata.id)
    expect((await readDiary(request, date)).metadata.mood).toBe('angry')
  } finally {
    await deletePost(request, path)
  }
})
