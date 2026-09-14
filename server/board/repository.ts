import type { Database as DatabaseT } from 'better-sqlite3'
import {
  BOARD_ENGINE_EXCALIDRAW,
  CURRENT_BOARD_SCENE_VERSION,
  createCanonicalEmptyBoardScene,
  type BoardMetadata,
  type BoardSceneRecord,
} from '../../shared/boardProtocol.js'
import { BoardError, isBoardError } from './errors.js'
import {
  assertBoardId,
  assertExpectedRevision,
  assertSupportedBoardSceneContract,
  migrateBoardScene,
  normalizeBoardScene,
  parseStoredBoardScene,
  serializeBoardScenePart,
} from './validation.js'
import {
  BOARD_REFERENCE_OWNER_TYPE,
  BOARD_SCENE_REFERENCE_PURPOSE,
  BOARD_THUMBNAIL_REFERENCE_PURPOSE,
  type BoardAggregate,
  type SaveBoardSceneInput,
  type SaveBoardSceneResult,
} from './types.js'
import { SqliteAssetRepository, type AssetRepository } from '../assets/repository.js'

interface BoardRow {
  id: string
  title: string
  created_at: number
  updated_at: number
  thumbnail_asset_id: string | null
}

interface SceneRow {
  board_id: string
  engine: string
  scene_version: number
  revision: number
  engine_data_json: string
  persistent_app_state_json: string
}

export interface BoardRepository {
  createBoard(id: string, title: string, createdAt: number): void
  getBoardMetadata(boardId: string): BoardMetadata | null
  listBoards(): BoardMetadata[]
  getBoard(boardId: string): BoardAggregate | null
  renameBoard(boardId: string, title: string, updatedAt: number): BoardMetadata
  deleteBoard(boardId: string): string[] | null
  saveBoardScene(input: SaveBoardSceneInput, updatedAt: number): SaveBoardSceneResult
  replaceThumbnailReference(boardId: string, assetId: string | null, referenceCreatedAt: number): string[]
}

const THUMBNAIL_PROJECTION = `
  (
    SELECT ar.asset_id
    FROM asset_references AS ar
    WHERE ar.owner_type = '${BOARD_REFERENCE_OWNER_TYPE}'
      AND ar.owner_id = b.id
      AND ar.purpose = '${BOARD_THUMBNAIL_REFERENCE_PURPOSE}'
    ORDER BY ar.created_at DESC, ar.asset_id DESC
    LIMIT 1
  ) AS thumbnail_asset_id
`

function runImmediate<T>(db: DatabaseT, callback: () => T): T {
  if (db.inTransaction) return callback()
  return db.transaction(callback).immediate()
}

function isForeignKeyViolation(error: unknown): boolean {
  return !!error && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
}

