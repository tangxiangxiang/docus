import { expect, test } from '@playwright/test'

const DATABASE_NAME = 'docus-draft-recovery'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async (databaseName) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Draft database deletion blocked'))
    })
  }, DATABASE_NAME)
})

test('moves a persisted draft to the actual server path without changing its bytes or timestamps', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    const store = createDraftStore()
    const original = {
      version: 1 as const,
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content: 'unsaved browser buffer',
      baseContentHash: 'baseline',
      baseModifiedAt: 10.5,
      createdAt: 10,
      updatedAt: 20,
    }
    await store.saveDraft(original)
    const persistence = createUnsavedDraftPersistence({
      store,
      targetWindow: undefined,
    })
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    const outcomes = await barrier.commitMoves([{
      vaultId: 'vault',
      documentId: 'doc-a',
      fromPath: 'notes/a',
      toPath: 'archive/a-2',
    }])
    const stored = await store.getDraft('vault', 'doc-a')
    await persistence.dispose()
    return { outcomes, stored }
  })

  expect(result.outcomes).toEqual([{
    documentId: 'doc-a',
    oldPath: 'notes/a',
    newPath: 'archive/a-2',
    status: 'moved',
  }])
  expect(result.stored).toEqual({
    version: 1,
    vaultId: 'vault',
    documentId: 'doc-a',
    documentPath: 'archive/a-2',
    content: 'unsaved browser buffer',
    baseContentHash: 'baseline',
    baseModifiedAt: 10.5,
    createdAt: 10,
    updatedAt: 20,
  })
})

test('keeps a newer cross-context IndexedDB record after confirmed delete', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    const first = createDraftStore()
    const second = createDraftStore()
    const makeDraft = (content: string, updatedAt: number) => ({
      version: 1 as const,
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      content,
      baseContentHash: null,
      baseModifiedAt: 10,
      createdAt: 1,
      updatedAt,
    })
    await first.saveDraft(makeDraft('confirmed', 10))
    const persistence = createUnsavedDraftPersistence({
      store: first,
      targetWindow: undefined,
    })
    const barrier = await persistence.prepareFileMutation([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
    }])
    await second.saveDraft(makeDraft('newer context', 11))
    const outcomes = await barrier.commitDeletes([{
      vaultId: 'vault',
      documentId: 'doc-a',
      documentPath: 'notes/a',
      policy: 'discard-confirmed',
    }])
    const stored = await first.getDraft('vault', 'doc-a')
    await persistence.dispose()
    return { outcomes, stored }
  })

  expect(result.outcomes[0]?.status).toBe('stale')
  expect(result.stored?.content).toBe('newer context')
})
