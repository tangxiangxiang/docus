import { draftKey, isDraftIdentity, type DraftKey } from './draftKey'
import {
  cloneDraft,
  cloneConflictRecord,
  draftsEqual,
  isDraftConflictRecord,
  isUnsavedDraft,
  type DraftConflictRecord,
  type UnsavedDraft,
} from './draftTypes'

const DATABASE_NAME = 'docus-draft-recovery'
const DATABASE_VERSION = 2
const DRAFT_STORE_NAME = 'drafts'
const CONFLICT_STORE_NAME = 'draftConflicts'
const VAULT_UPDATED_INDEX = 'vaultUpdatedAt'
const CONFLICT_VAULT_INDEX = 'vaultId'

type SaveResult = 'saved' | 'stale' | 'conflict' | 'unsupported'
type SaveDecision =
  | { result: 'saved'; draft: UnsavedDraft }
  | { result: Exclude<SaveResult, 'saved'>; draft?: never }
type MoveResult = 'moved' | 'missing' | 'conflict' | 'unsupported'
type DeleteResult = 'deleted' | 'missing' | 'unsupported'
type ConditionalDeleteResult = DeleteResult | 'stale'
type BackendOperation =
  | 'save' | 'get' | 'list' | 'delete' | 'move' | 'moveConflicts' | 'clear'
  | 'saveConflict' | 'listConflicts' | 'deleteConflict' | 'clearConflicts'

export interface DraftStorageBackend {
  save(draft: UnsavedDraft): Promise<SaveResult>
  get(key: DraftKey): Promise<unknown | null>
  list(vaultId: string): Promise<unknown[]>
  delete(key: DraftKey): Promise<DeleteResult>
  deleteIfUnchanged(expected: UnsavedDraft): Promise<ConditionalDeleteResult>
  move(
    vaultId: string,
    oldDocumentId: string,
    newDocumentId: string,
    newPath: string,
  ): Promise<MoveResult>
  moveConflicts(
    vaultId: string,
    oldDocumentId: string,
    newDocumentId: string,
    newPath: string,
  ): Promise<number>
  clear(vaultId: string): Promise<void>
  saveConflict(record: DraftConflictRecord): Promise<void>
  listConflicts(vaultId: string): Promise<unknown[]>
  deleteConflict(
    vaultId: string,
    documentId: string,
    conflictId: string,
  ): Promise<'deleted' | 'missing'>
  clearConflicts(vaultId: string): Promise<void>
}

export type DraftMoveOutcome =
  | { status: 'moved' }
  | { status: 'missing' }
  | { status: 'conflict' }
  | { status: 'unsupported' }
  | { status: 'failed' }

export type DraftDeleteOutcome =
  | { status: 'deleted' }
  | { status: 'missing' }
  | { status: 'unsupported' }
  | { status: 'failed' }

export type DraftConditionalDeleteOutcome =
  | { status: 'deleted' }
  | { status: 'missing' }
  | { status: 'stale' }
  | { status: 'unsupported' }
  | { status: 'failed' }

export interface MemoryDraftStorageBackend extends DraftStorageBackend {
  failNext(operation: BackendOperation): void
  seedRaw(value: unknown): Promise<void>
}

export type DraftConflictSaveOutcome =
  | { status: 'saved' }
  | { status: 'unsupported' }
  | { status: 'failed' }

