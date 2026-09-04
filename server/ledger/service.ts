import { randomUUID } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import {
  currencyExponentFor,
  normalizeLedgerCurrencyCode,
} from '../../shared/ledgerCurrency.js'
import { normalizeLedgerCategoryName } from '../../shared/ledgerNormalization.js'
import type {
  LedgerAccountCreateRequest,
  LedgerAccountDto,
  LedgerAccountNature,
  LedgerAccountType,
  LedgerCategoryCreateRequest,
  LedgerCategoryDto,
  LedgerCategoryKind,
  LedgerSettingsCreateRequest,
  LedgerSettingsDto,
} from '../../shared/ledgerProtocol.js'
import {
  deriveCurrentBalance,
} from './balance.js'
import {
  isLedgerAccountTypeNature,
  type LedgerAccount,
  type LedgerCategory,
  type LedgerSettings,
} from './domain.js'
import { LedgerError, ledgerValidationError } from './errors.js'
import {
  executeIdempotentLedgerCreate,
  LEDGER_IDEMPOTENCY_OPERATION_SCOPES,
  type LedgerIdempotentResult,
  type LedgerReplayResult,
} from './idempotency.js'
import { createLedgerRepository, type LedgerRepository } from './repository.js'
import {
  parseAccountPatchRequest,
  parseCategoryPatchRequest,
  parseExpectedVersion,
  parseExpectedVersionCommand,
  parseSettingsPatchRequest,
  type LedgerAccountPatchRequest,
  type LedgerCategoryPatchRequest,
  type LedgerSettingsPatchRequest,
} from './validation.js'
import { assertUtcMilliseconds } from './time.js'
import { runLedgerWrite } from './writeTransaction.js'
import { seedDefaultLedgerCategories } from './defaultCategories.js'

export interface LedgerServiceDependencies {
  readonly now?: () => number
  readonly createId?: () => string
}

export interface LedgerDeletedResponse {
  readonly deleted: true
  readonly id: string
}

export interface LedgerService {
  getSettings(): LedgerSettingsDto
  createSettings(request: LedgerSettingsCreateRequest, idempotencyKey: string): LedgerReplayResult
  patchSettings(value: unknown): LedgerSettingsDto

  listAccounts(includeArchived: boolean): LedgerAccountDto[]
  getAccount(id: string): LedgerAccountDto
  createAccount(request: LedgerAccountCreateRequest, idempotencyKey: string): LedgerReplayResult
  patchAccount(id: string, value: unknown): LedgerAccountDto
  deleteAccount(id: string, value: unknown): LedgerDeletedResponse
  archiveAccount(id: string, value: unknown): LedgerAccountDto
  restoreAccount(id: string, value: unknown): LedgerAccountDto

  listCategories(
    kind: LedgerCategoryKind | undefined,
    includeArchived: boolean,
  ): LedgerCategoryDto[]
  createCategory(request: LedgerCategoryCreateRequest, idempotencyKey: string): LedgerReplayResult
  patchCategory(id: string, value: unknown): LedgerCategoryDto
  deleteCategory(id: string, value: unknown): LedgerDeletedResponse
  archiveCategory(id: string, value: unknown): LedgerCategoryDto
  restoreCategory(id: string, value: unknown): LedgerCategoryDto
}

type MutationRecord = Record<string, unknown>

function asMutationRecord(value: unknown): MutationRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as MutationRecord
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function notFound(entity: string): never {
  throw new LedgerError('ledger-not-found', 404, `${entity} was not found`)
}

function versionConflict(): never {
  throw new LedgerError('ledger-version-conflict', 409, 'Ledger resource version is stale')
}

function assertExpectedVersion(currentVersion: number, expectedVersion: number): void {
  if (currentVersion !== expectedVersion) versionConflict()
}

function nextVersion(currentVersion: number): number {
  if (currentVersion >= Number.MAX_SAFE_INTEGER) {
    throw ledgerValidationError('Ledger resource version cannot be incremented safely', {
      field: 'version',
    })
  }
  return currentVersion + 1
}

function generatedTimestamp(now: () => number): number {
  return assertUtcMilliseconds(now(), 'server timestamp')
}

function generatedId(createId: () => string): string {
  const id = createId()
  if (typeof id !== 'string' || id.length === 0) {
    throw ledgerValidationError('server-generated Ledger ID must be a non-empty string')
  }
  return id
}

