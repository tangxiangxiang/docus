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

test('creates the production schema and persists compound-key records', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const makeDraft = (vaultId: string, documentId: string, updatedAt: number) => ({
      version: 1 as const,
      vaultId,
      documentId,
      documentPath: `notes/${documentId}`,
      content: `${vaultId}:${documentId}`,
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt,
    })

    await store.saveDraft(makeDraft('vault-a', 'same', 20))
    await store.saveDraft(makeDraft('vault-b', 'same', 30))

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('drafts', 'readonly')
    const objectStore = transaction.objectStore('drafts')
    const schema = {
      keyPath: objectStore.keyPath,
      indexes: [...objectStore.indexNames],
    }
    database.close()

    return {
      schema,
      vaultA: await store.listDrafts('vault-a'),
      vaultB: await store.getDraft('vault-b', 'same'),
    }
  }, DATABASE_NAME)

  expect(result.schema).toEqual({
    keyPath: ['vaultId', 'documentId'],
    indexes: ['vaultUpdatedAt'],
  })
  expect(result.vaultA).toHaveLength(1)
  expect(result.vaultA[0]?.vaultId).toBe('vault-a')
  expect(result.vaultB?.content).toBe('vault-b:same')
})

test('keeps both IndexedDB records when an atomic move conflicts', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const makeDraft = (documentId: string, content: string, updatedAt: number) => ({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId,
      documentPath: `notes/${documentId}`,
      content,
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt,
    })

    await store.saveDraft(makeDraft('source', 'source buffer', 40))
    await store.saveDraft(makeDraft('target', 'target buffer', 30))
    const outcome = await store.moveDraft(
      'vault-a',
      'source',
      'target',
      'renamed/target',
    )

    return {
      outcome,
      source: await store.getDraft('vault-a', 'source'),
      target: await store.getDraft('vault-a', 'target'),
    }
  })

  expect(result.outcome).toEqual({ status: 'conflict' })
  expect(result.source?.content).toBe('source buffer')
  expect(result.target?.content).toBe('target buffer')
})

test('persists primary and local conflict recovery candidates in separate IndexedDB stores', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const primary = {
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'a',
      documentPath: 'notes/a',
      content: 'cross-context candidate',
      baseContentHash: null,
      baseModifiedAt: 10,
      createdAt: 10,
      updatedAt: 30,
    }
    const conflict = {
      version: 1 as const,
      conflictId: 'local-conflict',
      vaultId: 'vault-a',
      documentId: 'a',
      documentPath: 'notes/a',
      content: 'local candidate',
      baseContentHash: null,
      baseModifiedAt: 10,
      createdAt: 10,
      updatedAt: 31,
      origin: 'delete-conflict' as const,
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    }
    await store.saveDraft(primary)
    const saved = await store.saveConflictDraft(conflict)
    const replacement = await store.saveConflictDraft({
      ...conflict,
      content: 'must not replace',
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const stores = [...database.objectStoreNames]
    database.close()
    return {
      saved,
      replacement,
      stores,
      primary: await store.getDraft('vault-a', 'a'),
      conflicts: await store.listConflictDrafts('vault-a'),
    }
  }, DATABASE_NAME)

  expect(result.saved).toEqual({ status: 'saved' })
  expect(result.replacement).toEqual({ status: 'failed' })
  expect(result.stores).toEqual(['draftConflicts', 'drafts'])
  expect(result.primary?.content).toBe('cross-context candidate')
  expect(result.conflicts).toHaveLength(1)
  expect(result.conflicts[0]?.content).toBe('local candidate')
})

test('atomically keeps a newer draft when conditional deletion is stale', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const original = {
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'a',
      documentPath: 'notes/a',
      content: 'v1',
      baseContentHash: null,
      baseModifiedAt: 10,
      createdAt: 10,
      updatedAt: 20,
    }
    const newer = { ...original, content: 'v2', updatedAt: 30 }
    await store.saveDraft(original)
    await store.saveDraft(newer)

    return {
      outcome: await store.deleteDraftIfUnchanged(original),
      current: await store.getDraft('vault-a', 'a'),
    }
  })

  expect(result.outcome).toEqual({ status: 'stale' })
  expect(result.current).toMatchObject({ content: 'v2', updatedAt: 30 })
})

test('does not adopt or rewrite a newer cross-context recovery draft', async ({
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
      vaultId: 'vault-a',
      documentId: 'a',
      documentPath: 'notes/a',
      content: 'v1',
      baseContentHash: null,
      baseModifiedAt: 10,
      createdAt: 10,
      updatedAt: 20,
    }
    await store.saveDraft(original)
    await store.saveDraft({ ...original, content: 'v2', updatedAt: 30 })
    const persistence = createUnsavedDraftPersistence({ store })
    const owner = await persistence.adoptRecoveredDraft(original, {
      vaultId: 'vault-a',
      documentId: 'a',
      documentPath: 'notes/a',
      content: 'v1',
      authoritativeContent: 'disk',
      baseContentHash: null,
      baseModifiedAt: 10,
      revision: 1,
    })
    await persistence.dispose()

    return {
      owner,
      current: await store.getDraft('vault-a', 'a'),
    }
  })

  expect(result.owner).toBeNull()
  expect(result.current).toMatchObject({ content: 'v2', updatedAt: 30 })
})

