import { computed, readonly, ref, type ComputedRef, type DeepReadonly, type Ref } from 'vue'
import {
  capacitySnapshot,
  conflictRecoveryRecord,
  planDraftCleanup,
  primaryRecoveryRecord,
  recoveryIdentityId,
  recoveryRecordId,
  type DraftCapacitySnapshot,
  type RecoveryRecordRef,
} from './draftCleanup'
import type { DraftConditionalDeleteOutcome, DraftRecoveryInventory, DraftStore } from './draftStore'
import type { DraftCleanupProtection } from './useUnsavedDraftPersistence'
import type { UnsavedDraftRecovery } from './useUnsavedDraftRecovery'
import type { DraftRecoveryDecisionKind } from './draftRecoveryDecision'

export type RecoveryDeleteStatus = DraftConditionalDeleteOutcome['status'] | 'protected'

export interface RecoveryDeleteResult {
  record: RecoveryRecordRef
  status: RecoveryDeleteStatus
}

export interface BulkRecoveryDeleteReport {
  deleted: RecoveryRecordRef[]
  missing: RecoveryRecordRef[]
  stale: RecoveryRecordRef[]
  protected: RecoveryRecordRef[]
  unsupported: RecoveryRecordRef[]
  failed: RecoveryRecordRef[]
}

export interface DraftCleanupReport {
  before: DraftCapacitySnapshot
  after: DraftCapacitySnapshot
  deleted: RecoveryRecordRef[]
  stale: RecoveryRecordRef[]
  skippedProtected: RecoveryRecordRef[]
  unsupportedCount: number
  failed: RecoveryRecordRef[]
  stillOverCapacity: boolean
}

interface ManagementOptions {
  store: DraftStore
  recovery: UnsavedDraftRecovery
  getPersistenceProtection: (vaultId: string) => DraftCleanupProtection
  openRecoveryIds?: Ref<readonly string[]>
  onRecordsRemoved?: (recoveryIds: readonly string[]) => void
  now?: () => number
}

export interface DraftRecoveryManagement {
  records: DeepReadonly<Ref<RecoveryRecordRef[]>>
  capacity: DeepReadonly<Ref<DraftCapacitySnapshot>>
  unsupportedCount: DeepReadonly<Ref<number>>
  loading: DeepReadonly<Ref<boolean>>
  error: DeepReadonly<Ref<string | null>>
  selectedIds: DeepReadonly<Ref<Set<string>>>
  protectedIds: ComputedRef<Set<string>>
  cleanupReport: DeepReadonly<Ref<DraftCleanupReport | null>>
  refresh(vaultId: string): Promise<boolean>
  toggleSelected(recoveryId: string): void
  clearSelection(): void
  deleteRecord(record: RecoveryRecordRef): Promise<RecoveryDeleteResult>
  deleteSelected(): Promise<BulkRecoveryDeleteReport>
  deleteAllUnprotected(): Promise<BulkRecoveryDeleteReport>
  cleanupNow(): Promise<DraftCleanupReport>
  dispose(): void
}

function emptyBulkReport(): BulkRecoveryDeleteReport {
  return {
    deleted: [], missing: [], stale: [], protected: [], unsupported: [], failed: [],
  }
}

