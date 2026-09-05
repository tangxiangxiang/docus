/**
 * Live Ledger read projections.
 *
 * Repository methods own SQL filtering and ordering. This module owns the
 * read-model composition and all checked financial arithmetic, while the
 * natural-balance engine remains the only authority for account effects.
 */

import {
  currencyExponentFor,
} from '../../shared/ledgerCurrency.js'
import type {
  LedgerAccountDto,
  LedgerAccountSummary,
  LedgerAccountTransactionsDto,
  LedgerCategoryKind,
  LedgerCategorySlice,
  LedgerCashflowSummary,
  LedgerMovementSummary,
  LedgerOverviewContext,
  LedgerOverviewDto,
  LedgerOverviewScope,
  LedgerPeriodName,
  LedgerPeriodSummary,
  LedgerTransactionDto,
  LedgerTransactionPageDto,
  LedgerTransactionQuery,
  LedgerTrendPoint,
} from '../../shared/ledgerProtocol.js'
import {
  deriveCurrentBalance,
  transactionEffectForAccount,
} from './balance.js'
import {
  LedgerError,
  ledgerValidationError,
} from './errors.js'
import type {
  LedgerAccount,
  LedgerCategory,
  LedgerSettings,
  LedgerTransaction,
} from './domain.js'
import {
  checkedAddMinor,
  checkedSubMinor,
  checkedSumMinor,
} from './money.js'
import {
  calendarMonthRanges,
  calendarMonthRangesForLocalDate,
  ledgerLocalDateForInstant,
  monthRange,
  parseLedgerLocalDate,
  periodRange,
  periodRangesForLocalDate,
  periodRangesForInstant,
  assertUtcMilliseconds,
} from './time.js'
import {
  LEDGER_LIST_LIMIT_DEFAULT,
  LEDGER_LIST_LIMIT_MAX,
  parseLedgerTransactionCursor,
} from './validation.js'
import type {
  LedgerRepository,
  LedgerTransactionQueryOptions,
} from './repository.js'

const PERIOD_ORDER = ['today', 'week', 'month', 'year'] as const
const RECENT_TRANSACTION_LIMIT = 5

export interface LedgerOverviewInput {
  readonly scope: LedgerOverviewScope
  readonly anchorDate?: string
}

export interface LedgerProjectionDependencies {
  readonly now?: () => number
}

export interface LedgerProjections {
  listTransactions(query: LedgerTransactionQuery): LedgerTransactionPageDto
  getAccountTransactions(
    accountId: string,
    query: LedgerTransactionQuery,
  ): LedgerAccountTransactionsDto
  getOverview(input: LedgerOverviewInput): LedgerOverviewDto
  getTrend(months: number): readonly LedgerTrendPoint[]
}

interface AccountProjectionState {
  readonly account: LedgerAccount
  readonly transactions: readonly LedgerTransaction[]
  readonly currentBalanceMinor: number
}

function notFound(entity: string): never {
  throw new LedgerError('ledger-not-found', 404, `${entity} was not found`)
}

function projectionInvariant(message: string): never {
  // Persistence/domain corruption is not a client validation failure. The
  // route error boundary maps this opaque internal failure to generic 500.
  throw new Error(`Ledger projection invariant violated: ${message}`)
}

function transactionDto(transaction: LedgerTransaction): LedgerTransactionDto {
  const base = {
    id: transaction.id,
    amountMinor: transaction.amountMinor,
    occurredAt: transaction.occurredAt,
    note: transaction.note,
    deletedAt: transaction.deletedAt,
    version: transaction.version,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  }

  switch (transaction.type) {
    case 'income':
      return {
        ...base,
        type: 'income',
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        payee: transaction.payee,
      }
    case 'expense':
      return {
        ...base,
        type: 'expense',
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        payee: transaction.payee,
      }
    case 'transfer':
      return {
        ...base,
        type: 'transfer',
        fromAccountId: transaction.fromAccountId,
        toAccountId: transaction.toAccountId,
      }
    case 'adjustment':
      return {
        ...base,
        type: 'adjustment',
        accountId: transaction.accountId,
        adjustmentCalculatedBalanceMinor: transaction.adjustmentCalculatedBalanceMinor,
        adjustmentTargetBalanceMinor: transaction.adjustmentTargetBalanceMinor,
      }
  }
}