function metadataFromRow(row: BoardRow): BoardMetadata {
  return {
    id: row.id,
    title: row.title,
    thumbnailAssetId: row.thumbnail_asset_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SqliteBoardRepository implements BoardRepository {
  private readonly db: DatabaseT
  private readonly assets: AssetRepository

  constructor(
    db: DatabaseT,
    assets: AssetRepository = new SqliteAssetRepository(db),
  ) {
    this.db = db
    this.assets = assets
  }

  createBoard(id: string, title: string, createdAt: number): void {
    const boardId = assertBoardId(id)
    runImmediate(this.db, () => {
      this.db.prepare(`
        INSERT INTO boards (id, title, created_at, updated_at)
        VALUES (@id, @title, @createdAt, @updatedAt)
      `).run({ id: boardId, title, createdAt, updatedAt: createdAt })

      const scene = createCanonicalEmptyBoardScene()
      this.db.prepare(`
        INSERT INTO board_scenes (
          board_id, engine, scene_version, revision,
          engine_data_json, persistent_app_state_json
        ) VALUES (@boardId, @engine, @sceneVersion, 0, @engineDataJson, @persistentAppStateJson)
      `).run({
        boardId,
        engine: BOARD_ENGINE_EXCALIDRAW,
        sceneVersion: CURRENT_BOARD_SCENE_VERSION,
        engineDataJson: serializeBoardScenePart(scene.engineData, 'canonical engineData'),
        persistentAppStateJson: serializeBoardScenePart(scene.persistentAppState, 'canonical persistentAppState'),
      })
    })
  }

  getBoardMetadata(boardId: string): BoardMetadata | null {
    const id = assertBoardId(boardId)
    const row = this.db.prepare(`
      SELECT b.id, b.title, b.created_at, b.updated_at,
             ${THUMBNAIL_PROJECTION}
      FROM boards AS b
      WHERE b.id = ?
    `).get(id) as BoardRow | undefined
    return row ? metadataFromRow(row) : null
  }

  listBoards(): BoardMetadata[] {
    const rows = this.db.prepare(`
      SELECT b.id, b.title, b.created_at, b.updated_at,
             ${THUMBNAIL_PROJECTION}
      FROM boards AS b
      ORDER BY b.updated_at DESC, b.id DESC
    `).all() as BoardRow[]
    return rows.map(metadataFromRow)
  }

  getBoard(boardId: string): BoardAggregate | null {
    const id = assertBoardId(boardId)
    const metadata = this.getBoardMetadata(id)
    if (!metadata) return null
    const sceneRecord = this.getSceneRecord(id)
    return { metadata, sceneRecord }
  }

  renameBoard(boardId: string, title: string, updatedAt: number): BoardMetadata {
    const id = assertBoardId(boardId)
    runImmediate(this.db, () => {
      const result = this.db.prepare(`
        UPDATE boards
        SET title = @title, updated_at = @updatedAt
        WHERE id = @id
      `).run({ id, title, updatedAt })
      if (result.changes !== 1) throw new BoardError('BOARD_NOT_FOUND', 404, 'Board was not found')
    })
    const metadata = this.getBoardMetadata(id)
    if (!metadata) throw new BoardError('BOARD_STORAGE_ERROR', 500, 'Board disappeared after rename')
    return metadata
  }

  deleteBoard(boardId: string): string[] | null {
    const id = assertBoardId(boardId)
    return runImmediate(this.db, () => {
      const exists = this.db.prepare('SELECT 1 AS present FROM boards WHERE id = ?').get(id)
      if (!exists) return null

      const assetIds = this.assets.deleteAllReferencesForOwner({
        ownerType: BOARD_REFERENCE_OWNER_TYPE,
        ownerId: id,
      })
      const deleted = this.db.prepare('DELETE FROM boards WHERE id = ?').run(id)
      if (deleted.changes !== 1) throw new BoardError('BOARD_STORAGE_ERROR', 500, 'Board delete lost its row')
      return assetIds
    })
  }

  saveBoardScene(input: SaveBoardSceneInput, updatedAt: number): SaveBoardSceneResult {
    const boardId = assertBoardId(input.boardId)
    const expectedRevision = assertExpectedRevision(input.expectedRevision)
    assertSupportedBoardSceneContract(input.engine, input.sceneVersion)
    const scene = normalizeBoardScene(input.scene)
    if (expectedRevision >= Number.MAX_SAFE_INTEGER) {
      throw new BoardError('BOARD_VALIDATION_ERROR', 400, 'Board scene revision cannot be incremented safely')
    }

    const engineDataJson = serializeBoardScenePart(scene.engineData, 'engineData')
    const persistentAppStateJson = serializeBoardScenePart(scene.persistentAppState, 'persistentAppState')
    const newAssetIds = scene.assetRefs
    const newAssetSet = new Set(newAssetIds)

    try {
      return this.db.transaction(() => {
        const current = this.db.prepare(`
          SELECT revision
          FROM board_scenes
          WHERE board_id = ?
        `).get(boardId) as { revision: number } | undefined
        if (!current) {
          const board = this.db.prepare('SELECT 1 AS present FROM boards WHERE id = ?').get(boardId)
          if (!board) throw new BoardError('BOARD_NOT_FOUND', 404, 'Board was not found')
          throw new BoardError('BOARD_STORAGE_ERROR', 500, 'Board scene row is missing')
        }

        const oldAssetIds = this.assets.listReferenceIds({
          ownerType: BOARD_REFERENCE_OWNER_TYPE,
          ownerId: boardId,
          purpose: BOARD_SCENE_REFERENCE_PURPOSE,
        })
        const updated = this.db.prepare(`
          UPDATE board_scenes
          SET engine = @engine,
              scene_version = @sceneVersion,
              engine_data_json = @engineDataJson,
              persistent_app_state_json = @persistentAppStateJson,
              revision = revision + 1
          WHERE board_id = @boardId
            AND revision = @expectedRevision
        `).run({
          boardId,
          engine: input.engine,
          sceneVersion: input.sceneVersion,
          engineDataJson,
          persistentAppStateJson,
          expectedRevision,
        })
        if (updated.changes !== 1) {
          if (current.revision !== expectedRevision) {
            throw new BoardError('BOARD_SCENE_REVISION_CONFLICT', 409, 'Board scene revision is stale')
          }
          throw new BoardError('BOARD_STORAGE_ERROR', 500, 'Board scene update did not change its row')
        }

        this.assets.replaceReferences({
          ownerType: BOARD_REFERENCE_OWNER_TYPE,
          ownerId: boardId,
          purpose: BOARD_SCENE_REFERENCE_PURPOSE,
        }, newAssetIds, updatedAt)

        const boardUpdated = this.db.prepare(`
          UPDATE boards
          SET updated_at = @updatedAt
          WHERE id = @boardId
        `).run({ boardId, updatedAt })
        if (boardUpdated.changes !== 1) {
          throw new BoardError('BOARD_STORAGE_ERROR', 500, 'Board metadata update did not change its row')
        }

        return {
          revision: expectedRevision + 1,
          updatedAt,
          removedAssetIds: oldAssetIds.filter((assetId) => !newAssetSet.has(assetId)),
        }
      }).immediate()
    } catch (error) {
      if (isBoardError(error)) throw error
      if (isForeignKeyViolation(error)) {
        throw new BoardError(
          'BOARD_ASSET_REFERENCE_CONFLICT',
          409,
          'Board scene references an Asset that is no longer available',
          { cause: error },
        )
      }
      throw error
    }
  }

  replaceThumbnailReference(boardId: string, assetId: string | null, referenceCreatedAt: number): string[] {
    const id = assertBoardId(boardId)
    try {
      return this.db.transaction(() => {
        const board = this.db.prepare('SELECT 1 AS present FROM boards WHERE id = ?').get(id)
        if (!board) throw new BoardError('BOARD_NOT_FOUND', 404, 'Board was not found')
        const owner = {
          ownerType: BOARD_REFERENCE_OWNER_TYPE,
          ownerId: id,
          purpose: BOARD_THUMBNAIL_REFERENCE_PURPOSE,
        } as const
        const oldAssetIds = this.assets.listReferenceIds(owner)
        this.assets.deleteReferences(owner)
        if (assetId) {
          this.assets.replaceReferences(owner, [assetId], referenceCreatedAt)
        }
        return oldAssetIds.filter((oldAssetId) => oldAssetId !== assetId)
      }).immediate()
    } catch (error) {
      if (isBoardError(error)) throw error
      if (isForeignKeyViolation(error)) {
        throw new BoardError(
          'BOARD_ASSET_REFERENCE_CONFLICT',
          409,
          'Board thumbnail references an Asset that is no longer available',
          { cause: error },
        )
      }
      throw error
    }
  }

  private getSceneRecord(boardId: string): BoardSceneRecord {
    const row = this.db.prepare(`
      SELECT board_id, engine, scene_version, revision,
             engine_data_json, persistent_app_state_json
      FROM board_scenes
      WHERE board_id = ?
    `).get(boardId) as SceneRow | undefined
    if (!row) throw new BoardError('BOARD_SCENE_CORRUPT', 500, 'Board scene row is missing')
    if (row.engine !== BOARD_ENGINE_EXCALIDRAW) {
      throw new BoardError('BOARD_SCENE_ENGINE_UNSUPPORTED', 409, `Unsupported Board engine: ${row.engine}`)
    }
    if (row.scene_version > CURRENT_BOARD_SCENE_VERSION) {
      throw new BoardError(
        'BOARD_SCENE_VERSION_UNSUPPORTED',
        409,
        `Board scene version ${row.scene_version} is newer than this server supports`,
      )
    }
    if (row.scene_version < 1 || !Number.isSafeInteger(row.revision) || row.revision < 0) {
      throw new BoardError('BOARD_SCENE_CORRUPT', 500, 'Board scene version or revision is invalid')
    }

    const assetRefs = this.assets.listReferenceIds({
      ownerType: BOARD_REFERENCE_OWNER_TYPE,
      ownerId: boardId,
      purpose: BOARD_SCENE_REFERENCE_PURPOSE,
    })
    const scene = migrateBoardScene(
      row.scene_version,
      parseStoredBoardScene(row.engine_data_json, row.persistent_app_state_json, assetRefs),
    )
    return {
      boardId: row.board_id,
      engine: BOARD_ENGINE_EXCALIDRAW,
      sceneVersion: row.scene_version,
      revision: row.revision,
      scene,
    }
  }
}

export function createBoardRepository(db: DatabaseT): BoardRepository {
  return new SqliteBoardRepository(db)
}