test('does not rewrite unsupported records in IndexedDB', async ({ page }) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const validDraft = {
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'seed',
      documentPath: 'notes/seed',
      content: 'seed',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    }
    await store.saveDraft(validDraft)

    const future = {
      ...validDraft,
      version: 2,
      documentId: 'future',
      documentPath: 'notes/future',
      content: 'future buffer',
    }
    const corrupt = {
      ...validDraft,
      documentId: 'target',
      documentPath: 'notes/target',
      content: 42,
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const write = database.transaction('drafts', 'readwrite')
    write.objectStore('drafts').put(future)
    write.objectStore('drafts').put(corrupt)
    await new Promise<void>((resolve, reject) => {
      write.oncomplete = () => resolve()
      write.onerror = () => reject(write.error)
      write.onabort = () => reject(write.error)
    })

    const source = {
      ...validDraft,
      documentId: 'source',
      documentPath: 'notes/source',
      content: 'source buffer',
      updatedAt: 30,
    }
    await store.saveDraft(source)
    const saved = await store.saveDraft({
      ...validDraft,
      documentId: 'future',
      documentPath: 'notes/future',
      content: 'current buffer',
      updatedAt: 40,
    })
    const moved = await store.moveDraft(
      'vault-a',
      'source',
      'target',
      'renamed/target',
    )
    const deleted = await store.deleteDraft('vault-a', 'future')
    const cleared = await store.clearVaultDrafts('vault-a')

    const read = database.transaction('drafts', 'readonly').objectStore('drafts')
    const readRecord = (key: IDBValidKey) => new Promise<unknown>((resolve, reject) => {
      const request = read.get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const [rawFuture, rawTarget, rawSource] = await Promise.all([
      readRecord(['vault-a', 'future']),
      readRecord(['vault-a', 'target']),
      readRecord(['vault-a', 'source']),
    ])
    database.close()

    return {
      saved,
      moved,
      deleted,
      cleared,
      rawFuture,
      rawTarget,
      rawSource,
    }
  }, DATABASE_NAME)

  expect(result.saved).toEqual({
    status: 'unsupported',
    familyPath: 'notes/future',
    reason: 'unsupported-primary',
  })
  expect(result.moved).toEqual({ status: 'unsupported' })
  expect(result.deleted).toEqual({ status: 'unsupported' })
  expect(result.cleared).toBe(true)
  expect(result.rawFuture).toMatchObject({ version: 2, content: 'future buffer' })
  expect(result.rawTarget).toMatchObject({ content: 42 })
  expect(result.rawSource).toBeUndefined()
})

test('keeps the family intact when any row is unsupported in IndexedDB', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const makeConflict = (conflictId: string, content: string) => ({
      version: 1 as const,
      conflictId,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content,
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 31,
      origin: 'delete-conflict' as const,
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    await store.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'primary buffer',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
    await store.saveConflictDraft(makeConflict('conflict-a', 'local orphan'))

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const putRaw = (storeName: string, value: unknown) => new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(value)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    const deleteRaw = (storeName: string, key: IDBValidKey) => new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    // A future-version conflict row for the same identity, seeded
    // behind the store's validation.
    await putRaw('draftConflicts', {
      ...makeConflict('conflict-future', 'future data'),
      version: 2,
    })

    const futureConflictBlocks = await store.moveDraftFamily('vault-a', 'doc', 'archive/doc')
    const primaryAfterBlockedMove = await store.getDraft('vault-a', 'doc')
    const conflictsAfterBlockedMove = await store.listConflictDrafts('vault-a')

    // Now corrupt the primary instead: an unsupported primary must
    // leave the valid conflict on the old path with it.
    await deleteRaw('draftConflicts', ['vault-a', 'doc', 'conflict-future'])
    await putRaw('drafts', {
      version: 2,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'future primary data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 40,
    })
    const futurePrimaryBlocks = await store.moveDraftFamily('vault-a', 'doc', 'archive/doc')
    const conflictsAfterPrimaryBlocked = await store.listConflictDrafts('vault-a')
    database.close()

    return {
      futureConflictBlocks,
      primaryPathAfterBlockedMove: primaryAfterBlockedMove?.documentPath ?? null,
      conflictPathsAfterBlockedMove: conflictsAfterBlockedMove.map((c) => c.documentPath),
      futurePrimaryBlocks,
      conflictPathsAfterPrimaryBlocked: conflictsAfterPrimaryBlocked.map((c) => c.documentPath),
    }
  }, DATABASE_NAME)

  // The future-version conflict blocks the WHOLE family move — the
  // primary and the valid conflict both stay on the old path (a
  // partial migration would strand the unreadable row behind).
  expect(result.futureConflictBlocks).toEqual({ status: 'unsupported', movedConflicts: 0 })
  expect(result.primaryPathAfterBlockedMove).toBe('notes/doc')
  expect(result.conflictPathsAfterBlockedMove).toEqual(['notes/doc'])
  // An unsupported primary likewise keeps its valid conflict with it.
  expect(result.futurePrimaryBlocks).toEqual({ status: 'unsupported', movedConflicts: 0 })
  expect(result.conflictPathsAfterPrimaryBlocked).toEqual(['notes/doc'])
})

test('blocks a primary save in IndexedDB when a same-identity conflict row is unsupported', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const makeDraft = (content: string, updatedAt: number) => ({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content,
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt,
    })
    await store.saveDraft(makeDraft('primary v1', 20))

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    // Seed a future-version conflict row for the SAME identity behind
    // the store's validation.
    const seed = database.transaction('draftConflicts', 'readwrite')
    seed.objectStore('draftConflicts').put({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onerror = () => reject(seed.error)
      seed.onabort = () => reject(seed.error)
    })

    // The plain primary save must be blocked while the unreadable
    // conflict row survives for the same identity — otherwise the
    // primary would be updated while the row stays invisible to
    // Recovery.
    const blocked = await store.saveDraft(makeDraft('primary v2', 40))
    const primaryAfterBlocked = await store.getDraft('vault-a', 'doc')

    // Remove the invalid row; the identical save then succeeds.
    const cleanup = database.transaction('draftConflicts', 'readwrite')
    cleanup.objectStore('draftConflicts').delete(['vault-a', 'doc', 'conflict-future'])
    await new Promise<void>((resolve, reject) => {
      cleanup.oncomplete = () => resolve()
      cleanup.onerror = () => reject(cleanup.error)
      cleanup.onabort = () => reject(cleanup.error)
    })
    database.close()
    const retry = await store.saveDraft(makeDraft('primary v2', 40))

    return {
      blocked,
      primaryAfterBlocked,
      retry,
      primaryAfterRetry: await store.getDraft('vault-a', 'doc'),
    }
  }, DATABASE_NAME)

  expect(result.blocked).toEqual({
    status: 'unsupported',
    familyPath: 'notes/doc',
    reason: 'unsupported-conflict',
  })
  // The primary record is byte-identical — never overwritten.
  expect(result.primaryAfterBlocked).toMatchObject({
    content: 'primary v1',
    updatedAt: 20,
  })
  expect(result.retry.status).toBe('saved')
  expect(result.primaryAfterRetry).toMatchObject({ content: 'primary v2' })
})

