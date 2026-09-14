import type { BoardCheckpoint } from './recoveryTypes'

export const BOARD_RECOVERY_DATABASE_NAME = 'docus-board-recovery'
export const BOARD_RECOVERY_DATABASE_VERSION = 1
export const BOARD_CHECKPOINT_STORE_NAME = 'checkpoints'
export const BOARD_PENDING_ASSETS_STORE_NAME = 'pending-assets'
export const BOARD_PENDING_ASSETS_BOARD_INDEX = 'boardId'

export interface BoardCheckpointStore {
  get(boardId: string): Promise<BoardCheckpoint | null>
  put(checkpoint: BoardCheckpoint): Promise<void>
  delete(boardId: string): Promise<void>
  clearBoardRecovery(boardId: string): Promise<void>
  clearAllRecovery(): Promise<void>
}

export class BoardRecoveryStoreError extends Error {
  readonly code: 'BOARD_RECOVERY_UNAVAILABLE' | 'BOARD_RECOVERY_OPERATION_FAILED'

  constructor(
    message: string,
    code: 'BOARD_RECOVERY_UNAVAILABLE' | 'BOARD_RECOVERY_OPERATION_FAILED' = 'BOARD_RECOVERY_OPERATION_FAILED',
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'BoardRecoveryStoreError'
    this.code = code
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(BOARD_RECOVERY_DATABASE_NAME, BOARD_RECOVERY_DATABASE_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(BOARD_CHECKPOINT_STORE_NAME)) {
        database.createObjectStore(BOARD_CHECKPOINT_STORE_NAME, { keyPath: 'boardId' })
      }
      if (!database.objectStoreNames.contains(BOARD_PENDING_ASSETS_STORE_NAME)) {
        const store = database.createObjectStore(BOARD_PENDING_ASSETS_STORE_NAME, { keyPath: 'assetId' })
        store.createIndex(BOARD_PENDING_ASSETS_BOARD_INDEX, 'boardId', { unique: false })
      } else {
        const store = request.transaction?.objectStore(BOARD_PENDING_ASSETS_STORE_NAME)
        if (store && !store.indexNames.contains(BOARD_PENDING_ASSETS_BOARD_INDEX)) {
          store.createIndex(BOARD_PENDING_ASSETS_BOARD_INDEX, 'boardId', { unique: false })
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open was blocked'))
  })
}

export function createIndexedDbBoardCheckpointStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): BoardCheckpointStore {
  let databasePromise: Promise<IDBDatabase> | null = null

  function database(): Promise<IDBDatabase> {
    if (!factory) return Promise.reject(new BoardRecoveryStoreError('IndexedDB is unavailable', 'BOARD_RECOVERY_UNAVAILABLE'))
    if (!databasePromise) {
      const cached = openDatabase(factory)
        .then((database) => {
          const release = () => {
            if (databasePromise === cached) databasePromise = null
          }
          database.onversionchange = () => {
            database.close()
            release()
          }
          database.onclose = release
          return database
        })
        .catch((error: unknown) => {
          if (databasePromise === cached) databasePromise = null
      throw new BoardRecoveryStoreError('IndexedDB could not be opened', 'BOARD_RECOVERY_UNAVAILABLE', { cause: error })
        })
      databasePromise = cached
    }
    return databasePromise
  }

  async function run<T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      return await operation(await database())
    } catch (error) {
      if (error instanceof BoardRecoveryStoreError) throw error
      throw new BoardRecoveryStoreError('IndexedDB operation failed', 'BOARD_RECOVERY_OPERATION_FAILED', { cause: error })
    }
  }

  return {
    get(boardId) {
      return run(async (database) => {
        const transaction = database.transaction(BOARD_CHECKPOINT_STORE_NAME, 'readonly')
        const value = await requestResult(transaction.objectStore(BOARD_CHECKPOINT_STORE_NAME).get(boardId))
        await transactionDone(transaction)
        return value ? value as BoardCheckpoint : null
      })
    },

    async put(checkpoint) {
      await run(async (database) => {
        const transaction = database.transaction(BOARD_CHECKPOINT_STORE_NAME, 'readwrite')
        transaction.objectStore(BOARD_CHECKPOINT_STORE_NAME).put(checkpoint)
        await transactionDone(transaction)
      })
    },

    async delete(boardId) {
      await run(async (database) => {
        const transaction = database.transaction(BOARD_CHECKPOINT_STORE_NAME, 'readwrite')
        transaction.objectStore(BOARD_CHECKPOINT_STORE_NAME).delete(boardId)
        await transactionDone(transaction)
      })
    },

    async clearBoardRecovery(boardId) {
      await run(async (database) => {
        const transaction = database.transaction(
          [BOARD_CHECKPOINT_STORE_NAME, BOARD_PENDING_ASSETS_STORE_NAME],
          'readwrite',
        )
        transaction.objectStore(BOARD_CHECKPOINT_STORE_NAME).delete(boardId)
        const pendingStore = transaction.objectStore(BOARD_PENDING_ASSETS_STORE_NAME)
        const keys = await requestResult(pendingStore.index(BOARD_PENDING_ASSETS_BOARD_INDEX).getAllKeys(boardId))
        for (const key of keys) pendingStore.delete(key)
        await transactionDone(transaction)
      })
    },

    async clearAllRecovery() {
      await run(async (database) => {
        const transaction = database.transaction(
          [BOARD_CHECKPOINT_STORE_NAME, BOARD_PENDING_ASSETS_STORE_NAME],
          'readwrite',
        )
        transaction.objectStore(BOARD_CHECKPOINT_STORE_NAME).clear()
        transaction.objectStore(BOARD_PENDING_ASSETS_STORE_NAME).clear()
        await transactionDone(transaction)
      })
    },
  }
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : value
}

export interface MemoryPendingAssetRecord {
  assetId: string
  boardId: string
}

export interface MemoryBoardCheckpointStore extends BoardCheckpointStore {
  seedPendingAsset(record: MemoryPendingAssetRecord): void
  getPendingAssetIds(boardId: string): string[]
}

export function createMemoryBoardCheckpointStore(): MemoryBoardCheckpointStore {
  const checkpoints = new Map<string, BoardCheckpoint>()
  const pendingAssets = new Map<string, MemoryPendingAssetRecord>()
  return {
    async get(boardId) {
      return clone(checkpoints.get(boardId) ?? null)
    },
    async put(checkpoint) {
      checkpoints.set(checkpoint.boardId, clone(checkpoint))
    },
    async delete(boardId) {
      checkpoints.delete(boardId)
    },
    async clearBoardRecovery(boardId) {
      checkpoints.delete(boardId)
      for (const [assetId, record] of pendingAssets) {
        if (record.boardId === boardId) pendingAssets.delete(assetId)
      }
    },
    async clearAllRecovery() {
      checkpoints.clear()
      pendingAssets.clear()
    },
    seedPendingAsset(record) {
      pendingAssets.set(record.assetId, { ...record })
    },
    getPendingAssetIds(boardId) {
      return [...pendingAssets.values()]
        .filter((record) => record.boardId === boardId)
        .map((record) => record.assetId)
    },
  }
}