function accountDto(
  account: LedgerAccount,
  currentBalanceMinor: number,
): LedgerAccountDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    nature: account.nature,
    openingBalanceMinor: account.openingBalanceMinor,
    openingDate: account.openingDate,
    currency: account.currency,
    currencyExponent: currencyExponentFor(account.currency),
    note: account.note,
    archivedAt: account.archivedAt,
    version: account.version,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    currentBalanceMinor,
  }
}

function isWithinRange(value: number, range: { readonly startMs: number; readonly endMs: number }): boolean {
  return value >= range.startMs && value < range.endMs
}

function cashflowForTransactions(transactions: readonly LedgerTransaction[]): LedgerCashflowSummary {
  const incomeMinor = checkedSumMinor(
    transactions
      .filter((transaction) => transaction.type === 'income')
      .map((transaction) => transaction.amountMinor),
  )
  const expenseMinor = checkedSumMinor(
    transactions
      .filter((transaction) => transaction.type === 'expense')
      .map((transaction) => transaction.amountMinor),
  )
  return {
    incomeMinor,
    expenseMinor,
    balanceMinor: checkedSubMinor(incomeMinor, expenseMinor),
  }
}

function categorySlicesForTransactions(
  transactions: readonly LedgerTransaction[],
  categories: ReadonlyMap<string, LedgerCategory>,
): { readonly income: readonly LedgerCategorySlice[]; readonly expense: readonly LedgerCategorySlice[] } {
  const groups: Record<LedgerCategoryKind, Map<string, number>> = {
    income: new Map(),
    expense: new Map(),
  }

  for (const transaction of transactions) {
    if (transaction.type !== 'income' && transaction.type !== 'expense') continue
    const categoryId = transaction.categoryId
    const category = categories.get(categoryId)
    if (category === undefined) {
      return projectionInvariant(`transaction ${transaction.id} references missing Category ${categoryId}`)
    }
    if (category.kind !== transaction.type) {
      return projectionInvariant(`transaction ${transaction.id} has a mismatched Category kind`)
    }
    const previous = groups[transaction.type].get(categoryId) ?? 0
    groups[transaction.type].set(
      categoryId,
      checkedAddMinor(previous, transaction.amountMinor),
    )
  }

  const toSlices = (kind: LedgerCategoryKind): readonly LedgerCategorySlice[] => {
    const slices = Array.from(groups[kind], ([categoryId, amountMinor]) => {
      const category = categories.get(categoryId)
      if (category === undefined) {
        return projectionInvariant(`Category ${categoryId} disappeared while building breakdown`)
      }
      return {
        categoryId,
        name: category.name,
        kind: category.kind,
        amountMinor,
      }
    })

    slices.sort((left, right) => {
      if (left.amountMinor !== right.amountMinor) return left.amountMinor > right.amountMinor ? -1 : 1
      if (left.categoryId === right.categoryId) return 0
      return left.categoryId < right.categoryId ? -1 : 1
    })
    return slices
  }

  return {
    income: toSlices('income'),
    expense: toSlices('expense'),
  }
}

function movementForAccount(
  account: LedgerAccount,
  transactions: readonly LedgerTransaction[],
  range: { readonly startMs: number; readonly endMs: number },
): LedgerMovementSummary {
  let balanceIncreaseMinor = 0
  let balanceDecreaseMinor = 0

  for (const transaction of transactions) {
    if (transaction.type === 'adjustment' || !isWithinRange(transaction.occurredAt, range)) continue
    const delta = transactionEffectForAccount(transaction, account)
    if (delta > 0) {
      balanceIncreaseMinor = checkedAddMinor(balanceIncreaseMinor, delta)
    } else if (delta < 0) {
      balanceDecreaseMinor = checkedAddMinor(
        balanceDecreaseMinor,
        checkedSubMinor(0, delta),
      )
    }
  }

  return { balanceIncreaseMinor, balanceDecreaseMinor }
}

