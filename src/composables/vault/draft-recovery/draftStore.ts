import { draftKey, isDraftIdentity, type DraftKey } from './draftKey'
import {
  cloneDraft,
  isUnsavedDraft,
  type UnsavedDraft,
} from './draftTypes'

const DATABASE_NAME = 'docus-draft-recovery'
const DATABASE_VERSION = 1
const DRAFT_STORE_NAME = 'drafts'
const VAULT_UPDATED_INDEX = 'vaultUpdatedAt'

type SaveResult = 'saved' | 'stale' | 'conflict' | 'unsupported'
type SaveDecision =
  | { result: 'saved'; draft: UnsavedDraft }
  | { result: Exclude<SaveResult, 'saved'>; draft?: never }
type MoveResult = 'moved' | 'missing' | 'conflict' | 'unsupported'
type BackendOperation = 'save' | 'get' | 'list' | 'delete' | 'move' | 'clear'

export interface DraftStorageBackend {
  save(draft: UnsavedDraft): Promise<SaveResult>
  get(key: DraftKey): Promise<unknown | null>
  list(vaultId: string): Promise<unknown[]>
  delete(key: DraftKey): Promise<void>
  move(
    vaultId: string,
    oldDocumentId: string,
    newDocumentId: string,
    newPath: string,
  ): Promise<MoveResult>
  clear(vaultId: string): Promise<void>
}

export type DraftMoveOutcome =
  | { status: 'moved' }
  | { status: 'missing' }
  | { status: 'conflict' }
  | { status: 'unsupported' }
  | { status: 'failed' }

export interface MemoryDraftStorageBackend extends DraftStorageBackend {
  failNext(operation: BackendOperation): void
  seedRaw(value: unknown): Promise<void>
}

export interface DraftStore {
  saveDraft(draft: UnsavedDraft): Promise<boolean>
  getDraft(vaultId: string, documentId: string): Promise<UnsavedDraft | null>
  listDrafts(vaultId: string): Promise<UnsavedDraft[]>
  deleteDraft(vaultId: string, documentId: string): Promise<boolean>
  moveDraft(
    vaultId: string,
    oldDocumentId: string,
    newDocumentId: string,
    newPath: string,
  ): Promise<DraftMoveOutcome>
  clearVaultDrafts(vaultId: string): Promise<boolean>
}

interface CreateDraftStoreOptions {
  backend?: DraftStorageBackend
  indexedDB?: IDBFactory
}

export function createDraftStore(options: CreateDraftStoreOptions = {}): DraftStore {
  const backend = options.backend ?? createIndexedDbDraftBackend(options.indexedDB)

  return {
    async saveDraft(draft) {
      if (!isUnsavedDraft(draft)) return false
      try {
        return await backend.save(cloneDraft(draft)) === 'saved'
      } catch {
        return false
      }
    },

    async getDraft(vaultId, documentId) {
      if (!isDraftIdentity(vaultId, documentId)) return null
      try {
        const value = await backend.get(draftKey(vaultId, documentId))
        return isUnsavedDraft(value) ? cloneDraft(value) : null
      } catch {
        return null
      }
    },

    async listDrafts(vaultId) {
      if (vaultId.trim().length === 0) return []
      try {
        return (await backend.list(vaultId))
          .filter(isUnsavedDraft)
          .map(cloneDraft)
          .sort((left, right) => (
            right.updatedAt - left.updatedAt
            || left.documentId.localeCompare(right.documentId)
          ))
      } catch {
        return []
      }
    },

    async deleteDraft(vaultId, documentId) {
      if (!isDraftIdentity(vaultId, documentId)) return false
      try {
        await backend.delete(draftKey(vaultId, documentId))
        return true
      } catch {
        return false
      }
    },

    async moveDraft(vaultId, oldDocumentId, newDocumentId, newPath) {
      if (!isDraftIdentity(vaultId, oldDocumentId)
        || !isDraftIdentity(vaultId, newDocumentId)
        || newPath.trim().length === 0) {
        return { status: 'failed' }
      }
      try {
        const status = await backend.move(
          vaultId,
          oldDocumentId,
          newDocumentId,
          newPath,
        )
        return { status }
      } catch {
        return { status: 'failed' }
      }
    },

    async clearVaultDrafts(vaultId) {
      if (vaultId.trim().length === 0) return false
      try {
        await backend.clear(vaultId)
        return true
      } catch {
        return false
      }
    },
  }
}