test('reports the family path for an unsupported conflict-only family in IndexedDB', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    // Establish the schema before seeding raw rows behind the
    // store's validation.
    await store.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'seed',
      documentPath: 'notes/seed',
      content: 'seed',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    // Conflict-only family for identity 'doc': one future-version row
    // the store cannot validate, sitting at archive/doc. No primary
    // record exists.
    const seed = database.transaction('draftConflicts', 'readwrite')
    seed.objectStore('draftConflicts').put({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onerror = () => reject(seed.error)
      seed.onabort = () => reject(seed.error)
    })
    database.close()

    // A stale Tab saves at notes/doc.
    const saved = await store.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'stale tab buffer',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 40,
    })
    return {
      saved,
      primaryAfter: await store.getDraft('vault-a', 'doc'),
      conflicts: await store.listConflictDrafts('vault-a'),
    }
  }, DATABASE_NAME)

  // The save is blocked by the unreadable row, but the outcome
  // reports the family's real path (the raw row's readable
  // documentPath) so the caller pins its candidate ON the family
  // instead of creating one at the stale snapshot path — a candidate
  // at notes/doc would split the conflict-only family.
  expect(result.saved).toEqual({
    status: 'unsupported',
    familyPath: 'archive/doc',
    reason: 'unsupported-conflict',
  })
  // No primary record created at the stale path, no candidate written
  // by the store itself.
  expect(result.primaryAfter).toBeNull()
  expect(result.conflicts).toEqual([])
})

test('reports no family path for a split unsupported family in IndexedDB', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    await store.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'seed',
      documentPath: 'notes/seed',
      content: 'seed',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    // Same identity, two raw rows DISAGREEING on the path — one
    // unreadable at archive/doc, one valid at legacy/doc. The family
    // location is indeterminate.
    const seed = database.transaction('draftConflicts', 'readwrite')
    seed.objectStore('draftConflicts').put({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 31,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    seed.objectStore('draftConflicts').put({
      version: 1,
      conflictId: 'conflict-valid',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'legacy/doc',
      content: 'valid data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 32,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 30,
      recordedAt: 32,
    })
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onerror = () => reject(seed.error)
      seed.onabort = () => reject(seed.error)
    })
    database.close()

    const saved = await store.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'stale tab buffer',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 40,
    })
    return {
      saved,
      primaryAfter: await store.getDraft('vault-a', 'doc'),
      conflicts: await store.listConflictDrafts('vault-a'),
    }
  }, DATABASE_NAME)

  // The rows disagree — familyPath is null so the caller fails closed
  // instead of creating a candidate at its stale snapshot path (or
  // guessing a family side).
  expect(result.saved).toEqual({
    status: 'unsupported',
    familyPath: null,
    reason: 'split-conflict-paths',
  })
  expect(result.primaryAfter).toBeNull()
  // Only the valid row is discoverable, untouched.
  expect(result.conflicts).toHaveLength(1)
  expect(result.conflicts[0]).toMatchObject({
    conflictId: 'conflict-valid',
    documentPath: 'legacy/doc',
  })
})

test('persists the quarantine retry candidate at the family path in real IndexedDB', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    const store = createDraftStore()
    // A valid primary draft — the family lives at notes/doc.
    await store.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
    // A future-version conflict row for the same identity: readable
    // path notes/doc (the family still agrees), but the store cannot
    // validate it — the family move's pre-flight blocks the WHOLE
    // move instead of stranding this row on the pre-rename path.
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const seed = database.transaction('draftConflicts', 'readwrite')
    seed.objectStore('draftConflicts').put({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 25,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 20,
      recordedAt: 25,
    })
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onerror = () => reject(seed.error)
      seed.onabort = () => reject(seed.error)
    })
    database.close()

    const persistence = createUnsavedDraftPersistence({ store })
    const identity = {
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
    }
    const barrier = await persistence.prepareFileMutation([identity])
    // The server rename succeeded; the draft family move is blocked
    // by the unreadable row — the entry quarantines on oldPath.
    const [move] = await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/doc',
      toPath: 'archive/doc',
    }])
    await barrier.finalizeAfterTabMigration()

    // The post-rename edit arrives on the Tab's new path. flush routes
    // it through the unified write target: quarantine retry first —
    // blocked again — then the latest bytes persist as a candidate at
    // the family's ACTUAL path notes/doc, never at the Tab path.
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'after-rename',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 2,
    })
    const flushed = await persistence.flush('vault-a', 'doc')
    const primary = await store.getDraft('vault-a', 'doc')
    const conflicts = await store.listConflictDrafts('vault-a')
    await persistence.dispose()

    return { moveStatus: move.status, flushed, primary, conflicts }
  }, DATABASE_NAME)

  expect(result.moveStatus).toBe('unsupported')
  // The candidate persisted at the family path — the bytes are durable
  // and flush reports clean (the quarantine stays armed for the next
  // move attempt).
  expect(result.flushed).toBe(true)
  // The primary record never moved: the family is whole at notes/doc.
  expect(result.primary).toMatchObject({
    documentPath: 'notes/doc',
    content: 'primary',
  })
  // Exactly one discoverable candidate (the future row stays invisible
  // to the validated listing): the quarantine retry's record, pinned
  // at the family path — not at the renamed Tab path.
  expect(result.conflicts).toHaveLength(1)
  expect(result.conflicts[0]).toMatchObject({
    documentPath: 'notes/doc',
    content: 'after-rename',
    origin: 'move-conflict',
  })
})

