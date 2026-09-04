import { normalizeLedgerCategoryName } from '../../shared/ledgerNormalization.js'
import type { LedgerCategoryKind } from '../../shared/ledgerProtocol.js'
import type { LedgerCategory } from './domain.js'
import type { LedgerRepository } from './repository.js'

/** The exact ordered v1 catalog created with the first Ledger Settings row. */
export const DEFAULT_LEDGER_CATEGORIES_V1 = [
  { kind: 'expense', name: '餐饮' },
  { kind: 'expense', name: '交通' },
  { kind: 'expense', name: '购物' },
  { kind: 'expense', name: '住房' },
  { kind: 'expense', name: '日用' },
  { kind: 'expense', name: '娱乐' },
  { kind: 'expense', name: '医疗' },
  { kind: 'expense', name: '教育' },
  { kind: 'expense', name: '旅行' },
  { kind: 'expense', name: '人情' },
  { kind: 'expense', name: '其他' },

  { kind: 'income', name: '工资' },
  { kind: 'income', name: '奖金' },
  { kind: 'income', name: '投资收益' },
  { kind: 'income', name: '兼职' },
  { kind: 'income', name: '退款' },
  { kind: 'income', name: '红包' },
  { kind: 'income', name: '其他' },
] as const satisfies readonly { kind: LedgerCategoryKind; name: string }[]

export interface LedgerCategorySeedDependencies {
  readonly now: () => number
  readonly createId: () => string
}

/**
 * Seed the catalog inside the caller's write transaction. Existing identities
 * are deliberately untouched, including archived identities.
 */
export function seedDefaultLedgerCategories(
  repository: LedgerRepository,
  dependencies: LedgerCategorySeedDependencies,
): void {
  for (const entry of DEFAULT_LEDGER_CATEGORIES_V1) {
    const normalizedName = normalizeLedgerCategoryName(entry.name)
    if (repository.findCategoryByIdentity(entry.kind, normalizedName) !== null) continue

    const timestamp = dependencies.now()
    const category: LedgerCategory = {
      id: dependencies.createId(),
      kind: entry.kind,
      name: entry.name,
      normalizedName,
      archivedAt: null,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    repository.insertCategory(category)
  }
}
