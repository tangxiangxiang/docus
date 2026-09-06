// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type {
  LedgerAccountDto,
  LedgerCategoryDto,
  LedgerOverviewDto,
  LedgerOverviewScope,
  LedgerSettingsDto,
} from '../../../shared/ledgerProtocol'
import { LedgerApiError } from '../../features/ledger/ledgerErrors'
import { resetLedgerStoreForTesting, useLedgerStore } from '../../features/ledger/ledgerStore'
import LedgerView from '../LedgerView.vue'

const api = vi.hoisted(() => ({
  getLedgerSettings: vi.fn(),
  listLedgerAccounts: vi.fn(),
  listLedgerCategories: vi.fn(),
  getLedgerOverview: vi.fn(),
  listLedgerTransactions: vi.fn(),
}))

vi.mock('../../features/ledger/api', () => api)

const settings: LedgerSettingsDto = {
  baseCurrency: 'CNY',
  currencyExponent: 2,
  timezone: 'Asia/Shanghai',
  hasCreatedAccount: true,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
}

const account: LedgerAccountDto = {
  id: 'bank-1',
  name: '招商银行',
  type: 'bank',
  nature: 'asset',
  openingBalanceMinor: 1_000_000,
  openingDate: '2026-01-01',
  currency: 'CNY',
  currencyExponent: 2,
  note: '',
  archivedAt: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  currentBalanceMinor: 1_000_000,
}

const category: LedgerCategoryDto = {
  id: 'food',
  kind: 'expense',
  name: '餐饮',
  normalizedName: '餐饮',
  archivedAt: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
}