test('re-pins a conflict candidate when the family moves in another IndexedDB context', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    // Context A: a stale tab edits against a newer cross-context
    // primary — the write pins the conflict channel at notes/doc.
    const storeA = createDraftStore()
    await storeA.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'remote',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 110,
    })
    const persistence = createUnsavedDraftPersistence({
      store: storeA,
      now: () => 100,
    })
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'local-edit',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 1,
    })
    const firstFlush = await persistence.flush('vault-a', 'doc')

    // Context B (a second store over the SAME IndexedDB) moves the
    // whole family notes/doc → archive/doc in one atomic transaction.
    const storeB = createDraftStore()
    const moved = await storeB.moveDraftFamily('vault-a', 'doc', 'archive/doc')

    // Context A's next edit still carries the stale snapshot path.
    // The family-atomic candidate write must detect the moved family:
    // re-pin without writing (flush #1), then persist at archive/doc
    // (flush #2) — never strand a candidate at notes/doc.
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'local-edit-2',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 2,
    })
    const repinFlush = await persistence.flush('vault-a', 'doc')
    const midConflicts = await storeA.listConflictDrafts('vault-a')
    const persistFlush = await persistence.flush('vault-a', 'doc')
    const primary = await storeA.getDraft('vault-a', 'doc')
    const conflicts = await storeA.listConflictDrafts('vault-a')
    await persistence.dispose()
    return {
      firstFlush,
      moved,
      repinFlush,
      midConflicts,
      persistFlush,
      primary,
      conflicts,
    }
  }, DATABASE_NAME)

  // The stale handoff persists 'local-edit' as a candidate and pins
  // the conflict channel — but reports false BY DESIGN: the bytes are
  // durable as a candidate, not as the primary record, so a close seal
  // keeps the tab open. The pin itself is proven by what follows.
  expect(result.firstFlush).toBe(false)
  expect(result.moved).toMatchObject({ status: 'moved', movedConflicts: 1 })
  // The re-pin attempt persists nothing — the family still has exactly
  // one candidate, at the moved path.
  expect(result.repinFlush).toBe(false)
  expect(result.midConflicts).toHaveLength(1)
  expect(result.midConflicts[0]).toMatchObject({
    content: 'local-edit',
    documentPath: 'archive/doc',
  })
  // The re-pinned write then lands at the family's new path: every
  // readable row of the identity shares archive/doc.
  expect(result.persistFlush).toBe(true)
  expect(result.primary).toMatchObject({
    documentPath: 'archive/doc',
    content: 'remote',
  })
  expect(result.conflicts).toHaveLength(2)
  expect(result.conflicts.every((c) => c.documentPath === 'archive/doc')).toBe(true)
  expect(result.conflicts.map((c) => c.content).sort())
    .toEqual(['local-edit', 'local-edit-2'])
})

test('refuses a diverging first primary save for a conflict-only family in IndexedDB', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const makeDraft = (documentPath: string, updatedAt: number) => ({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath,
      content: `primary at ${documentPath}`,
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt,
    })
    // Conflict-only family at archive/doc — no primary record.
    await store.saveConflictDraft({
      version: 1 as const,
      conflictId: 'conflict-orphan',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'orphan at archive',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 31,
      origin: 'delete-conflict' as const,
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })

    // A first write at a DIVERGING path must not create the primary
    // there (that would split the family); the outcome anchors on the
    // newest candidate so the caller can pin its content to the
    // family path.
    const mismatch = await store.saveDraft(makeDraft('notes/doc', 40))
    const primaryAfterMismatch = await store.getDraft('vault-a', 'doc')

    // A first write at the family's path unites the family.
    const unite = await store.saveDraft(makeDraft('archive/doc', 40))
    const primaryAfterUnite = await store.getDraft('vault-a', 'doc')
    const conflicts = await store.listConflictDrafts('vault-a')

    return {
      mismatch,
      primaryAfterMismatch,
      uniteStatus: unite.status,
      primaryAfterUnite,
      conflictPaths: conflicts.map((c) => c.documentPath),
    }
  })

  expect(result.mismatch.status).toBe('path-mismatch')
  if (result.mismatch.status === 'path-mismatch') {
    expect(result.mismatch.current).toMatchObject({
      conflictId: 'conflict-orphan',
      documentPath: 'archive/doc',
    })
  }
  expect(result.primaryAfterMismatch).toBeNull()
  expect(result.uniteStatus).toBe('saved')
  expect(result.primaryAfterUnite).toMatchObject({
    documentPath: 'archive/doc',
    content: 'primary at archive/doc',
  })
  expect(result.conflictPaths).toEqual(['archive/doc'])
})

