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