function invalidAccountPair(type: LedgerAccountType, nature: LedgerAccountNature): never {
  throw new LedgerError(
    'ledger-invalid-account-pair',
    400,
    `Account type ${type} cannot use nature ${nature}`,
    { field: 'nature' },
  )
}

function assertAccountPair(type: LedgerAccountType, nature: LedgerAccountNature): void {
  if (!isLedgerAccountTypeNature(type, nature)) invalidAccountPair(type, nature)
}

function duplicateCategory(): never {
  throw new LedgerError(
    'ledger-duplicate-category',
    409,
    'A Ledger Category with the same kind and name already exists',
  )
}

function archivedAccount(): never {
  throw new LedgerError(
    'ledger-archived-account',
    409,
    'Archived Accounts must be restored before financial fields can be changed',
  )
}

function archivedCategory(): never {
  throw new LedgerError(
    'ledger-archived-category',
    409,
    'Archived Categories must be restored before they can be changed',
  )
}

function toSettingsDto(settings: LedgerSettings): LedgerSettingsDto {
  return {
    baseCurrency: settings.baseCurrency,
    currencyExponent: currencyExponentFor(settings.baseCurrency),
    timezone: settings.timezone,
    version: settings.version,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  }
}

function toCategoryDto(category: LedgerCategory): LedgerCategoryDto {
  return {
    id: category.id,
    kind: category.kind,
    name: category.name,
    normalizedName: category.normalizedName,
    archivedAt: category.archivedAt,
    version: category.version,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }
}