export function createMemoryDraftBackend(): MemoryDraftStorageBackend {
  const records = new Map<string, unknown>()
  const failures = new Set<BackendOperation>()

  function serializedKey(vaultId: string, documentId: string): string {
    return JSON.stringify(draftKey(vaultId, documentId))
  }

  function consumeFailure(operation: BackendOperation): void {
    if (!failures.delete(operation)) return
    throw new Error(`Injected draft backend ${operation} failure`)
  }

  return {
    async save(draft) {
      consumeFailure('save')
      const key = serializedKey(draft.vaultId, draft.documentId)
      const current = records.get(key)
      const decision = decideSave(current, draft)
      if (decision.result === 'saved') {
        records.set(key, cloneDraft(decision.draft))
      }
      return decision.result
    },

    async get([vaultId, documentId]) {
      consumeFailure('get')
      return cloneUnknown(records.get(serializedKey(vaultId, documentId)) ?? null)
    },

    async list(vaultId) {
      consumeFailure('list')
      return [...records.values()]
        .filter((value) => recordVaultId(value) === vaultId)
        .map(cloneUnknown)
    },

    async delete([vaultId, documentId]) {
      consumeFailure('delete')
      records.delete(serializedKey(vaultId, documentId))
    },

    async move(vaultId, oldDocumentId, newDocumentId, newPath) {
      consumeFailure('move')
      const oldKey = serializedKey(vaultId, oldDocumentId)
      const newKey = serializedKey(vaultId, newDocumentId)
      const source = records.get(oldKey)
      const target = oldKey === newKey ? undefined : records.get(newKey)
      const decision = decideMove(source, target, newDocumentId, newPath)
      if (decision.result !== 'moved') return decision.result

      records.set(newKey, cloneDraft(decision.draft))
      if (oldKey !== newKey) records.delete(oldKey)
      return 'moved'
    },

    async clear(vaultId) {
      consumeFailure('clear')
      for (const [key, value] of records) {
        if (recordVaultId(value) === vaultId) records.delete(key)
      }
    },

    failNext(operation) {
      failures.add(operation)
    },

    async seedRaw(value) {
      const vaultId = recordField(value, 'vaultId')
      const documentId = recordField(value, 'documentId')
      if (typeof vaultId !== 'string' || typeof documentId !== 'string') {
        throw new Error('Raw draft seed requires vaultId and documentId')
      }
      records.set(serializedKey(vaultId, documentId), cloneUnknown(value))
    },
  }
}

export function createIndexedDbDraftBackend(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): DraftStorageBackend {
  let databasePromise: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'))
    if (!databasePromise) {
      databasePromise = openDatabase(factory).catch((error: unknown) => {
        databasePromise = null
        throw error
      })
    }
    return databasePromise
  }

  return {
    async save(draft) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(DRAFT_STORE_NAME)
      const current = await request(store.get(
        idbKey(draft.vaultId, draft.documentId),
      ))
      const decision = decideSave(current, draft)
      if (decision.result === 'saved') store.put(cloneDraft(decision.draft))
      await transactionDone(transaction)
      return decision.result
    },

    async get(key) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readonly')
      const value = await request(
        transaction.objectStore(DRAFT_STORE_NAME).get(idbKey(...key)),
      )
      await transactionDone(transaction)
      return value ?? null
    },

    async list(vaultId) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readonly')
      const values = await request(
        transaction.objectStore(DRAFT_STORE_NAME).index(VAULT_UPDATED_INDEX)
          .getAll(IDBKeyRange.bound([vaultId, 0], [vaultId, Number.MAX_SAFE_INTEGER])),
      )
      await transactionDone(transaction)
      return values
    },

    async delete(key) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite')
      transaction.objectStore(DRAFT_STORE_NAME).delete(idbKey(...key))
      await transactionDone(transaction)
    },

    async move(vaultId, oldDocumentId, newDocumentId, newPath) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(DRAFT_STORE_NAME)
      const oldKey = idbKey(vaultId, oldDocumentId)
      const newKey = idbKey(vaultId, newDocumentId)
      const source = await request(store.get(oldKey))
      const target = oldDocumentId === newDocumentId
        ? undefined
        : await request(store.get(newKey))
      const decision = decideMove(source, target, newDocumentId, newPath)
      if (decision.result === 'moved') {
        store.put(cloneDraft(decision.draft))
        if (oldDocumentId !== newDocumentId) store.delete(oldKey)
      }
      await transactionDone(transaction)
      return decision.result
    },

    async clear(vaultId) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(DRAFT_STORE_NAME)
      const keys = await request(store.getAllKeys())
      for (const key of keys) {
        if (Array.isArray(key) && key[0] === vaultId) store.delete(key)
      }
      await transactionDone(transaction)
    },
  }
}