test('reports unsupported from the strict conflict read on an unreadable identity row', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const makeConflict = (conflictId: string, documentId: string, content: string) => ({
      version: 1 as const,
      conflictId,
      vaultId: 'vault-a',
      documentId,
      documentPath: `notes/${documentId}`,
      content,
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 31,
      origin: 'delete-conflict' as const,
      crossContextUpdatedAt: 30,
      recordedAt: 31,
    })
    await store.saveConflictDraft(makeConflict('conflict-a', 'doc', 'local orphan'))
    await store.saveConflictDraft(makeConflict('conflict-b', 'other', 'other orphan'))

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const putRaw = (storeName: string, value: unknown) => new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(value)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    // A future-version conflict row for the SAME identity, seeded
    // behind the store's validation — exactly what a newer app version
    // could leave behind.
    await putRaw('draftConflicts', {
      ...makeConflict('conflict-future', 'doc', 'future data'),
      version: 2,
    })

    const scopedUnsupported = await store.listConflictDraftsStrict('vault-a', 'doc')
    const scopedClean = await store.listConflictDraftsStrict('vault-a', 'other')
    const lossy = await store.listConflictDrafts('vault-a')
    database.close()

    return {
      scopedUnsupported,
      scopedClean,
      lossyContents: lossy.map((c) => c.content).sort(),
    }
  }, DATABASE_NAME)

  // The same-identity unreadable row makes the strict read refuse to
  // certify the conflict state — a confirmed delete on top of it must
  // report 'unsupported' (identity kept visible) instead of silently
  // filtering the row behind an empty list.
  expect(result.scopedUnsupported).toEqual({ status: 'unsupported' })
  // A clean identity in the same vault still reads ok, scoped.
  expect(result.scopedClean).toEqual({
    status: 'ok',
    records: [expect.objectContaining({ conflictId: 'conflict-b', content: 'other orphan' })],
  })
  // Discovery keeps the lossy filtering (best-effort by nature).
  expect(result.lossyContents).toEqual(['local orphan', 'other orphan'])
})

test('closes a cached connection when another context upgrades the database', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    await store.saveDraft({
      version: 1,
      vaultId: 'vault-a',
      documentId: 'a',
      documentPath: 'notes/a',
      content: 'buffer',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })

    const upgraded = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 3)
      request.onsuccess = () => {
        const version = request.result.version
        request.result.close()
        resolve(version)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Cached connection blocked upgrade'))
    })

    return {
      upgraded,
      oldStoreFailsClosed: await store.listDrafts('vault-a'),
    }
  }, DATABASE_NAME)

  expect(result).toEqual({
    upgraded: 3,
    oldStoreFailsClosed: [],
  })
})

test('does not leak a late connection after a blocked open', async ({ page }) => {
  const result = await page.evaluate(async (databaseName) => {
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    let lateOpen: IDBOpenDBRequest | null = null
    const upgradeFactory = {
      open(name: string) {
        lateOpen = indexedDB.open(name, 2)
        return lateOpen
      },
    } as IDBFactory

    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore({ indexedDB: upgradeFactory })
    const listed = await store.listDrafts('vault-a')

    const lateSettled = new Promise<void>((resolve) => {
      lateOpen!.addEventListener('success', () => resolve(), { once: true })
      lateOpen!.addEventListener('error', () => resolve(), { once: true })
    })
    blocker.close()
    await lateSettled

    const deletion = await new Promise<'deleted' | 'blocked'>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve('deleted')
      request.onerror = () => reject(request.error)
      request.onblocked = () => resolve('blocked')
    })

    return { listed, deletion }
  }, DATABASE_NAME)

  expect(result).toEqual({
    listed: [],
    deletion: 'deleted',
  })
})

test('fails safely when opening the production database fails', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 3)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.close()

    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const store = createDraftStore()
    const draft = {
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'a',
      documentPath: 'notes/a',
      content: 'buffer',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    }

    return {
      saved: await store.saveDraft(draft),
      listed: await store.listDrafts('vault-a'),
      moved: await store.moveDraft('vault-a', 'a', 'x', 'notes/x'),
    }
  }, DATABASE_NAME)

  expect(result).toEqual({
    saved: { status: 'failed' },
    listed: [],
    moved: { status: 'failed' },
  })
})

test('a stale quarantine retry in a second IndexedDB context adopts the certified current path', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    // Context A's family lives at notes/doc.
    const storeA = createDraftStore()
    await storeA.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
    // A future-version conflict row blocks context A's family move
    // (the store fails the WHOLE move closed) — the server rename
    // notes/doc→archive/doc succeeds, the entry quarantines on
    // familyPath notes/doc.
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const seed = database.transaction('draftConflicts', 'readwrite')
    seed.objectStore('draftConflicts').put({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 25,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 20,
      recordedAt: 25,
    })
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onerror = () => reject(seed.error)
      seed.onabort = () => reject(seed.error)
    })

    const persistence = createUnsavedDraftPersistence({
      store: storeA,
      now: () => 100,
    })
    const identity = {
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
    }
    const barrier = await persistence.prepareFileMutation([identity])
    const [move] = await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/doc',
      toPath: 'archive/doc',
    }])
    await barrier.finalizeAfterTabMigration()

    // The blocking row disappears; context B (a second store over the
    // SAME IndexedDB) then renames archive/doc→final/doc and moves
    // the family there in one transaction.
    const unblock = database.transaction('draftConflicts', 'readwrite')
    unblock.objectStore('draftConflicts')
      .delete(['vault-a', 'doc', 'conflict-future'])
    await new Promise<void>((resolve, reject) => {
      unblock.oncomplete = () => resolve()
      unblock.onerror = () => reject(unblock.error)
      unblock.onabort = () => reject(unblock.error)
    })
    database.close()
    const storeB = createDraftStore()
    const movedByB = await storeB.moveDraftFamily('vault-a', 'doc', 'final/doc')

    // Context A's stale quarantine retry fires via flush — it must
    // NOT drag the family back from final/doc to its old server
    // target archive/doc.
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'after-rename',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 2,
    })
    const flushed = await persistence.flush('vault-a', 'doc')
    const primary = await storeA.getDraft('vault-a', 'doc')
    const conflicts = await storeA.listConflictDrafts('vault-a')

    // Every raw row of the identity — including rows invisible to the
    // validated listing — must sit at the certified current path.
    const rawDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rawTransaction = rawDatabase.transaction(
      ['drafts', 'draftConflicts'],
      'readonly',
    )
    const rawDrafts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('drafts').getAll()
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    const rawConflicts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('draftConflicts')
        .index('vaultId').getAll('vault-a')
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    rawDatabase.close()
    await persistence.dispose()

    return {
      moveStatus: move.status,
      movedByB,
      flushed,
      primary,
      conflicts,
      rawDraftPaths: rawDrafts.map((row) => (row as { documentPath: string }).documentPath),
      rawConflictPaths: rawConflicts.map((row) => (row as { documentPath: string }).documentPath),
    }
  }, DATABASE_NAME)

  expect(result.moveStatus).toBe('unsupported')
  expect(result.movedByB).toMatchObject({ status: 'moved' })
  // The stale retry persisted A's bytes (as a candidate) and reported
  // clean — without moving the family.
  expect(result.flushed).toBe(true)
  // The primary record stays exactly where context B's verified
  // rename put it — never dragged back to the quarantine's old
  // server target archive/doc.
  expect(result.primary).toMatchObject({
    documentPath: 'final/doc',
    content: 'primary',
  })
  // A's bytes are durable as a move-conflict candidate at the
  // certified current path.
  expect(result.conflicts).toHaveLength(1)
  expect(result.conflicts[0]).toMatchObject({
    documentPath: 'final/doc',
    content: 'after-rename',
    origin: 'move-conflict',
  })
  // The raw stores agree: the whole identity lives at final/doc.
  expect(result.rawDraftPaths).toEqual(['final/doc'])
  expect(result.rawConflictPaths).toEqual(['final/doc'])
})