export function createDraftRecoveryManagement(
  options: ManagementOptions,
): DraftRecoveryManagement {
  const records = ref<RecoveryRecordRef[]>([])
  const capacity = ref(capacitySnapshot([]))
  const unsupportedCount = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedIds = ref(new Set<string>())
  const activeOperations = ref(new Set<string>())
  const cleanupReport = ref<DraftCleanupReport | null>(null)
  const now = options.now ?? Date.now
  let vaultId = ''
  let generation = 0
  let disposed = false
  let cleanupPromise: Promise<DraftCleanupReport> | null = null

  const protectedIds = computed(() => {
    const result = new Set(activeOperations.value)
    for (const id of options.openRecoveryIds?.value ?? []) result.add(id)
    if (vaultId) {
      const identities = options.getPersistenceProtection(vaultId).identityIds
      for (const record of records.value) {
        if (identities.has(recoveryIdentityId(record))) result.add(recoveryRecordId(record))
      }
    }
    return result
  })

  function inventoryRecords(inventory: DraftRecoveryInventory): RecoveryRecordRef[] {
    return [
      ...inventory.primary.map(primaryRecoveryRecord),
      ...inventory.conflicts.map(conflictRecoveryRecord),
    ]
  }

  async function refresh(nextVaultId: string): Promise<boolean> {
    const currentGeneration = ++generation
    vaultId = nextVaultId
    loading.value = true
    error.value = null
    const outcome = await options.store.inspectVaultRecovery(nextVaultId)
    if (disposed || currentGeneration !== generation || vaultId !== nextVaultId) return false
    loading.value = false
    if (outcome.status === 'failed') {
      error.value = 'inspect-failed'
      return false
    }
    records.value = inventoryRecords(outcome.inventory)
    capacity.value = capacitySnapshot(records.value)
    unsupportedCount.value = outcome.inventory.unsupportedPrimaryCount
      + outcome.inventory.unsupportedConflictCount
    const existing = new Set(records.value.map(recoveryRecordId))
    selectedIds.value = new Set([...selectedIds.value].filter((id) => existing.has(id)))
    return true
  }

  function currentProtected(record: RecoveryRecordRef, includeActive = true): boolean {
    const id = recoveryRecordId(record)
    if (includeActive && activeOperations.value.has(id)) return true
    if ((options.openRecoveryIds?.value ?? []).includes(id)) return true
    return options.getPersistenceProtection(record.record.vaultId).identityIds
      .has(recoveryIdentityId(record))
  }

  async function conditionalDelete(record: RecoveryRecordRef): Promise<RecoveryDeleteResult> {
    const id = recoveryRecordId(record)
    if (currentProtected(record)) return { record, status: 'protected' }
    activeOperations.value = new Set(activeOperations.value).add(id)
    try {
      // Re-read protection immediately before the conditional Store mutation.
      // The operation's own lock is excluded from this second check.
      if (currentProtected(record, false)) {
        return { record, status: 'protected' }
      }
      const outcome = record.source === 'primary'
        ? await options.store.deleteDraftIfUnchanged(record.record)
        : await options.store.deleteConflictDraftIfUnchanged(record.record)
      return { record, status: outcome.status }
    } catch {
      return { record, status: 'failed' }
    } finally {
      const next = new Set(activeOperations.value)
      next.delete(id)
      activeOperations.value = next
    }
  }

  function addResult(report: BulkRecoveryDeleteReport, result: RecoveryDeleteResult): void {
    report[result.status].push(result.record)
  }

  async function deleteMany(targets: readonly RecoveryRecordRef[]): Promise<BulkRecoveryDeleteReport> {
    const report = emptyBulkReport()
    for (const record of targets) addResult(report, await conditionalDelete(record))
    const removedIds = [...report.deleted, ...report.missing].map(recoveryRecordId)
    await refresh(vaultId)
    await options.recovery.discover(vaultId)
    options.onRecordsRemoved?.(removedIds)
    return report
  }

  async function deleteRecord(record: RecoveryRecordRef): Promise<RecoveryDeleteResult> {
    const report = await deleteMany([record])
    const status = (['deleted', 'missing', 'stale', 'protected', 'unsupported', 'failed'] as const)
      .find((candidate) => report[candidate].length > 0) ?? 'failed'
    return { record, status }
  }

  function toggleSelected(recoveryId: string): void {
    const next = new Set(selectedIds.value)
    if (next.has(recoveryId)) next.delete(recoveryId)
    else next.add(recoveryId)
    selectedIds.value = next
  }

  function clearSelection(): void {
    selectedIds.value = new Set()
  }

  async function deleteSelected(): Promise<BulkRecoveryDeleteReport> {
    const wanted = selectedIds.value
    const result = await deleteMany(records.value.filter((record) => wanted.has(recoveryRecordId(record))))
    clearSelection()
    return result
  }

  async function deleteAllUnprotected(): Promise<BulkRecoveryDeleteReport> {
    return deleteMany(records.value.filter((record) => !currentProtected(record)))
  }

  function decisions(): Map<string, DraftRecoveryDecisionKind | 'error' | null> {
    return new Map<string, DraftRecoveryDecisionKind | 'error' | null>(options.recovery.items.value.map((item) => [
      item.recoveryId,
      item.status === 'error' ? 'error' : item.decision?.kind ?? null,
    ]))
  }

  async function runCleanup(): Promise<DraftCleanupReport> {
    const beforeRecords = [...records.value]
    const plan = planDraftCleanup({
      records: beforeRecords,
      decisions: decisions(),
      protectedRecoveryIds: protectedIds.value,
      protectedIdentityIds: options.getPersistenceProtection(vaultId).identityIds,
      now: now(),
    })
    const bulk = await deleteMany(plan.candidates)
    const report: DraftCleanupReport = {
      before: plan.before,
      after: capacity.value,
      deleted: bulk.deleted,
      stale: bulk.stale,
      skippedProtected: plan.skippedProtected,
      unsupportedCount: unsupportedCount.value,
      failed: bulk.failed,
      stillOverCapacity: capacity.value.overCapacity,
    }
    cleanupReport.value = report
    return report
  }

  function cleanupNow(): Promise<DraftCleanupReport> {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = (async () => {
      return runCleanup()
    })().finally(() => {
      cleanupPromise = null
    })
    return cleanupPromise
  }

  function dispose(): void {
    disposed = true
    generation++
  }

  return {
    records: readonly(records),
    capacity: readonly(capacity),
    unsupportedCount: readonly(unsupportedCount),
    loading: readonly(loading),
    error: readonly(error),
    selectedIds: readonly(selectedIds),
    protectedIds,
    cleanupReport: readonly(cleanupReport),
    refresh,
    toggleSelected,
    clearSelection,
    deleteRecord,
    deleteSelected,
    deleteAllUnprotected,
    cleanupNow,
    dispose,
  }
}
