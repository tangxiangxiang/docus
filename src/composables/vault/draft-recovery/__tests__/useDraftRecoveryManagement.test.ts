import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { createDraftStore, createMemoryDraftBackend } from '../draftStore'
import type { UnsavedDraft } from '../draftTypes'
import { createUnsavedDraftRecovery } from '../useUnsavedDraftRecovery'
import { createDraftRecoveryManagement } from '../useDraftRecoveryManagement'
import { recoveryRecordId } from '../draftCleanup'
import { createDraftRecoveryOperationProtection } from '../useDraftRecoveryOperationProtection'

function draft(id: string, updatedAt = 1): UnsavedDraft {
  return {
    version: 1, vaultId: 'vault', documentId: id, documentPath: `notes/${id}`,
    content: id, baseContentHash: null, baseModifiedAt: null,
    createdAt: updatedAt, updatedAt,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

async function setup() {
  const store = createDraftStore({ backend: createMemoryDraftBackend() })
  const recovery = createUnsavedDraftRecovery({
    store,
    loadPost: async () => { throw Object.assign(new Error('missing'), { status: 404 }) },
  })
  const protectedIdentities = new Set<string>()
  const openIds = ref<readonly string[]>([])
  const removed: string[][] = []
  const management = createDraftRecoveryManagement({
    store,
    recovery,
    openRecoveryIds: openIds,
    getPersistenceProtection: () => ({ identityIds: protectedIdentities }),
    onRecordsRemoved: (ids) => removed.push([...ids]),
    now: () => 31 * 24 * 60 * 60 * 1000,
  })
  return { store, recovery, management, protectedIdentities, openIds, removed }
}

describe('draft recovery management', () => {
  it('refreshes real inventory and deletes one exact record', async () => {
    const h = await setup()
    await h.store.saveDraft(draft('a'))
    await h.recovery.discover('vault')
    expect(await h.management.refresh('vault')).toBe(true)
    const record = h.management.records.value[0]!
    expect(h.management.capacity.value.recordCount).toBe(1)
    expect((await h.management.deleteRecord(record)).status).toBe('deleted')
    expect(h.management.records.value).toEqual([])
    expect(h.removed).toEqual([[recoveryRecordId(record)]])
  })

  it('protects dirty identities and open recovery tabs', async () => {
    const h = await setup()
    await h.store.saveDraft(draft('a'))
    await h.recovery.discover('vault')
    await h.management.refresh('vault')
    const record = h.management.records.value[0]!
    h.protectedIdentities.add(JSON.stringify(['vault', 'a']))
    expect((await h.management.deleteRecord(record)).status).toBe('protected')
    h.protectedIdentities.clear()
    h.openIds.value = [recoveryRecordId(record)]
    expect((await h.management.deleteRecord(record)).status).toBe('protected')
    expect(await h.store.getDraft('vault', 'a')).not.toBeNull()
  })

  it('keeps cleanup blocked between two concurrent operations for one recovery ID', async () => {
    const store = createDraftStore({ backend: createMemoryDraftBackend() })
    await store.saveDraft(draft('a'))
    const recovery = createUnsavedDraftRecovery({
      store,
      loadPost: async () => { throw Object.assign(new Error('missing'), { status: 404 }) },
    })
    const operations = createDraftRecoveryOperationProtection()
    const management = createDraftRecoveryManagement({
      store,
      recovery,
      openRecoveryIds: computed(() => [...operations.protectedIds.value]),
      getPersistenceProtection: () => ({ identityIds: new Set() }),
      now: () => 31 * 24 * 60 * 60 * 1000,
    })
    await recovery.discover('vault')
    await management.refresh('vault')
    const id = recoveryRecordId(management.records.value[0]!)
    const first = deferred<void>()
    const second = deferred<void>()
    const a = operations.run([id], () => first.promise)
    const b = operations.run([id], () => second.promise)
    first.resolve()
    await a

    const protectedCleanup = await management.cleanupNow()
    expect(protectedCleanup.skippedProtected).toHaveLength(1)
    expect(await store.getDraft('vault', 'a')).not.toBeNull()

    second.resolve()
    await b
    expect((await management.cleanupNow()).deleted).toHaveLength(1)
  })

  it('coalesces cleanup and re-reads real store state', async () => {
    const h = await setup()
    await h.store.saveDraft(draft('a'))
    await h.recovery.discover('vault')
    await h.management.refresh('vault')
    const first = h.management.cleanupNow()
    const second = h.management.cleanupNow()
    expect(second).toBe(first)
    const report = await first
    expect(report.deleted).toHaveLength(1)
    expect(report.after.recordCount).toBe(0)
  })

  it('plans from a fresh Store scan instead of cached Center records', async () => {
    const h = await setup()
    const recent = 31 * 24 * 60 * 60 * 1000 - 1_000
    for (let index = 0; index < 99; index += 1) {
      await h.store.saveDraft(draft(`old-${index}`, recent + index))
    }
    await h.recovery.discover('vault')
    await h.management.refresh('vault')
    for (let index = 0; index < 10; index += 1) {
      await h.store.saveDraft(draft(`cross-${index}`, recent + 100 + index))
    }

    const report = await h.management.cleanupNow()

    expect(report.before.recordCount).toBe(109)
    expect(report.after.recordCount).toBe(100)
    expect(report.deleted).toHaveLength(9)
  })

  it('runs one trailing cleanup pass when requested during an active pass', async () => {
    const baseStore = createDraftStore({ backend: createMemoryDraftBackend() })
    for (let index = 0; index < 101; index += 1) {
      await baseStore.saveDraft(draft(`doc-${index}`, 1_000 + index))
    }
    const recovery = createUnsavedDraftRecovery({
      store: baseStore,
      loadPost: async () => { throw Object.assign(new Error('missing'), { status: 404 }) },
    })
    const gate = deferred<void>()
    let blockDelete = true
    const store = {
      ...baseStore,
      async deleteDraftIfUnchanged(expected: UnsavedDraft) {
        if (blockDelete) {
          blockDelete = false
          await gate.promise
        }
        return baseStore.deleteDraftIfUnchanged(expected)
      },
    }
    const management = createDraftRecoveryManagement({
      store,
      recovery,
      getPersistenceProtection: () => ({ identityIds: new Set() }),
      now: () => 0,
    })
    await recovery.discover('vault')
    await management.refresh('vault')
    const first = management.cleanupNow()
    await vi.waitFor(() => expect(blockDelete).toBe(false))
    await baseStore.saveDraft(draft('arrived-during-cleanup', 10_000))
    const second = management.cleanupNow()
    expect(second).toBe(first)
    gate.resolve()

    const report = await first
    expect(report.deleted).toHaveLength(2)
    expect(report.after.recordCount).toBe(100)
  })

  it('sorts the Center inventory newest first', async () => {
    const h = await setup()
    await h.store.saveDraft(draft('old', 1))
    await h.store.saveDraft(draft('new', 2))
    await h.management.refresh('vault')
    expect(h.management.records.value.map((record) => record.record.documentId))
      .toEqual(['new', 'old'])
  })

  it('fails closed when the cleanup before-scan cannot read inventory', async () => {
    const baseStore = createDraftStore({ backend: createMemoryDraftBackend() })
    await baseStore.saveDraft(draft('a'))
    const recovery = createUnsavedDraftRecovery({ store: baseStore })
    let failInspection = false
    const management = createDraftRecoveryManagement({
      store: {
        ...baseStore,
        inspectVaultRecovery: async (vaultId: string) => failInspection
          ? { status: 'failed' as const }
          : baseStore.inspectVaultRecovery(vaultId),
      },
      recovery,
      getPersistenceProtection: () => ({ identityIds: new Set() }),
    })
    await management.refresh('vault')
    failInspection = true

    const report = await management.cleanupNow()

    expect(report.status).toBe('before-scan-failed')
    expect(report.deleted).toEqual([])
    expect(report.stillOverCapacity).toBe(true)
    expect(await baseStore.getDraft('vault', 'a')).not.toBeNull()
  })

  it('reports an unverified after-scan without hiding completed deletes', async () => {
    const baseStore = createDraftStore({ backend: createMemoryDraftBackend() })
    await baseStore.saveDraft(draft('a'))
    const recovery = createUnsavedDraftRecovery({
      store: baseStore,
      loadPost: async () => { throw Object.assign(new Error('missing'), { status: 404 }) },
    })
    let inspections = 0
    const management = createDraftRecoveryManagement({
      store: {
        ...baseStore,
        inspectVaultRecovery: async (vaultId: string) => {
          inspections += 1
          return inspections === 3
            ? { status: 'failed' as const }
            : baseStore.inspectVaultRecovery(vaultId)
        },
      },
      recovery,
      getPersistenceProtection: () => ({ identityIds: new Set() }),
      now: () => 31 * 24 * 60 * 60 * 1000,
    })
    await recovery.discover('vault')
    await management.refresh('vault')

    const report = await management.cleanupNow()

    expect(report.status).toBe('after-scan-failed')
    expect(report.deleted).toHaveLength(1)
    expect(report.stillOverCapacity).toBe(true)
    expect(await baseStore.getDraft('vault', 'a')).toBeNull()
  })

  it('ignores stale refresh results after dispose', async () => {
    const h = await setup()
    h.management.dispose()
    expect(await h.management.refresh('vault')).toBe(false)
    expect(h.management.records.value).toEqual([])
  })
})