function decideSave(current: unknown, incoming: UnsavedDraft): SaveDecision {
  if (current === undefined || current === null) {
    return { result: 'saved', draft: cloneDraft(incoming) }
  }
  if (!isUnsavedDraft(current)) return { result: 'unsupported' }

  const normalized = {
    ...incoming,
    createdAt: current.createdAt,
  }
  if (normalized.updatedAt > current.updatedAt) {
    return { result: 'saved', draft: normalized }
  }
  if (normalized.updatedAt < current.updatedAt) return { result: 'stale' }
  return draftsEqual(current, normalized)
    ? { result: 'saved', draft: normalized }
    : { result: 'conflict' }
}

function decideMove(
  sourceValue: unknown,
  targetValue: unknown,
  newDocumentId: string,
  newPath: string,
): { result: Exclude<MoveResult, 'moved'>; draft?: never }
  | { result: 'moved'; draft: UnsavedDraft } {
  if (sourceValue === undefined || sourceValue === null) {
    return { result: 'missing' }
  }
  if (!isUnsavedDraft(sourceValue)) return { result: 'unsupported' }

  const movedSource: UnsavedDraft = {
    ...sourceValue,
    documentId: newDocumentId,
    documentPath: newPath,
  }
  if (targetValue === undefined || targetValue === null) {
    return { result: 'moved', draft: movedSource }
  }
  if (!isUnsavedDraft(targetValue)) return { result: 'unsupported' }

  const movedTarget: UnsavedDraft = {
    ...targetValue,
    documentId: newDocumentId,
    documentPath: newPath,
  }
  if (draftsEqual(movedSource, movedTarget)) {
    return { result: 'moved', draft: movedSource }
  }
  return { result: 'conflict' }
}

function draftsEqual(left: UnsavedDraft, right: UnsavedDraft): boolean {
  return left.version === right.version
    && left.vaultId === right.vaultId
    && left.documentId === right.documentId
    && left.documentPath === right.documentPath
    && left.content === right.content
    && left.baseContentHash === right.baseContentHash
    && left.baseModifiedAt === right.baseModifiedAt
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
}

function recordVaultId(value: unknown): unknown {
  return recordField(value, 'vaultId')
}

function idbKey(vaultId: string, documentId: string): IDBValidKey[] {
  return [vaultId, documentId]
}

function recordField(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Record<string, unknown>)[field]
}

function cloneUnknown<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(DATABASE_NAME, DATABASE_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      const store = db.objectStoreNames.contains(DRAFT_STORE_NAME)
        ? open.transaction!.objectStore(DRAFT_STORE_NAME)
        : db.createObjectStore(DRAFT_STORE_NAME, {
          keyPath: ['vaultId', 'documentId'],
        })
      if (!store.indexNames.contains(VAULT_UPDATED_INDEX)) {
        store.createIndex(VAULT_UPDATED_INDEX, ['vaultId', 'updatedAt'])
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('Failed to open draft database'))
    open.onblocked = () => reject(new Error('Draft database upgrade is blocked'))
  })
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result)
    value.onerror = () => reject(value.error ?? new Error('Draft database request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(
      transaction.error ?? new Error('Draft database transaction aborted'),
    )
    transaction.onerror = () => reject(
      transaction.error ?? new Error('Draft database transaction failed'),
    )
  })
}