test('a stale move-indeterminate retry in a second IndexedDB context adopts the certified current path', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    const storeA = createDraftStore()
    // Open the production database (creating both stores) before the
    // raw seeding transaction below opens it directly.
    await storeA.listDrafts('vault-a')
    // A split, partly unreadable family: no certified path exists.
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const seed = database.transaction('draftConflicts', 'readwrite')
    const conflictStore = seed.objectStore('draftConflicts')
    conflictStore.put({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 25,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 20,
      recordedAt: 25,
    })
    conflictStore.put({
      version: 1,
      conflictId: 'conflict-valid',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'legacy/doc',
      content: 'older local',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 22,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 20,
      recordedAt: 22,
    })
    await new Promise<void>((resolve, reject) => {
      seed.oncomplete = () => resolve()
      seed.onerror = () => reject(seed.error)
      seed.onabort = () => reject(seed.error)
    })

    const persistence = createUnsavedDraftPersistence({
      store: storeA,
      now: () => 100,
    })
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'stale-edit',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 1,
    })
    const staleFlush = await persistence.flush('vault-a', 'doc')

    // Server rename succeeds, draft move is blocked → move-indeterminate
    // (the family path was never certified).
    const identity = {
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
    }
    const barrier = await persistence.prepareFileMutation([identity])
    const [move] = await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/doc',
      toPath: 'archive/doc',
    }])
    const finalized = await barrier.finalizeAfterTabMigration()
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'after-rename',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 2,
    })
    const blockedFlush = await persistence.flush('vault-a', 'doc')

    // The unreadable row disappears and context B moves the family to
    // final/doc — NOT the stale server target archive/doc.
    const unblock = database.transaction('draftConflicts', 'readwrite')
    unblock.objectStore('draftConflicts')
      .delete(['vault-a', 'doc', 'conflict-future'])
    await new Promise<void>((resolve, reject) => {
      unblock.oncomplete = () => resolve()
      unblock.onerror = () => reject(unblock.error)
      unblock.onabort = () => reject(unblock.error)
    })
    database.close()
    const storeB = createDraftStore()
    const movedByB = await storeB.moveDraftFamily('vault-a', 'doc', 'final/doc')

    // Context A's stale retry must re-verify the family FIRST: it
    // finds the certified current path final/doc ≠ serverPath
    // archive/doc, moves NOTHING, and persists A's bytes as a
    // candidate at final/doc.
    const flushed = await persistence.flush('vault-a', 'doc')
    const primary = await storeA.getDraft('vault-a', 'doc')
    const conflicts = await storeA.listConflictDrafts('vault-a')

    const rawDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const rawTransaction = rawDatabase.transaction(
      ['drafts', 'draftConflicts'],
      'readonly',
    )
    const rawDrafts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('drafts').getAll()
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    const rawConflicts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('draftConflicts')
        .index('vaultId').getAll('vault-a')
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    rawDatabase.close()
    await persistence.dispose()

    return {
      staleFlush,
      moveStatus: move.status,
      finalized,
      blockedFlush,
      movedByB,
      flushed,
      primary,
      conflicts,
      rawDraftCount: rawDrafts.length,
      rawConflictPaths: rawConflicts
        .map((row) => (row as { documentPath: string }).documentPath)
        .sort(),
    }
  }, DATABASE_NAME)

  expect(result.staleFlush).toBe(false)
  expect(result.moveStatus).toBe('unsupported')
  expect(result.finalized).toEqual([{
    documentId: 'doc',
    oldPath: 'notes/doc',
    newPath: 'archive/doc',
    status: 'failed',
  }])
  expect(result.blockedFlush).toBe(false)
  expect(result.movedByB).toMatchObject({ status: 'missing' })
  // The stale retry persisted A's bytes and reported clean — without
  // blind-moving the family toward the stale server target.
  expect(result.flushed).toBe(true)
  // No primary record was minted anywhere — the family is conflict-only
  // and lives at B's certified path.
  expect(result.primary).toBeNull()
  expect(result.conflicts).toHaveLength(2)
  expect(result.conflicts.every((c) => c.documentPath === 'final/doc')).toBe(true)
  expect(result.conflicts.find((c) => c.content === 'after-rename')).toMatchObject({
    documentPath: 'final/doc',
    origin: 'move-conflict',
  })
  // The raw stores agree: no primary row, both candidates at final/doc.
  expect(result.rawDraftCount).toBe(0)
  expect(result.rawConflictPaths).toEqual(['final/doc', 'final/doc'])
})

