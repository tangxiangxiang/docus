import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createDraftStore, createMemoryDraftBackend } from '../draftStore'
import type { UnsavedDraft } from '../draftTypes'
import { createUnsavedDraftRecovery } from '../useUnsavedDraftRecovery'
import { createDraftRecoveryManagement } from '../useDraftRecoveryManagement'
import { recoveryRecordId } from '../draftCleanup'

function draft(id: string, updatedAt = 1): UnsavedDraft {
  return {
    version: 1, vaultId: 'vault', documentId: id, documentPath: `notes/${id}`,
    content: id, baseContentHash: null, baseModifiedAt: null,
    createdAt: updatedAt, updatedAt,
  }
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

  it('ignores stale refresh results after dispose', async () => {
    const h = await setup()
    h.management.dispose()
    expect(await h.management.refresh('vault')).toBe(false)
    expect(h.management.records.value).toEqual([])
  })
})