function overviewFor(input: { scope: LedgerOverviewScope; anchorDate: string | undefined }): LedgerOverviewDto {
  const anchorDate = input.anchorDate ?? '2026-09-05'
  return {
    context: {
      anchorDate,
      todayDate: '2026-09-05',
      isToday: anchorDate === '2026-09-05',
      scope: input.scope,
    },
    currency: 'CNY',
    currencyExponent: 2,
    assetTotalMinor: 1_000_000,
    liabilityTotalMinor: 0,
    netWorthMinor: 1_000_000,
    accounts: [{
      ...account,
      balanceIncreaseMinor: 0,
      balanceDecreaseMinor: 0,
    }],
    cashflow: { incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
    categoryBreakdown: { income: [], expense: [] },
    periods: [
      { period: 'today', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
      { period: 'week', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
      { period: 'month', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
      { period: 'year', startAt: 0, endAt: 1, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0 },
    ],
    trend: [],
    recentTransactions: [],
  }
}

const wrappers: VueWrapper[] = []

function setupApi(): void {
  api.getLedgerSettings.mockResolvedValue(settings)
  api.listLedgerAccounts.mockResolvedValue([account])
  api.listLedgerCategories.mockResolvedValue([category])
  api.getLedgerOverview.mockImplementation((input: { scope: LedgerOverviewScope; anchorDate: string | undefined }) => Promise.resolve(overviewFor(input)))
  api.listLedgerTransactions.mockResolvedValue({ transactions: [], page: { nextCursor: null } })
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

/**
 * Route the Overview mock by requested anchor instead of call order so a test
 * can leave one anchor pending while a newer anchor resolves. Returns the list
 * of anchors the store actually requested.
 */
function routeOverviewGate(gates: Record<string, Promise<LedgerOverviewDto>>): Array<string | undefined> {
  const requested: Array<string | undefined> = []
  api.getLedgerOverview.mockImplementation((input: { scope: LedgerOverviewScope; anchorDate: string | undefined }) => {
    requested.push(input.anchorDate)
    const gate = input.anchorDate === undefined ? undefined : gates[input.anchorDate]
    return gate ?? Promise.resolve(overviewFor(input))
  })
  return requested
}

async function mountAt(path: string): Promise<{ router: ReturnType<typeof createRouter>; wrapper: VueWrapper }> {
  const placeholder = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ledger', name: 'ledger', component: LedgerView },
      { path: '/ledger/transactions', name: 'ledger-transactions', component: placeholder },
      { path: '/ledger/accounts', name: 'ledger-accounts', component: placeholder },
      { path: '/ledger/accounts/:id', name: 'ledger-account', component: placeholder },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(LedgerView, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  await flushPromises()
  await flushPromises()
  return { router, wrapper }
}

describe('Ledger historical period route coordination', () => {
  beforeEach(() => {
    sessionStorage.clear()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    setupApi()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('loads an anchored route, exposes the requested date, and keeps current snapshot wording', async () => {
    const { router, wrapper } = await mountAt('/ledger?date=2026-08-20')

    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-08-20')
    expect(api.getLedgerOverview).toHaveBeenCalledWith({ scope: 'month', anchorDate: '2026-08-20' })
    expect((wrapper.get('[data-testid="ledger-period-date"]').element as HTMLInputElement).value).toBe('2026-08-20')
    expect(wrapper.find('[data-testid="ledger-return-today"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('当前资产与账户余额保持实时')
    expect(wrapper.text()).toContain('截至选择日期的最近 5 笔记录')
  })

  it('uses browser history for date changes and clears only the anchor when returning today', async () => {
    const { router, wrapper } = await mountAt('/ledger?date=2026-08-20')
    api.getLedgerOverview.mockClear()

    await wrapper.get('[data-testid="ledger-period-date"]').setValue('2026-08-19')
    await flushPromises()
    await flushPromises()
    expect(router.currentRoute.value.query.date).toBe('2026-08-19')
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: '2026-08-19' })

    await wrapper.get('[data-testid="ledger-return-today"]').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(router.currentRoute.value.query.date).toBeUndefined()
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: undefined })
    expect(wrapper.find('[data-testid="ledger-return-today"]').exists()).toBe(false)
  })

  it('canonicalizes invalid and explicit-today dates without sending an invalid anchor', async () => {
    const invalid = await mountAt('/ledger?date=2026-02-30')
    expect(invalid.router.currentRoute.value.fullPath).toBe('/ledger')
    expect(api.getLedgerOverview).not.toHaveBeenCalledWith({ scope: 'month', anchorDate: '2026-02-30' })

    invalid.wrapper.unmount()
    resetLedgerStoreForTesting()
    vi.clearAllMocks()
    setupApi()
    const today = await mountAt('/ledger?date=2026-09-05')
    expect(today.router.currentRoute.value.fullPath).toBe('/ledger')
    expect(api.getLedgerOverview).toHaveBeenCalledWith({ scope: 'month', anchorDate: '2026-09-05' })
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: undefined })
  })

  it('lets Server future-date validation canonicalize the route and recover to the current dashboard', async () => {
    const future = new LedgerApiError(
      'future anchor',
      400,
      'ledger-validation-failed',
      { field: 'anchorDate' },
    )
    api.getLedgerOverview.mockRejectedValueOnce(future)
    const { router, wrapper } = await mountAt('/ledger?date=2026-09-06')

    expect(router.currentRoute.value.fullPath).toBe('/ledger')
    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-bootstrap-error"]').exists()).toBe(false)
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: undefined })
  })

  it('starts the latest route request immediately and publishes only its result', async () => {
    const { router, wrapper } = await mountAt('/ledger')
    api.getLedgerOverview.mockClear()
    const first = deferred<LedgerOverviewDto>()
    const second = deferred<LedgerOverviewDto>()
    api.getLedgerOverview.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    await router.push('/ledger?date=2026-08-20')
    await nextTick()
    expect(api.getLedgerOverview).toHaveBeenNthCalledWith(1, { scope: 'month', anchorDate: '2026-08-20' })

    await router.push('/ledger?date=2026-06-15')
    await nextTick()
    expect(api.getLedgerOverview).toHaveBeenNthCalledWith(2, { scope: 'month', anchorDate: '2026-06-15' })
    expect((wrapper.get('[data-testid="ledger-period-date"]').element as HTMLInputElement).value).toBe('2026-06-15')
    expect(useLedgerStore().overviewRequestedAnchorDate.value).toBe('2026-06-15')

    first.resolve(overviewFor({ scope: 'month', anchorDate: '2026-08-20' }))
    await flushPromises()
    expect(useLedgerStore().overview.value?.context.anchorDate).not.toBe('2026-08-20')
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')
    expect(wrapper.text()).not.toContain('2026年8月20日')

    second.resolve(overviewFor({ scope: 'month', anchorDate: '2026-06-15' }))
    await flushPromises()
    expect(wrapper.text()).toContain('2026年6月15日')
    expect(useLedgerStore().overviewMatchesRequest.value).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')
  })

  it('does not canonicalize a newer historical route after a stale future response', async () => {
    const { router, wrapper } = await mountAt('/ledger')
    api.getLedgerOverview.mockClear()
    const future = deferred<LedgerOverviewDto>()
    const historical = deferred<LedgerOverviewDto>()
    api.getLedgerOverview.mockReturnValueOnce(future.promise).mockReturnValueOnce(historical.promise)

    await router.push('/ledger?date=2026-09-06')
    await nextTick()
    await router.push('/ledger?date=2026-06-15')
    await nextTick()
    expect(api.getLedgerOverview).toHaveBeenCalledTimes(2)
    expect(api.getLedgerOverview).toHaveBeenLastCalledWith({ scope: 'month', anchorDate: '2026-06-15' })

    future.reject(new LedgerApiError(
      'future anchor',
      400,
      'ledger-validation-failed',
      { field: 'anchorDate' },
    ))
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')
    expect(api.getLedgerOverview).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="ledger-return-today"]').exists()).toBe(true)

    historical.resolve(overviewFor({ scope: 'month', anchorDate: '2026-06-15' }))
    await flushPromises()
    expect(useLedgerStore().overviewMatchesRequest.value).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')
  })

  it('finishes the workspace bootstrap when a route change races the initial overview request', async () => {
    const anchored = deferred<LedgerOverviewDto>()
    const historical = deferred<LedgerOverviewDto>()
    const requestedAnchors = routeOverviewGate({
      '2026-08-20': anchored.promise,
      '2026-06-15': historical.promise,
    })

    // The initial bootstrap is genuinely pending: Settings, Accounts and
    // Categories resolve, but its Overview read never has.
    const { router, wrapper } = await mountAt('/ledger?date=2026-08-20')
    const store = useLedgerStore()
    expect(requestedAnchors).toEqual(['2026-08-20'])
    expect(store.workspaceState.value).toBe('READY')
    expect(store.settings.value).toEqual(settings)
    expect(store.accounts.value).toHaveLength(1)
    expect(store.categories.value).toHaveLength(1)
    expect(wrapper.find('[data-testid="ledger-loading"]').exists()).toBe(true)

    await router.push('/ledger?date=2026-06-15')
    await nextTick()
    expect(store.overviewRequestedAnchorDate.value).toBe('2026-06-15')
    expect(requestedAnchors).toEqual(['2026-08-20', '2026-06-15'])

    anchored.resolve(overviewFor({ scope: 'month', anchorDate: '2026-08-20' }))
    await flushPromises()
    expect(store.overview.value).toBeNull()
    expect(store.workspaceState.value).toBe('READY')
    expect(wrapper.find('[data-testid="ledger-bootstrap-error"]').exists()).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')

    historical.resolve(overviewFor({ scope: 'month', anchorDate: '2026-06-15' }))
    await flushPromises()
    expect(store.workspaceState.value).toBe('READY')
    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-loading"]').exists()).toBe(false)
    expect((wrapper.get('[data-testid="ledger-period-date"]').element as HTMLInputElement).value).toBe('2026-06-15')
    expect(store.overviewMatchesRequest.value).toBe(true)
    expect(store.error.value).toBeNull()
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')
  })

  it('keeps a raced bootstrap overview failure out of the newest route lifecycle', async () => {
    const anchored = deferred<LedgerOverviewDto>()
    const historical = deferred<LedgerOverviewDto>()
    routeOverviewGate({
      '2026-08-20': anchored.promise,
      '2026-06-15': historical.promise,
    })

    const { router, wrapper } = await mountAt('/ledger?date=2026-08-20')
    const store = useLedgerStore()
    await router.push('/ledger?date=2026-06-15')
    await nextTick()

    anchored.reject(new LedgerApiError('projection unavailable', 500, 'ledger-internal-error'))
    await flushPromises()
    // The superseded Overview read owns no lifecycle any more: it may not
    // publish an error, degrade the workspace, or touch the route.
    expect(store.workspaceState.value).toBe('READY')
    expect(store.error.value).toBeNull()
    expect(wrapper.find('[data-testid="ledger-bootstrap-error"]').exists()).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')

    historical.resolve(overviewFor({ scope: 'month', anchorDate: '2026-06-15' }))
    await flushPromises()
    expect(store.workspaceState.value).toBe('READY')
    expect(store.overviewMatchesRequest.value).toBe(true)
    expect(store.error.value).toBeNull()
    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="ledger-period-date"]').element as HTMLInputElement).value).toBe('2026-06-15')
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')
  })

  it('completes a bootstrap interrupted before Settings with the newest route anchor', async () => {
    const settingsGate = deferred<LedgerSettingsDto>()
    api.getLedgerSettings.mockReturnValueOnce(settingsGate.promise)
    const requestedAnchors = routeOverviewGate({})

    const { router, wrapper } = await mountAt('/ledger?date=2026-08-20')
    const store = useLedgerStore()
    expect(store.workspaceState.value).toBe('BOOTSTRAPPING')
    expect(requestedAnchors).toEqual([])

    await router.push('/ledger?date=2026-06-15')
    await flushPromises()
    expect(store.overviewRequestedAnchorDate.value).toBe('2026-06-15')
    expect(requestedAnchors).toEqual(['2026-06-15'])
    expect(store.overview.value?.context.anchorDate).toBe('2026-06-15')
    // Settings is still in flight, so the workspace is still bootstrapping —
    // and that lifecycle is the only thing left to finish.
    expect(store.workspaceState.value).toBe('BOOTSTRAPPING')
    expect(wrapper.find('[data-testid="ledger-loading"]').exists()).toBe(true)

    settingsGate.resolve(settings)
    await flushPromises()
    expect(store.workspaceState.value).toBe('READY')
    expect(store.settings.value).toEqual(settings)
    expect(store.accounts.value).toHaveLength(1)
    expect(store.categories.value).toHaveLength(1)
    // The superseded bootstrap never sends an Overview request it could not publish.
    expect(requestedAnchors).toEqual(['2026-06-15'])
    expect(store.overview.value?.context.anchorDate).toBe('2026-06-15')
    expect(store.overviewMatchesRequest.value).toBe(true)
    expect(store.error.value).toBeNull()
    expect(wrapper.find('[data-testid="ledger-dashboard"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-loading"]').exists()).toBe(false)
    expect((wrapper.get('[data-testid="ledger-period-date"]').element as HTMLInputElement).value).toBe('2026-06-15')
    expect(router.currentRoute.value.fullPath).toBe('/ledger?date=2026-06-15')
  })
})