test('a quarantine retry whose CAS fails discards the stale serverPath when the fallback candidate meets path-mismatch', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    // Context A's family lives at notes/doc.
    const storeA = createDraftStore()
    await storeA.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
    // A future-version conflict row at the family path makes every
    // CAS move 'unsupported' (the transaction validates the whole
    // family) while the raw-path candidate authority can still LOCATE
    // the path — the exact split that forces the retry down the
    // fallback-candidate branch in real IndexedDB.
    const openRaw = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const runTx = (
      database: IDBDatabase,
      mutate: (store: IDBObjectStore) => void,
    ) => new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('draftConflicts', 'readwrite')
      mutate(transaction.objectStore('draftConflicts'))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    const database = await openRaw()
    await runTx(database, (store) => store.put({
      version: 2,
      conflictId: 'conflict-future',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 25,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 20,
      recordedAt: 25,
    }))

    const persistence = createUnsavedDraftPersistence({
      store: storeA,
      now: () => 100,
    })
    const identity = {
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
    }
    // Server rename notes/doc→archive/doc succeeds, draft family move
    // is unsupported → quarantine{familyPath notes/doc, serverPath
    // archive/doc}.
    const barrier = await persistence.prepareFileMutation([identity])
    const [move] = await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/doc',
      toPath: 'archive/doc',
    }])
    await barrier.finalizeAfterTabMigration()

    // The first stale retry: the CAS comes back 'unsupported' (the
    // future row) and the fallback candidate JOINS the family at
    // notes/doc — the retry reports clean, quarantine intact.
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'after-rename',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 2,
    })
    const flushed1 = await persistence.flush('vault-a', 'doc')

    // The blocker disappears; context B completes archive/doc→final/doc
    // and moves the whole family (primary + A's candidate) there.
    await runTx(database, (store) => store
      .delete(['vault-a', 'doc', 'conflict-future']))
    database.close()
    const storeB = createDraftStore()
    const movedByB = await storeB.moveDraftFamily('vault-a', 'doc', 'final/doc')
    // A fresh unreadable row at final/doc keeps the NEXT CAS
    // 'unsupported' while the candidate authority still certifies
    // final/doc — so the retry's fallback candidate write at the
    // stale oldPath notes/doc meets path-mismatch with the family's
    // certified CURRENT path.
    const database2 = await openRaw()
    await runTx(database2, (store) => store.put({
      version: 2,
      conflictId: 'conflict-blocker',
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'final/doc',
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 25,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 20,
      recordedAt: 25,
    }))
    database2.close()

    // The second stale retry: CAS 'unsupported' AGAIN, fallback
    // candidate at notes/doc → path-mismatch(final/doc). The stale
    // serverPath archive/doc must now be DISCARDED: A's bytes persist
    // as a candidate at final/doc and the entry pins to the conflict
    // channel there — never a surviving quarantine that would retry
    // archive/doc later.
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'second-edit',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 3,
    })
    const flushed2 = await persistence.flush('vault-a', 'doc')
    const primary = await storeA.getDraft('vault-a', 'doc')
    const conflicts = await storeA.listConflictDrafts('vault-a')

    // The blocker disappears; a final edit must write on the conflict
    // channel at final/doc. A surviving quarantine would instead
    // re-run the CAS — whose expected path now matches the family's
    // real path — and DRAG the family back to archive/doc.
    const database3 = await openRaw()
    await runTx(database3, (store) => store
      .delete(['vault-a', 'doc', 'conflict-blocker']))
    database3.close()
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'third-edit',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 4,
    })
    const flushed3 = await persistence.flush('vault-a', 'doc')

    const rawDatabase = await openRaw()
    const rawTransaction = rawDatabase.transaction(
      ['drafts', 'draftConflicts'],
      'readonly',
    )
    const rawDrafts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('drafts').getAll()
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    const rawConflicts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('draftConflicts')
        .index('vaultId').getAll('vault-a')
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    rawDatabase.close()
    await persistence.dispose()

    return {
      moveStatus: move.status,
      flushed1,
      movedByB,
      flushed2,
      primary,
      conflicts,
      flushed3,
      rawDraftPaths: rawDrafts.map((row) => (row as { documentPath: string }).documentPath),
      rawConflictPaths: rawConflicts.map((row) => (row as { documentPath: string }).documentPath),
    }
  }, DATABASE_NAME)

  expect(result.moveStatus).toBe('unsupported')
  // First retry: the fallback candidate joined the family at its then
  // current path — reported clean.
  expect(result.flushed1).toBe(true)
  expect(result.movedByB).toMatchObject({ status: 'moved' })
  // Second retry: the candidate met path-mismatch — the stale
  // quarantine was discarded and A's bytes persisted at the certified
  // current path.
  expect(result.flushed2).toBe(true)
  expect(result.primary).toMatchObject({
    documentPath: 'final/doc',
    content: 'primary',
  })
  expect(result.conflicts).toHaveLength(2)
  expect(result.conflicts.every((c) => c.documentPath === 'final/doc')).toBe(true)
  expect(result.conflicts.find((c) => c.content === 'after-rename')).toMatchObject({
    documentPath: 'final/doc',
    origin: 'move-conflict',
  })
  expect(result.conflicts.find((c) => c.content === 'second-edit')).toMatchObject({
    documentPath: 'final/doc',
    origin: 'move-conflict',
  })
  // The final edit wrote on the conflict channel — no stale move
  // retry dragged the family to archive/doc.
  expect(result.flushed3).toBe(true)
  expect(result.rawDraftPaths).toEqual(['final/doc'])
  expect(result.rawConflictPaths).toEqual(['final/doc', 'final/doc', 'final/doc'])
})

