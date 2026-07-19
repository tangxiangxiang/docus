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
      const request = indexedDB.open(databaseName, 1)
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
      const request = indexedDB.open(databaseName, 1)
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

  expect(result.saved).toBe(false)
  expect(result.moved).toEqual({ status: 'unsupported' })
  expect(result.deleted).toEqual({ status: 'unsupported' })
  expect(result.cleared).toBe(true)
  expect(result.rawFuture).toMatchObject({ version: 2, content: 'future buffer' })
  expect(result.rawTarget).toMatchObject({ content: 42 })
  expect(result.rawSource).toBeUndefined()
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
      const request = indexedDB.open(databaseName, 2)
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
    upgraded: 2,
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
      const request = indexedDB.open(databaseName, 2)
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
    saved: false,
    listed: [],
    moved: { status: 'failed' },
  })
})
