/**
 * Transport-safe Ledger contracts.
 *
 * Database rows use snake_case and nullable discriminator columns. These
 * camelCase DTOs are the shared public boundary for the future API and UI;
 * persistence/domain conversion belongs on the server.
 */

export type LedgerAccountType =
  | 'cash'
  | 'bank'
  | 'wallet'
  | 'credit_card'
  | 'loan'
  | 'other'

export type LedgerAccountNature = 'asset' | 'liability'
export type LedgerCategoryKind = 'income' | 'expense'
export type LedgerTransactionType = 'income' | 'expense' | 'transfer' | 'adjustment'
export type LedgerTransactionFilterType = 'income' | 'expense' | 'transfer'
export type LedgerPeriodName = 'today' | 'week' | 'month' | 'year'
export type LedgerOverviewScope = LedgerPeriodName | 'all'

export interface LedgerSettingsDto {
  readonly baseCurrency: string
  readonly currencyExponent: number
  readonly timezone: string
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface LedgerAccountDto {
  readonly id: string
  readonly name: string
  readonly type: LedgerAccountType
  readonly nature: LedgerAccountNature
  readonly openingBalanceMinor: number
  readonly openingDate: string
  readonly currency: string
  readonly currencyExponent: number
  readonly note: string
  readonly archivedAt: number | null
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly currentBalanceMinor: number
}

export interface LedgerCategoryDto {
  readonly id: string
  readonly kind: LedgerCategoryKind
  readonly name: string
  readonly normalizedName: string
  readonly archivedAt: number | null
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

interface LedgerTransactionDtoBase {
  readonly id: string
  readonly amountMinor: number
  readonly occurredAt: number
  readonly note: string
  readonly deletedAt: number | null
  readonly version: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface LedgerIncomeTransactionDto extends LedgerTransactionDtoBase {
  readonly type: 'income'
  readonly accountId: string
  readonly categoryId: string
  readonly payee: string
}

export interface LedgerExpenseTransactionDto extends LedgerTransactionDtoBase {
  readonly type: 'expense'
  readonly accountId: string
  readonly categoryId: string
  readonly payee: string
}

export interface LedgerTransferTransactionDto extends LedgerTransactionDtoBase {
  readonly type: 'transfer'
  readonly fromAccountId: string
  readonly toAccountId: string
}

export interface LedgerAdjustmentTransactionDto extends LedgerTransactionDtoBase {
  readonly type: 'adjustment'
  readonly accountId: string
  readonly adjustmentCalculatedBalanceMinor: number
  readonly adjustmentTargetBalanceMinor: number
}

export type LedgerTransactionDto =
  | LedgerIncomeTransactionDto
  | LedgerExpenseTransactionDto
  | LedgerTransferTransactionDto
  | LedgerAdjustmentTransactionDto

export interface LedgerAdjustmentAppliedDto {
  readonly adjustment: LedgerAdjustmentTransactionDto
  readonly account: LedgerAccountDto
  readonly noOp: false
}

export interface LedgerAdjustmentNoOpDto {
  readonly adjustment: null
  readonly account: LedgerAccountDto
  readonly noOp: true
}

export type LedgerAdjustmentMutationDto =
  | LedgerAdjustmentAppliedDto
  | LedgerAdjustmentNoOpDto

export interface LedgerIncomeCreateRequest {
  readonly type: 'income'
  readonly amountMinor: number
  readonly accountId: string
  readonly categoryId: string
  readonly occurredAt: number
  readonly payee: string
  readonly note: string
}

export interface LedgerExpenseCreateRequest {
  readonly type: 'expense'
  readonly amountMinor: number
  readonly accountId: string
  readonly categoryId: string
  readonly occurredAt: number
  readonly payee: string
  readonly note: string
}

export interface LedgerTransferCreateRequest {
  readonly type: 'transfer'
  readonly amountMinor: number
  readonly fromAccountId: string
  readonly toAccountId: string
  readonly occurredAt: number
  readonly note: string
}

export interface LedgerAdjustmentCreateRequest {
  readonly type: 'adjustment'
  readonly accountId: string
  readonly targetBalanceMinor: number
  readonly expectedCalculatedBalanceMinor: number
  readonly occurredAt: number
  readonly note: string
}

export type LedgerTransactionCreateRequest =
  | LedgerIncomeCreateRequest
  | LedgerExpenseCreateRequest
  | LedgerTransferCreateRequest
  | LedgerAdjustmentCreateRequest

export interface LedgerSettingsCreateRequest {
  readonly baseCurrency: string
  readonly timezone: string
}

export interface LedgerAccountCreateRequest {
  readonly name: string
  readonly type: LedgerAccountType
  readonly nature: LedgerAccountNature
  readonly openingBalanceMinor: number
  readonly openingDate: string
  readonly currency: string
  readonly note: string
}

export interface LedgerCategoryCreateRequest {
  readonly kind: LedgerCategoryKind
  readonly name: string
}

export interface LedgerAdjustmentEndpointRequest {
  readonly targetBalanceMinor: number
  readonly expectedCalculatedBalanceMinor: number
  readonly occurredAt: number
  readonly note: string
}

export interface LedgerPageInfo {
  readonly nextCursor: string | null
}

/** The decoded keyset position used by the Ledger transaction query. */
export interface LedgerTransactionCursor {
  readonly occurredAt: number
  readonly createdAt: number
  readonly id: string
}

export interface LedgerTransactionQuery {
  readonly type?: LedgerTransactionFilterType | 'all'
  readonly accountId?: string
  readonly categoryId?: string
  readonly from?: number
  readonly to?: number
  readonly search?: string
  readonly includeDeleted?: boolean
  readonly limit?: number
  readonly cursor?: string
}

export interface LedgerTransactionPageDto {
  readonly transactions: readonly LedgerTransactionDto[]
  readonly page: LedgerPageInfo
}

export interface LedgerPeriodSummary {
  readonly period: LedgerPeriodName
  readonly startAt: number
  readonly endAt: number
  readonly incomeMinor: number
  readonly expenseMinor: number
  readonly balanceMinor: number
}

export interface LedgerTrendPoint {
  readonly month: string
  readonly startAt: number
  readonly endAt: number
  readonly incomeMinor: number
  readonly expenseMinor: number
  readonly balanceMinor: number
}

export interface LedgerCategorySlice {
  readonly categoryId: string
  readonly name: string
  readonly kind: LedgerCategoryKind
  readonly amountMinor: number
}

export interface LedgerCashflowSummary {
  readonly incomeMinor: number
  readonly expenseMinor: number
  readonly balanceMinor: number
}

export interface LedgerAccountSummary extends LedgerAccountDto {
  readonly balanceIncreaseMinor: number
  readonly balanceDecreaseMinor: number
}

export interface LedgerOverviewDto {
  readonly currency: string
  readonly currencyExponent: number
  readonly assetTotalMinor: number
  readonly liabilityTotalMinor: number
  readonly netWorthMinor: number
  readonly accounts: readonly LedgerAccountSummary[]
  readonly cashflow: LedgerCashflowSummary
  readonly categoryBreakdown: {
    readonly income: readonly LedgerCategorySlice[]
    readonly expense: readonly LedgerCategorySlice[]
  }
  readonly periods: readonly LedgerPeriodSummary[]
  readonly trend: readonly LedgerTrendPoint[]
  readonly recentTransactions: readonly LedgerTransactionDto[]
}

export interface LedgerMovementSummary {
  readonly balanceIncreaseMinor: number
  readonly balanceDecreaseMinor: number
}

export interface LedgerAccountTransactionsDto {
  readonly account: LedgerAccountDto
  readonly movement: LedgerMovementSummary
  readonly transactions: readonly LedgerTransactionDto[]
  readonly page: LedgerPageInfo
}