test('a conflict-pinned quarantine discards the stale serverPath when its candidate meets path-mismatch', async ({
  page,
}) => {
  const result = await page.evaluate(async (databaseName) => {
    const { createDraftStore } = await import(
      '/src/composables/vault/draft-recovery/draftStore.ts'
    )
    const { createUnsavedDraftPersistence } = await import(
      '/src/composables/vault/draft-recovery/useUnsavedDraftPersistence.ts'
    )
    const storeA = createDraftStore()
    await storeA.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 20,
    })
    // A cross-context record newer than any timestamp context A can
    // mint (now: () => 100): A's first edit saves stale and pins the
    // entry to the conflict channel.
    const storeB = createDraftStore()
    await storeB.saveDraft({
      version: 1 as const,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'cross',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 500,
    })
    const openRaw = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const runTx = (
      database: IDBDatabase,
      mutate: (store: IDBObjectStore) => void,
    ) => new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('draftConflicts', 'readwrite')
      mutate(transaction.objectStore('draftConflicts'))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    const makeFutureRow = (conflictId: string, documentPath: string) => ({
      version: 2,
      conflictId,
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath,
      content: 'future data',
      baseContentHash: null,
      baseModifiedAt: null,
      createdAt: 10,
      updatedAt: 25,
      origin: 'delete-conflict',
      crossContextUpdatedAt: 20,
      recordedAt: 25,
    })

    const persistence = createUnsavedDraftPersistence({
      store: storeA,
      now: () => 100,
    })
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
      content: 'edit-1',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 1,
    })
    await persistence.flush('vault-a', 'doc')

    // A future-version row at the family path makes the draft move
    // unsupported → quarantine{familyPath notes/doc, serverPath
    // archive/doc, conflict PIN kept}.
    const database = await openRaw()
    await runTx(database, (store) => store
      .put(makeFutureRow('conflict-blocker', 'notes/doc')))
    const identity = {
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'notes/doc',
    }
    const barrier = await persistence.prepareFileMutation([identity])
    const [move] = await barrier.commitMoves([{
      ...identity,
      fromPath: 'notes/doc',
      toPath: 'archive/doc',
    }])
    const finalized = await barrier.finalizeAfterTabMigration()

    // The first stale retry: the CAS comes back 'unsupported' and the
    // PINNED conflict channel writes its candidate at notes/doc —
    // reported clean, quarantine intact.
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'after-rename',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 2,
    })
    const flushed1 = await persistence.flush('vault-a', 'doc')

    // The blocker disappears; context B completes archive/doc→final/doc
    // whole, then a fresh unreadable row at final/doc keeps the next
    // CAS 'unsupported' while the candidate authority still certifies
    // final/doc.
    await runTx(database, (store) => store
      .delete(['vault-a', 'doc', 'conflict-blocker']))
    database.close()
    const movedByB = await storeB.moveDraftFamily('vault-a', 'doc', 'final/doc')
    const database2 = await openRaw()
    await runTx(database2, (store) => store
      .put(makeFutureRow('conflict-blocker-2', 'final/doc')))
    database2.close()

    // The second stale retry: CAS 'unsupported' again, the pinned
    // candidate at the stale oldPath notes/doc meets
    // path-mismatch(final/doc). The pinned quarantine takes the SAME
    // transition as the plain one: stale serverPath discarded,
    // candidate persisted at final/doc, entry pinned to the plain
    // conflict channel there.
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'second-edit',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 3,
    })
    const flushed2 = await persistence.flush('vault-a', 'doc')
    const primary = await storeA.getDraft('vault-a', 'doc')
    const conflicts = await storeA.listConflictDrafts('vault-a')

    // The blocker disappears; the next edit must write on the plain
    // conflict channel at final/doc — a surviving quarantine would
    // re-run the CAS and drag the family to archive/doc.
    const database3 = await openRaw()
    await runTx(database3, (store) => store
      .delete(['vault-a', 'doc', 'conflict-blocker-2']))
    database3.close()
    persistence.schedule({
      vaultId: 'vault-a',
      documentId: 'doc',
      documentPath: 'archive/doc',
      content: 'third-edit',
      authoritativeContent: 'primary',
      baseContentHash: null,
      baseModifiedAt: null,
      revision: 4,
    })
    const flushed3 = await persistence.flush('vault-a', 'doc')

    const rawDatabase = await openRaw()
    const rawTransaction = rawDatabase.transaction(
      ['drafts', 'draftConflicts'],
      'readonly',
    )
    const rawDrafts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('drafts').getAll()
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    const rawConflicts = await new Promise<unknown[]>((resolve, reject) => {
      const request = rawTransaction.objectStore('draftConflicts')
        .index('vaultId').getAll('vault-a')
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error)
    })
    rawDatabase.close()
    await persistence.dispose()

    return {
      moveStatus: move.status,
      finalized,
      flushed1,
      movedByB,
      flushed2,
      primary,
      conflicts,
      flushed3,
      rawDraftPaths: rawDrafts.map((row) => (row as { documentPath: string }).documentPath),
      rawConflictPaths: rawConflicts.map((row) => (row as { documentPath: string }).documentPath),
    }
  }, DATABASE_NAME)

  expect(result.moveStatus).toBe('unsupported')
  // The pinned entry's release write lands its candidate at the
  // family's current path — finalize reports nothing (unlike a
  // move-indeterminate entry, whose blocked write reports failed).
  expect(result.finalized).toEqual([])
  expect(result.flushed1).toBe(true)
  expect(result.movedByB).toMatchObject({ status: 'moved' })
  expect(result.flushed2).toBe(true)
  expect(result.primary).toMatchObject({
    documentPath: 'final/doc',
    content: 'cross',
  })
  expect(result.conflicts).toHaveLength(3)
  expect(result.conflicts.every((c) => c.documentPath === 'final/doc')).toBe(true)
  expect(result.conflicts.some((c) => c.content === 'edit-1')).toBe(true)
  expect(result.conflicts.some((c) => c.content === 'after-rename')).toBe(true)
  expect(result.conflicts.find((c) => c.content === 'second-edit')).toMatchObject({
    documentPath: 'final/doc',
    origin: 'move-conflict',
  })
  expect(result.flushed3).toBe(true)
  expect(result.rawDraftPaths).toEqual(['final/doc'])
  expect(result.rawConflictPaths)
    .toEqual(['final/doc', 'final/doc', 'final/doc', 'final/doc'])
})
