import { test as authTest, expect, type APIRequestContext } from './auth'
import type { BrowserContext, Page } from '@playwright/test'

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>
type PlaywrightApi = typeof import('playwright-core')

const DEFAULT_BASE_URL = 'http://127.0.0.1:4174'
const DIARY_PASSWORD = 'e2e-diary-access-password-strong-123'
export const DIARY_ACCESS_CAPABILITY_HEADER = 'X-Docus-Diary-Capability'

function resolvedBaseURL(baseURL: string | undefined): string {
  return baseURL ?? process.env.DOCUS_PUBLIC_ORIGIN ?? DEFAULT_BASE_URL
}

function originHeaders(baseURL: string): Record<string, string> {
  return { Origin: baseURL }
}

async function readAccessState(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<{
  state: 'UNINITIALIZED' | 'LOCKED' | 'UNLOCKED'
}> {
  expect(response.status(), await response.text()).toBe(200)
  return await response.json() as {
    state: 'UNINITIALIZED' | 'LOCKED' | 'UNLOCKED'
  }
}

async function ensureDiaryConfiguration(
  playwright: PlaywrightApi,
  baseURL: string,
  storageState: StorageState,
): Promise<void> {
  const api = await playwright.request.newContext({
    baseURL,
    storageState,
    extraHTTPHeaders: originHeaders(baseURL),
  })
  try {
    const status = await api.get('/api/diary/access/status')
    const access = await readAccessState(status)
    if (access.state !== 'UNINITIALIZED') return

    const setup = await api.post('/api/diary/access/setup', {
      data: { password: DIARY_PASSWORD },
    })
    expect([201, 409], await setup.text()).toContain(setup.status())
  } finally {
    await api.dispose()
  }
}

async function loginForDiaryApi(
  playwright: PlaywrightApi,
  baseURL: string,
): Promise<{ auth: APIRequestContext; api: APIRequestContext }> {
  const auth = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: originHeaders(baseURL),
  })
  try {
    const login = await auth.post('/api/auth/login', {
      data: {
        username: 'e2e-owner',
        password: 'e2e-owner-password-strong-123',
      },
    })
    expect(login.status(), await login.text()).toBe(200)

    const accessStatus = await auth.get('/api/diary/access/status')
    const access = await readAccessState(accessStatus)
    const accessPath = access.state === 'UNINITIALIZED'
      ? '/api/diary/access/setup'
      : '/api/diary/access/unlock'
    const unlock = await auth.post(accessPath, {
      data: { password: DIARY_PASSWORD },
    })
    expect([200, 201], await unlock.text()).toContain(unlock.status())
    const unlocked = await unlock.json() as { capability?: unknown }
    expect(unlocked.capability).toEqual(expect.any(String))

    const api = await playwright.request.newContext({
      baseURL,
      storageState: await auth.storageState(),
      extraHTTPHeaders: {
        ...originHeaders(baseURL),
        [DIARY_ACCESS_CAPABILITY_HEADER]: unlocked.capability as string,
      },
    })
    return { auth, api }
  } catch (error) {
    await auth.dispose()
    throw error
  }
}

async function currentDiaryScope(page: Page): Promise<boolean> {
  const diaryChip = page.locator('.scope-chip').filter({ hasText: 'diary' })
  if (await diaryChip.count() === 0) return false
  return (await diaryChip.getAttribute('aria-pressed')) === 'true'
}

async function submitDiaryAccess(page: Page): Promise<void> {
  const password = page.locator('#diary-access-password')
  await password.fill(DIARY_PASSWORD)
  const confirm = page.locator('#diary-access-confirm')
  if (await confirm.isVisible().catch(() => false)) await confirm.fill(DIARY_PASSWORD)
  // Draft Recovery may be mounted above the access dialog during a
  // reload. Submit through the focused form control so the supported
  // keyboard flow is not blocked by the other modal's pointer layer.
  await page.locator('.diary-access-dialog button[type="submit"]').press('Enter')
  await expect(page.locator('.diary-access-dialog')).toHaveCount(0, { timeout: 15_000 })
}

async function activateScopeChip(page: Page, chip: ReturnType<Page['locator']>): Promise<void> {
  // A stale recovery prompt can cover the chip while App is still resolving
  // the fresh process-local access session. Keyboard activation exercises the
  // same button handler without pretending that the overlay is dismissible.
  if (await page.locator('.draft-recovery-backdrop').isVisible().catch(() => false)) {
    await chip.focus()
    await chip.press('Enter')
    return
  }
  await chip.click()
}

function waitForDiaryAccessStatus(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/diary/access/status',
    { timeout: 15_000 },
  ).catch(() => null)
}