export function createLedgerService(
  db: DatabaseT,
  repository: LedgerRepository = createLedgerRepository(db),
  dependencies: LedgerServiceDependencies = {},
): LedgerService {
  const now = dependencies.now ?? Date.now
  const createId = dependencies.createId ?? randomUUID

  function requireSettings(): LedgerSettings {
    const settings = repository.getSettings()
    if (settings === null) notFound('Ledger Settings')
    return settings
  }

  function toAccountDto(account: LedgerAccount): LedgerAccountDto {
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
      currentBalanceMinor: deriveCurrentBalance(
        account,
        repository.listActiveTransactionsForAccount(account.id),
      ),
    }
  }

  function checkSettingsLock(settings: LedgerSettings, value: unknown): void {
    if (!settings.hasCreatedAccount) return
    const record = asMutationRecord(value)
    if (record === null) return

    if (hasOwn(record, 'timezone') && record.timezone !== settings.timezone) {
      throw new LedgerError(
        'ledger-timezone-locked',
        409,
        'Ledger timezone is locked after the first Account is created',
        { field: 'timezone' },
      )
    }

    if (hasOwn(record, 'baseCurrency')) {
      let sameCurrency = false
      if (typeof record.baseCurrency === 'string') {
        try {
          sameCurrency = normalizeLedgerCurrencyCode(record.baseCurrency) === settings.baseCurrency
        } catch {
          sameCurrency = false
        }
      }
      if (!sameCurrency) {
        throw new LedgerError(
          'ledger-base-currency-locked',
          409,
          'Ledger base currency is locked after the first Account is created',
          { field: 'baseCurrency' },
        )
      }
    }
  }

  function patchSettings(value: unknown): LedgerSettingsDto {
    return runLedgerWrite(db, () => {
      const settings = requireSettings()
      checkSettingsLock(settings, value)

      // Compare the expected version before the full payload parser so a
      // valid stale command cannot be masked by an unrelated payload error.
      const rawRecord = asMutationRecord(value)
      if (rawRecord !== null) {
        const expectedVersion = parseExpectedVersion(rawRecord)
        assertExpectedVersion(settings.version, expectedVersion)
      }
      const patch = parseSettingsPatchRequest(value)
      assertExpectedVersion(settings.version, patch.expectedVersion)

      const updated: LedgerSettings = {
        ...settings,
        ...(patch.baseCurrency === undefined ? {} : { baseCurrency: patch.baseCurrency }),
        ...(patch.timezone === undefined ? {} : { timezone: patch.timezone }),
        version: nextVersion(settings.version),
        updatedAt: generatedTimestamp(now),
      }
      if (repository.updateSettings({ settings: updated, expectedVersion: settings.version }) !== 1) {
        versionConflict()
      }
      return toSettingsDto(updated)
    })
  }

  function createSettings(
    request: LedgerSettingsCreateRequest,
    idempotencyKey: string,
  ): LedgerReplayResult {
    return executeIdempotentLedgerCreate(db, repository, {
      operationScope: LEDGER_IDEMPOTENCY_OPERATION_SCOPES.settings,
      idempotencyKey,
      request,
      mutation: (): LedgerIdempotentResult => {
        if (repository.getSettings() !== null) {
          throw new LedgerError(
            'ledger-settings-already-initialized',
            409,
            'Ledger Settings are already initialized',
          )
        }
        const timestamp = generatedTimestamp(now)
        const settings: LedgerSettings = {
          baseCurrency: request.baseCurrency,
          timezone: request.timezone,
          hasCreatedAccount: false,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        repository.insertSettings(settings)
        seedDefaultLedgerCategories(repository, {
          now: () => generatedTimestamp(now),
          createId: () => generatedId(createId),
        })
        return {
          resultStatus: 'committed',
          responseStatus: 201,
          responseBody: toSettingsDto(settings),
          resultType: 'settings',
          resultId: 'ledger-settings',
        }
      },
    })
  }

  function listAccounts(includeArchived: boolean): LedgerAccountDto[] {
    requireSettings()
    return repository
      .listAccounts({ includeArchived })
      .map(toAccountDto)
  }

  function getAccount(id: string): LedgerAccountDto {
    requireSettings()
    const account = repository.getAccount(id)
    if (account === null) notFound('Ledger Account')
    return toAccountDto(account)
  }

  function createAccount(
    request: LedgerAccountCreateRequest,
    idempotencyKey: string,
  ): LedgerReplayResult {
    return executeIdempotentLedgerCreate(db, repository, {
      operationScope: LEDGER_IDEMPOTENCY_OPERATION_SCOPES.accounts,
      idempotencyKey,
      request,
      mutation: (): LedgerIdempotentResult => {
        const settings = requireSettings()
        assertAccountPair(request.type, request.nature)
        if (request.currency !== settings.baseCurrency) {
          throw new LedgerError(
            'ledger-currency-mismatch',
            409,
            'Account currency must match the Ledger base currency',
            { field: 'currency' },
          )
        }

        const timestamp = generatedTimestamp(now)
        const account: LedgerAccount = {
          id: generatedId(createId),
          name: request.name,
          type: request.type,
          nature: request.nature,
          openingBalanceMinor: request.openingBalanceMinor,
          openingDate: request.openingDate,
          currency: request.currency,
          note: request.note,
          archivedAt: null,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        repository.insertAccount(account)

        if (!settings.hasCreatedAccount) {
          const markedSettings: LedgerSettings = {
            ...settings,
            hasCreatedAccount: true,
          }
          if (repository.updateSettings({
            settings: markedSettings,
            expectedVersion: settings.version,
          }) !== 1) {
            versionConflict()
          }
        }

        return {
          resultStatus: 'committed',
          responseStatus: 201,
          responseBody: toAccountDto(account),
          resultType: 'account',
          resultId: account.id,
        }
      },
    })
  }

  function patchAccount(id: string, value: unknown): LedgerAccountDto {
    return runLedgerWrite(db, () => {
      requireSettings()
      const account = repository.getAccount(id)
      if (account === null) notFound('Ledger Account')

      const rawRecord = asMutationRecord(value)
      if (account.archivedAt !== null && rawRecord !== null) {
        const allowed = new Set(['expectedVersion', 'name', 'note'])
        if (Object.keys(rawRecord).some((key) => !allowed.has(key))) archivedAccount()
      }

      if (rawRecord !== null) {
        const expectedVersion = parseExpectedVersion(rawRecord)
        assertExpectedVersion(account.version, expectedVersion)
      }
      const patch = parseAccountPatchRequest(value)
      assertExpectedVersion(account.version, patch.expectedVersion)

      const hasHistory = repository.hasAccountHistory(id)
      const financialFields: readonly (keyof LedgerAccountPatchRequest)[] = [
        'type',
        'nature',
        'openingBalanceMinor',
        'openingDate',
      ]
      if (hasHistory && financialFields.some((field) => hasOwn(patch, field))) {
        throw ledgerValidationError(
          'Account financial interpretation fields cannot be changed after transaction history exists',
        )
      }

      const type = patch.type ?? account.type
      const nature = patch.nature ?? account.nature
      assertAccountPair(type, nature)
      const updated: LedgerAccount = {
        ...account,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.note === undefined ? {} : { note: patch.note }),
        type,
        nature,
        ...(patch.openingBalanceMinor === undefined
          ? {}
          : { openingBalanceMinor: patch.openingBalanceMinor }),
        ...(patch.openingDate === undefined ? {} : { openingDate: patch.openingDate }),
        version: nextVersion(account.version),
        updatedAt: generatedTimestamp(now),
      }
      if (repository.updateAccount({ account: updated, expectedVersion: account.version }) !== 1) {
        versionConflict()
      }
      return toAccountDto(updated)
    })
  }

  function deleteAccount(id: string, value: unknown): LedgerDeletedResponse {
    return runLedgerWrite(db, () => {
      requireSettings()
      const account = repository.getAccount(id)
      if (account === null) notFound('Ledger Account')
      const expectedVersion = parseExpectedVersionCommand(value)
      assertExpectedVersion(account.version, expectedVersion)
      if (repository.hasAccountHistory(id)) {
        throw new LedgerError(
          'ledger-account-has-history',
          409,
          'Ledger Account cannot be physically deleted after transaction history exists',
        )
      }
      if (repository.deleteAccount(id) !== 1) versionConflict()
      return { deleted: true, id }
    })
  }

  function archiveAccount(id: string, value: unknown): LedgerAccountDto {
    return runLedgerWrite(db, () => {
      requireSettings()
      const account = repository.getAccount(id)
      if (account === null) notFound('Ledger Account')
      if (account.archivedAt !== null) archivedAccount()
      const expectedVersion = parseExpectedVersionCommand(value)
      assertExpectedVersion(account.version, expectedVersion)

      const currentBalanceMinor = deriveCurrentBalance(
        account,
        repository.listActiveTransactionsForAccount(id),
      )
      if (currentBalanceMinor !== 0) {
        throw new LedgerError(
          'ledger-account-nonzero-balance',
          409,
          'Ledger Account must have a zero current balance before archiving',
          { currentBalanceMinor },
        )
      }

      const timestamp = generatedTimestamp(now)
      const updated: LedgerAccount = {
        ...account,
        archivedAt: timestamp,
        version: nextVersion(account.version),
        updatedAt: timestamp,
      }
      if (repository.updateAccount({ account: updated, expectedVersion: account.version }) !== 1) {
        versionConflict()
      }
      return toAccountDto(updated)
    })
  }

  function restoreAccount(id: string, value: unknown): LedgerAccountDto {
    return runLedgerWrite(db, () => {
      requireSettings()
      const account = repository.getAccount(id)
      if (account === null) notFound('Ledger Account')
      const expectedVersion = parseExpectedVersionCommand(value)
      assertExpectedVersion(account.version, expectedVersion)
      if (account.archivedAt === null) return toAccountDto(account)

      const updated: LedgerAccount = {
        ...account,
        archivedAt: null,
        version: nextVersion(account.version),
        updatedAt: generatedTimestamp(now),
      }
      if (repository.updateAccount({ account: updated, expectedVersion: account.version }) !== 1) {
        versionConflict()
      }
      return toAccountDto(updated)
    })
  }

  function listCategories(
    kind: LedgerCategoryKind | undefined,
    includeArchived: boolean,
  ): LedgerCategoryDto[] {
    requireSettings()
    return repository
      .listCategories({ includeArchived })
      .filter((category) => kind === undefined || category.kind === kind)
      .map(toCategoryDto)
  }

  function createCategory(
    request: LedgerCategoryCreateRequest,
    idempotencyKey: string,
  ): LedgerReplayResult {
    return executeIdempotentLedgerCreate(db, repository, {
      operationScope: LEDGER_IDEMPOTENCY_OPERATION_SCOPES.categories,
      idempotencyKey,
      request,
      mutation: (): LedgerIdempotentResult => {
        requireSettings()
        const normalizedName = normalizeLedgerCategoryName(request.name)
        if (repository.findCategoryByIdentity(request.kind, normalizedName) !== null) {
          duplicateCategory()
        }
        const timestamp = generatedTimestamp(now)
        const category: LedgerCategory = {
          id: generatedId(createId),
          kind: request.kind,
          name: request.name,
          normalizedName,
          archivedAt: null,
          version: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        repository.insertCategory(category)
        return {
          resultStatus: 'committed',
          responseStatus: 201,
          responseBody: toCategoryDto(category),
          resultType: 'category',
          resultId: category.id,
        }
      },
    })
  }

  function patchCategory(id: string, value: unknown): LedgerCategoryDto {
    return runLedgerWrite(db, () => {
      requireSettings()
      const category = repository.getCategory(id)
      if (category === null) notFound('Ledger Category')
      if (category.archivedAt !== null) archivedCategory()

      const rawRecord = asMutationRecord(value)
      if (rawRecord !== null) {
        const expectedVersion = parseExpectedVersion(rawRecord)
        assertExpectedVersion(category.version, expectedVersion)
      }
      const patch = parseCategoryPatchRequest(value)
      assertExpectedVersion(category.version, patch.expectedVersion)

      const hasHistory = repository.hasCategoryHistory(id)
      if (hasHistory && hasOwn(patch, 'kind')) {
        throw ledgerValidationError('Category kind cannot be changed after transaction history exists', {
          field: 'kind',
        })
      }

      const kind = patch.kind ?? category.kind
      const name = patch.name ?? category.name
      const normalizedName = normalizeLedgerCategoryName(name)
      const existing = repository.findCategoryByIdentity(kind, normalizedName)
      if (existing !== null && existing.id !== category.id) duplicateCategory()

      const updated: LedgerCategory = {
        ...category,
        kind,
        name,
        normalizedName,
        version: nextVersion(category.version),
        updatedAt: generatedTimestamp(now),
      }
      if (repository.updateCategory({ category: updated, expectedVersion: category.version }) !== 1) {
        versionConflict()
      }
      return toCategoryDto(updated)
    })
  }

  function deleteCategory(id: string, value: unknown): LedgerDeletedResponse {
    return runLedgerWrite(db, () => {
      requireSettings()
      const category = repository.getCategory(id)
      if (category === null) notFound('Ledger Category')
      const expectedVersion = parseExpectedVersionCommand(value)
      assertExpectedVersion(category.version, expectedVersion)
      if (repository.hasCategoryHistory(id)) {
        throw new LedgerError(
          'ledger-category-has-history',
          409,
          'Ledger Category cannot be physically deleted after transaction history exists',
        )
      }
      if (repository.deleteCategory(id) !== 1) versionConflict()
      return { deleted: true, id }
    })
  }

  function archiveCategory(id: string, value: unknown): LedgerCategoryDto {
    return runLedgerWrite(db, () => {
      requireSettings()
      const category = repository.getCategory(id)
      if (category === null) notFound('Ledger Category')
      if (category.archivedAt !== null) archivedCategory()
      const expectedVersion = parseExpectedVersionCommand(value)
      assertExpectedVersion(category.version, expectedVersion)

      const timestamp = generatedTimestamp(now)
      const updated: LedgerCategory = {
        ...category,
        archivedAt: timestamp,
        version: nextVersion(category.version),
        updatedAt: timestamp,
      }
      if (repository.updateCategory({ category: updated, expectedVersion: category.version }) !== 1) {
        versionConflict()
      }
      return toCategoryDto(updated)
    })
  }

  function restoreCategory(id: string, value: unknown): LedgerCategoryDto {
    return runLedgerWrite(db, () => {
      requireSettings()
      const category = repository.getCategory(id)
      if (category === null) notFound('Ledger Category')
      const expectedVersion = parseExpectedVersionCommand(value)
      assertExpectedVersion(category.version, expectedVersion)
      if (category.archivedAt === null) return toCategoryDto(category)

      const updated: LedgerCategory = {
        ...category,
        archivedAt: null,
        version: nextVersion(category.version),
        updatedAt: generatedTimestamp(now),
      }
      if (repository.updateCategory({ category: updated, expectedVersion: category.version }) !== 1) {
        versionConflict()
      }
      return toCategoryDto(updated)
    })
  }

  return {
    getSettings(): LedgerSettingsDto {
      return toSettingsDto(requireSettings())
    },
    createSettings,
    patchSettings,
    listAccounts,
    getAccount,
    createAccount,
    patchAccount,
    deleteAccount,
    archiveAccount,
    restoreAccount,
    listCategories,
    createCategory,
    patchCategory,
    deleteCategory,
    archiveCategory,
    restoreCategory,
  }
}

export type {
  LedgerAccountPatchRequest,
  LedgerCategoryPatchRequest,
  LedgerSettingsPatchRequest,
}