export interface DraftStore {
  saveDraft(draft: UnsavedDraft): Promise<boolean>
  getDraft(vaultId: string, documentId: string): Promise<UnsavedDraft | null>
  listDrafts(vaultId: string): Promise<UnsavedDraft[]>
  deleteDraft(vaultId: string, documentId: string): Promise<DraftDeleteOutcome>
  deleteDraftIfUnchanged(
    expected: UnsavedDraft,
  ): Promise<DraftConditionalDeleteOutcome>
  moveDraft(
    vaultId: string,
    oldDocumentId: string,
    newDocumentId: string,
    newPath: string,
  ): Promise<DraftMoveOutcome>
  moveConflicts(
    vaultId: string,
    oldDocumentId: string,
    newDocumentId: string,
    newPath: string,
  ): Promise<number>
  clearVaultDrafts(vaultId: string): Promise<boolean>
  saveConflictDraft(record: DraftConflictRecord): Promise<DraftConflictSaveOutcome>
  listConflictDrafts(vaultId: string): Promise<DraftConflictRecord[]>
  deleteConflictDraft(
    vaultId: string,
    documentId: string,
    conflictId: string,
  ): Promise<'deleted' | 'missing' | 'failed'>
  clearVaultConflictDrafts(vaultId: string): Promise<boolean>
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
      if (!isDraftIdentity(vaultId, documentId)) return { status: 'failed' }
      try {
        return { status: await backend.delete(draftKey(vaultId, documentId)) }
      } catch {
        return { status: 'failed' }
      }
    },

    async deleteDraftIfUnchanged(expected) {
      if (!isUnsavedDraft(expected)) return { status: 'failed' }
      try {
        return { status: await backend.deleteIfUnchanged(cloneDraft(expected)) }
      } catch {
        return { status: 'failed' }
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

    async moveConflicts(vaultId, oldDocumentId, newDocumentId, newPath) {
      if (!isDraftIdentity(vaultId, oldDocumentId)
        || !isDraftIdentity(vaultId, newDocumentId)
        || newPath.trim().length === 0) {
        return 0
      }
      try {
        return await backend.moveConflicts(
          vaultId,
          oldDocumentId,
          newDocumentId,
          newPath,
        )
      } catch {
        return 0
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

    async saveConflictDraft(record) {
      if (!isDraftConflictRecord(record)) return { status: 'unsupported' }
      if (record.vaultId.trim().length === 0
        || record.documentId.trim().length === 0
        || record.conflictId.trim().length === 0) {
        return { status: 'unsupported' }
      }
      try {
        await backend.saveConflict(cloneConflictRecord(record))
        return { status: 'saved' }
      } catch {
        return { status: 'failed' }
      }
    },

    async listConflictDrafts(vaultId) {
      if (vaultId.trim().length === 0) return []
      try {
        const raw = await backend.listConflicts(vaultId)
        return raw
          .filter(isDraftConflictRecord)
          .map(cloneConflictRecord)
          .sort((left, right) => (
            right.updatedAt - left.updatedAt
            || left.documentId.localeCompare(right.documentId)
            || left.conflictId.localeCompare(right.conflictId)
          ))
      } catch {
        return []
      }
    },

    async deleteConflictDraft(vaultId, documentId, conflictId) {
      if (vaultId.trim().length === 0
        || documentId.trim().length === 0
        || conflictId.trim().length === 0) {
        return 'failed'
      }
      try {
        return await backend.deleteConflict(vaultId, documentId, conflictId)
      } catch {
        // A store error is not the same as an absent record. Report
        // 'failed' so callers only treat a genuine 'deleted'/'missing'
        // as success — otherwise the record survives and silently
        // resurfaces on the next discovery.
        return 'failed'
      }
    },

    async clearVaultConflictDrafts(vaultId) {
      if (vaultId.trim().length === 0) return false
      try {
        await backend.clearConflicts(vaultId)
        return true
      } catch {
        return false
      }
    },
  }
}

export function createMemoryDraftBackend(): MemoryDraftStorageBackend {
  const records = new Map<string, unknown>()
  const conflictRecords = new Map<string, unknown>()
  const failures = new Set<BackendOperation>()

  function serializedKey(vaultId: string, documentId: string): string {
    return JSON.stringify(draftKey(vaultId, documentId))
  }

  function serializedConflictKey(
    vaultId: string,
    documentId: string,
    conflictId: string,
  ): string {
    // Conflict records share the (vaultId, documentId) identity with
    // the primary draft but live under a disjoint Map region by
    // prefixing the conflictId. The prefix ensures a stale
    // listDrafts() (which filters by vaultId) never returns conflict
    // rows and vice versa.
    return `conflict:${vaultId}:${documentId}:${conflictId}`
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
      const key = serializedKey(vaultId, documentId)
      const value = records.get(key)
      if (value === undefined || value === null) return 'missing'
      if (!isUnsavedDraft(value)) return 'unsupported'
      records.delete(key)
      return 'deleted'
    },

    async deleteIfUnchanged(expected) {
      consumeFailure('delete')
      const key = serializedKey(expected.vaultId, expected.documentId)
      const value = records.get(key)
      if (value === undefined || value === null) return 'missing'
      if (!isUnsavedDraft(value)) return 'unsupported'
      if (!draftsEqual(value, expected)) return 'stale'
      records.delete(key)
      return 'deleted'
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

    async moveConflicts(vaultId, oldDocumentId, newDocumentId, newPath) {
      consumeFailure('moveConflicts')
      let moved = 0
      for (const value of [...conflictRecords.values()]) {
        if (!isDraftConflictRecord(value)
          || value.vaultId !== vaultId
          || value.documentId !== oldDocumentId) continue
        const updated: DraftConflictRecord = {
          ...value,
          documentId: newDocumentId,
          documentPath: newPath,
        }
        if (oldDocumentId !== newDocumentId) {
          conflictRecords.delete(
            serializedConflictKey(vaultId, oldDocumentId, value.conflictId),
          )
        }
        conflictRecords.set(
          serializedConflictKey(vaultId, newDocumentId, value.conflictId),
          cloneConflictRecord(updated),
        )
        moved += 1
      }
      return moved
    },

    async clear(vaultId) {
      consumeFailure('clear')
      for (const [key, value] of records) {
        if (isUnsavedDraft(value) && value.vaultId === vaultId) records.delete(key)
      }
    },

    async saveConflict(record) {
      consumeFailure('saveConflict')
      const key = serializedConflictKey(record.vaultId, record.documentId, record.conflictId)
      if (conflictRecords.has(key)) throw new Error('Draft conflict record already exists')
      conflictRecords.set(key, cloneConflictRecord(record))
    },

    async listConflicts(vaultId) {
      consumeFailure('listConflicts')
      return [...conflictRecords.values()]
        .filter((value) => isDraftConflictRecord(value) && value.vaultId === vaultId)
        .map(cloneUnknown)
    },

    async deleteConflict(vaultId, documentId, conflictId) {
      consumeFailure('deleteConflict')
      const key = serializedConflictKey(vaultId, documentId, conflictId)
      const value = conflictRecords.get(key)
      if (value === undefined || value === null) return 'missing'
      conflictRecords.delete(key)
      return 'deleted'
    },

    async clearConflicts(vaultId) {
      consumeFailure('clearConflicts')
      for (const [key, value] of conflictRecords) {
        if (isDraftConflictRecord(value) && value.vaultId === vaultId) {
          conflictRecords.delete(key)
        }
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
      const cached = openDatabase(factory)
        .then((db) => {
          const release = () => {
            if (databasePromise === cached) databasePromise = null
          }
          db.onversionchange = () => {
            db.close()
            release()
          }
          db.onclose = release
          return db
        })
        .catch((error: unknown) => {
          if (databasePromise === cached) databasePromise = null
          throw error
        })
      databasePromise = cached
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
      const store = transaction.objectStore(DRAFT_STORE_NAME)
      const value = await request(store.get(idbKey(...key)))
      if (value === undefined || value === null) {
        await transactionDone(transaction)
        return 'missing'
      }
      if (!isUnsavedDraft(value)) {
        await transactionDone(transaction)
        return 'unsupported'
      }
      store.delete(idbKey(...key))
      await transactionDone(transaction)
      return 'deleted'
    },

    async deleteIfUnchanged(expected) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(DRAFT_STORE_NAME)
      const key = idbKey(expected.vaultId, expected.documentId)
      const value = await request(store.get(key))
      let result: ConditionalDeleteResult
      if (value === undefined || value === null) result = 'missing'
      else if (!isUnsavedDraft(value)) result = 'unsupported'
      else if (!draftsEqual(value, expected)) result = 'stale'
      else {
        store.delete(key)
        result = 'deleted'
      }
      await transactionDone(transaction)
      return result
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

    async moveConflicts(vaultId, oldDocumentId, newDocumentId, newPath) {
      const db = await database()
      const transaction = db.transaction(CONFLICT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(CONFLICT_STORE_NAME)
      const values = await request(
        store.index(CONFLICT_VAULT_INDEX).getAll(vaultId),
      )
      let moved = 0
      for (const value of values) {
        if (!isDraftConflictRecord(value) || value.documentId !== oldDocumentId) {
          continue
        }
        // Preserve conflictId, body, baseline, timestamps, and origin;
        // only the identity/path follow the rename. Same-documentId
        // renames keep the compound key and update in place.
        const updated: DraftConflictRecord = {
          ...value,
          documentId: newDocumentId,
          documentPath: newPath,
        }
        if (oldDocumentId !== newDocumentId) {
          store.delete(idbConflictKey(vaultId, oldDocumentId, value.conflictId))
        }
        store.put(cloneConflictRecord(updated))
        moved += 1
      }
      await transactionDone(transaction)
      return moved
    },

    async clear(vaultId) {
      const db = await database()
      const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(DRAFT_STORE_NAME)
      const values = await request(store.getAll())
      for (const value of values) {
        if (isUnsavedDraft(value) && value.vaultId === vaultId) {
          store.delete(idbKey(value.vaultId, value.documentId))
        }
      }
      await transactionDone(transaction)
    },

    async saveConflict(record) {
      const db = await database()
      const transaction = db.transaction(CONFLICT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(CONFLICT_STORE_NAME)
      store.add(cloneConflictRecord(record))
      await transactionDone(transaction)
    },

    async listConflicts(vaultId) {
      const db = await database()
      const transaction = db.transaction(CONFLICT_STORE_NAME, 'readonly')
      const values = await request(
        transaction.objectStore(CONFLICT_STORE_NAME).index(CONFLICT_VAULT_INDEX)
          .getAll(vaultId),
      )
      await transactionDone(transaction)
      return values
    },

    async deleteConflict(vaultId, documentId, conflictId) {
      const db = await database()
      const transaction = db.transaction(CONFLICT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(CONFLICT_STORE_NAME)
      const key = idbConflictKey(vaultId, documentId, conflictId)
      const value = await request(store.get(key))
      if (value === undefined || value === null) {
        await transactionDone(transaction)
        return 'missing'
      }
      store.delete(key)
      await transactionDone(transaction)
      return 'deleted'
    },

    async clearConflicts(vaultId) {
      const db = await database()
      const transaction = db.transaction(CONFLICT_STORE_NAME, 'readwrite')
      const store = transaction.objectStore(CONFLICT_STORE_NAME)
      const values = await request(store.getAll())
      for (const value of values) {
        if (isDraftConflictRecord(value) && value.vaultId === vaultId) {
          store.delete(idbConflictKey(value.vaultId, value.documentId, value.conflictId))
        }
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

function recordVaultId(value: unknown): unknown {
  return recordField(value, 'vaultId')
}

function idbKey(vaultId: string, documentId: string): IDBValidKey[] {
  return [vaultId, documentId]
}

function idbConflictKey(
  vaultId: string,
  documentId: string,
  conflictId: string,
): IDBValidKey[] {
  return [vaultId, documentId, conflictId]
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
    let rejected = false
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
      const conflictStore = db.objectStoreNames.contains(CONFLICT_STORE_NAME)
        ? open.transaction!.objectStore(CONFLICT_STORE_NAME)
        : db.createObjectStore(CONFLICT_STORE_NAME, {
          keyPath: ['vaultId', 'documentId', 'conflictId'],
        })
      if (!conflictStore.indexNames.contains(CONFLICT_VAULT_INDEX)) {
        conflictStore.createIndex(CONFLICT_VAULT_INDEX, 'vaultId')
      }
    }
    open.onsuccess = () => {
      if (rejected) {
        open.result.close()
        return
      }
      resolve(open.result)
    }
    open.onerror = () => reject(open.error ?? new Error('Failed to open draft database'))
    open.onblocked = () => {
      rejected = true
      reject(new Error('Draft database upgrade is blocked'))
    }
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