async function bootstrapDiaryPage(page: Page, keepDiaryScope: boolean): Promise<void> {
  const pathname = new URL(page.url()).pathname
  if (!pathname.startsWith('/vault')) return

  const diaryChip = page.locator('.scope-chip').filter({ hasText: 'diary' })
  const noteChip = page.locator('.scope-chip').filter({ hasText: 'note' })
  await expect(diaryChip).toBeVisible({ timeout: 15_000 })

  const password = page.locator('#diary-access-password')

  // A reload can restore the generic recovery surface at the same time as
  // the persisted Diary scope asks App.vue to request access. Resolve an
  // already-open access dialog first; clicking a scope chip while the
  // recovery backdrop is present would only retry a blocked click and hide
  // the real unlock path behind a timeout.
  if (await password.isVisible().catch(() => false)) {
    await submitDiaryAccess(page)
  }

  // A full page navigation starts a new browser JS process, so a persisted
  // Diary scope must not be mistaken for a live capability. Force the real
  // scope transition to invoke App.vue's normal access dialog.
  if (await diaryChip.getAttribute('aria-pressed') === 'true' && !keepDiaryScope) {
    await activateScopeChip(page, noteChip)
    await expect(noteChip).toHaveAttribute('aria-pressed', 'true')
  }
  if (await diaryChip.getAttribute('aria-pressed') !== 'true') {
    await activateScopeChip(page, diaryChip)
  }

  await expect.poll(async () => (
    await diaryChip.getAttribute('aria-pressed') === 'true'
      || await password.isVisible().catch(() => false)
  ), { timeout: 15_000 }).toBe(true)
  if (await password.isVisible().catch(() => false)) {
    await submitDiaryAccess(page)
  }

  await expect(diaryChip).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  if (!keepDiaryScope) {
    await activateScopeChip(page, noteChip)
    await expect(noteChip).toHaveAttribute('aria-pressed', 'true')
  }
}

async function logoutBrowserContext(
  playwright: PlaywrightApi,
  baseURL: string,
  context: BrowserContext,
): Promise<void> {
  let state: StorageState
  try {
    state = await context.storageState()
  } catch {
    return
  }
  const api = await playwright.request.newContext({
    baseURL,
    storageState: state,
    extraHTTPHeaders: originHeaders(baseURL),
  })
  try {
    await api.post('/api/auth/logout')
  } finally {
    await api.dispose()
  }
}

export const test = authTest.extend<{}, { diaryConfigReady: void }>({
  diaryConfigReady: [async ({ playwright, authStorageState }, use) => {
    const origin = resolvedBaseURL(undefined)
    await ensureDiaryConfiguration(playwright, origin, authStorageState)
    await use()
  }, { scope: 'worker' }],

  // Diary browser tests receive a fresh authenticated session per test. A
  // test that logs out or locks cannot revoke the worker session reused by a
  // later test, while storageState still contains only the auth cookie.
  storageState: async ({ playwright, baseURL, diaryConfigReady }, use) => {
    void diaryConfigReady
    const origin = resolvedBaseURL(baseURL)
    const auth = await playwright.request.newContext({
      baseURL: origin,
      extraHTTPHeaders: originHeaders(origin),
    })
    try {
      const login = await auth.post('/api/auth/login', {
        data: {
          username: 'e2e-owner',
          password: 'e2e-owner-password-strong-123',
        },
      })
      expect(login.status(), await login.text()).toBe(200)
      await use(await auth.storageState())
    } finally {
      await auth.dispose()
    }
  },

  // API setup/cleanup uses a different fresh session from the browser page.
  // The capability is held only in this fixture's in-memory request header;
  // it is never put into storageState, browser storage, URLs, or logs.
  request: async ({ playwright, baseURL, diaryConfigReady }, use) => {
    void diaryConfigReady
    const origin = resolvedBaseURL(baseURL)
    const { auth, api } = await loginForDiaryApi(playwright, origin)
    try {
      await use(api)
    } finally {
      await api.dispose()
      await auth.post('/api/auth/logout').catch(() => undefined)
      await auth.dispose()
    }
  },

  // The Diary capability belongs to the page's current JS process. Re-run
  // the supported UI setup/unlock flow after full navigations that replace
  // that process, while preserving the scope the test was already using.
  page: async ({ page, playwright, baseURL, diaryConfigReady }, use) => {
    void diaryConfigReady
    const origin = resolvedBaseURL(baseURL)
    const originalGoto = page.goto.bind(page)
    const originalReload = page.reload.bind(page)
    const originalGoBack = page.goBack.bind(page)
    const originalGoForward = page.goForward.bind(page)

    page.goto = async (url, options) => {
      const keepDiaryScope = await currentDiaryScope(page)
      let targetPath: string
      try {
        targetPath = new URL(url, page.url()).pathname
      } catch {
        targetPath = new URL(url, origin).pathname
      }
      const accessStatus = keepDiaryScope || targetPath.startsWith('/vault/diary/')
        ? waitForDiaryAccessStatus(page)
        : null
      const response = await originalGoto(url, options)
      if (accessStatus) await accessStatus
      await bootstrapDiaryPage(page, keepDiaryScope || targetPath.startsWith('/vault/diary/'))
      return response
    }
    page.reload = async (options) => {
      const keepDiaryScope = await currentDiaryScope(page)
      const accessStatus = keepDiaryScope ? waitForDiaryAccessStatus(page) : null
      const response = await originalReload(options)
      if (accessStatus) await accessStatus
      await bootstrapDiaryPage(page, keepDiaryScope)
      return response
    }
    page.goBack = async (options) => {
      const keepDiaryScope = await currentDiaryScope(page)
      const response = await originalGoBack(options)
      await bootstrapDiaryPage(page, keepDiaryScope)
      return response
    }
    page.goForward = async (options) => {
      const keepDiaryScope = await currentDiaryScope(page)
      const response = await originalGoForward(options)
      await bootstrapDiaryPage(page, keepDiaryScope)
      return response
    }

    try {
      await use(page)
    } finally {
      await logoutBrowserContext(playwright, origin, page.context())
    }
  },
})

export { expect }
export type { APIRequestContext }