function periodSummary(
  period: LedgerPeriodName,
  range: { readonly startMs: number; readonly endMs: number },
  transactions: readonly LedgerTransaction[],
): LedgerPeriodSummary {
  const cashflow = cashflowForTransactions(
    transactions.filter((transaction) => isWithinRange(transaction.occurredAt, range)),
  )
  return {
    period,
    startAt: range.startMs,
    endAt: range.endMs,
    ...cashflow,
  }
}

function trendForTransactions(
  months: number,
  nowMs: number,
  timezone: string,
  transactions: readonly LedgerTransaction[],
): readonly LedgerTrendPoint[] {
  return calendarMonthRanges(months, nowMs, timezone).map((range) => ({
    month: range.month,
    startAt: range.startMs,
    endAt: range.endMs,
    ...cashflowForTransactions(
      transactions.filter((transaction) => isWithinRange(transaction.occurredAt, range)),
    ),
  }))
}

function trendForRanges(
  ranges: readonly { readonly month: string; readonly startMs: number; readonly endMs: number }[],
  transactions: readonly LedgerTransaction[],
): readonly LedgerTrendPoint[] {
  return ranges.map((range) => ({
    month: range.month,
    startAt: range.startMs,
    endAt: range.endMs,
    ...cashflowForTransactions(
      transactions.filter((transaction) => isWithinRange(transaction.occurredAt, range)),
    ),
  }))
}

function normalizeTransactionQuery(query: LedgerTransactionQuery): LedgerTransactionQueryOptions {
  const limit = query.limit ?? LEDGER_LIST_LIMIT_DEFAULT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LEDGER_LIST_LIMIT_MAX) {
    throw ledgerValidationError(
      `limit must be an integer from 1 to ${LEDGER_LIST_LIMIT_MAX}`,
      { field: 'limit' },
    )
  }

  return {
    type: query.type ?? 'all',
    accountId: query.accountId,
    categoryId: query.categoryId,
    from: query.from,
    to: query.to,
    search: query.search,
    includeDeleted: query.includeDeleted ?? false,
    limit,
    cursor: query.cursor === undefined
      ? undefined
      : parseLedgerTransactionCursor(query.cursor),
  }
}

export function createLedgerProjections(
  repository: LedgerRepository,
  dependencies: LedgerProjectionDependencies = {},
): LedgerProjections {
  const now = dependencies.now ?? Date.now

  function requireSettings(): LedgerSettings {
    const settings = repository.getSettings()
    if (settings === null) notFound('Ledger Settings')
    return settings
  }

  function captureNow(): number {
    return assertUtcMilliseconds(now(), 'projection now')
  }

  function accountState(account: LedgerAccount): AccountProjectionState {
    const transactions = repository.listActiveTransactionsForAccount(account.id)
    return {
      account,
      transactions,
      currentBalanceMinor: deriveCurrentBalance(account, transactions),
    }
  }

  function transactionPage(query: LedgerTransactionQuery): LedgerTransactionPageDto {
    const options = normalizeTransactionQuery(query)
    const rows = repository.queryTransactions(options)
    const hasNextPage = rows.length > options.limit
    const returnedRows = hasNextPage ? rows.slice(0, options.limit) : rows
    const last = returnedRows[returnedRows.length - 1]
    return {
      transactions: returnedRows.map(transactionDto),
      page: {
        nextCursor: hasNextPage && last !== undefined
          ? encodeCursor(last)
          : null,
      },
    }
  }

  function encodeCursor(transaction: LedgerTransaction): string {
    const payload = JSON.stringify({
      v: 1,
      occurredAt: transaction.occurredAt,
      createdAt: transaction.createdAt,
      id: transaction.id,
    })
    return Buffer.from(payload, 'utf8').toString('base64url')
  }

  function listTransactions(query: LedgerTransactionQuery): LedgerTransactionPageDto {
    requireSettings()
    return transactionPage(query)
  }

  function getAccountTransactions(
    accountId: string,
    query: LedgerTransactionQuery,
  ): LedgerAccountTransactionsDto {
    const settings = requireSettings()
    const account = repository.getAccount(accountId)
    if (account === null) notFound('Ledger Account')

    const nowMs = captureNow()
    const state = accountState(account)
    const page = transactionPage({ ...query, accountId })
    return {
      account: accountDto(account, state.currentBalanceMinor),
      movement: movementForAccount(
        account,
        state.transactions,
        monthRange(nowMs, settings.timezone),
      ),
      ...page,
    }
  }

  function getOverview(input: LedgerOverviewInput): LedgerOverviewDto {
    const settings = requireSettings()
    const nowMs = captureNow()
    const todayDate = ledgerLocalDateForInstant(nowMs, settings.timezone)
    const resolvedAnchorDate = input.anchorDate === undefined
      ? todayDate
      : parseLedgerLocalDate(input.anchorDate, 'anchorDate')
    if (resolvedAnchorDate > todayDate) {
      throw new LedgerError(
        'ledger-validation-failed',
        400,
        'anchorDate cannot be in the future',
        { field: 'anchorDate' },
      )
    }

    const scope = input.scope
    const fixedPeriods = periodRangesForLocalDate(resolvedAnchorDate, settings.timezone)
    const trendRanges = calendarMonthRangesForLocalDate(6, resolvedAnchorDate, settings.timezone)
    const allAccounts = repository.listAccounts({ includeArchived: true })
    const accountStates = allAccounts.map(accountState)
    const activeAccounts = accountStates.filter((state) => state.account.archivedAt === null)
    const categories = new Map(
      repository.listCategories({ includeArchived: true }).map((category) => [category.id, category]),
    )

    const periodWindowStart = Math.min(
      trendRanges[0]!.startMs,
      ...Object.values(fixedPeriods).map((range) => range.startMs),
    )
    const periodWindowEnd = Math.max(
      trendRanges[trendRanges.length - 1]!.endMs,
      ...Object.values(fixedPeriods).map((range) => range.endMs),
    )
    const periodTransactions = repository.listActiveTransactionsInRange({
      from: periodWindowStart,
      to: periodWindowEnd,
    })
    const allTransactions = scope === 'all'
      ? repository.listActiveTransactionsInRange({ to: fixedPeriods.today.endMs })
      : null

    const assetTotalMinor = checkedSumMinor(
      accountStates
        .filter((state) => state.account.nature === 'asset')
        .map((state) => state.currentBalanceMinor),
    )
    const liabilityTotalMinor = checkedSumMinor(
      accountStates
        .filter((state) => state.account.nature === 'liability')
        .map((state) => state.currentBalanceMinor),
    )

    const scopedTransactions = scope === 'all'
      ? allTransactions!
      : periodTransactions.filter((transaction) => isWithinRange(
        transaction.occurredAt,
        fixedPeriods[scope],
      ))
    const month = monthRange(nowMs, settings.timezone)

    const accounts: readonly LedgerAccountSummary[] = activeAccounts.map((state) => ({
      ...accountDto(state.account, state.currentBalanceMinor),
      ...movementForAccount(state.account, state.transactions, month),
    }))

    return {
      context: {
        anchorDate: resolvedAnchorDate,
        todayDate,
        isToday: resolvedAnchorDate === todayDate,
        scope,
      } satisfies LedgerOverviewContext,
      currency: settings.baseCurrency,
      currencyExponent: currencyExponentFor(settings.baseCurrency),
      assetTotalMinor,
      liabilityTotalMinor,
      netWorthMinor: checkedSubMinor(assetTotalMinor, liabilityTotalMinor),
      accounts,
      cashflow: cashflowForTransactions(scopedTransactions),
      categoryBreakdown: categorySlicesForTransactions(scopedTransactions, categories),
      periods: PERIOD_ORDER.map((period) => periodSummary(
        period,
        fixedPeriods[period],
        periodTransactions,
      )),
      trend: trendForRanges(trendRanges, periodTransactions),
      recentTransactions: repository
        .listRecentActiveTransactionsBefore(fixedPeriods.today.endMs, RECENT_TRANSACTION_LIMIT)
        .map(transactionDto),
    }
  }

  function getTrend(months: number): readonly LedgerTrendPoint[] {
    const settings = requireSettings()
    const nowMs = captureNow()
    return trendForTransactions(
      months,
      nowMs,
      settings.timezone,
      repository.listActiveTransactions(),
    )
  }

  return {
    listTransactions,
    getAccountTransactions,
    getOverview,
    getTrend,
  }
}
