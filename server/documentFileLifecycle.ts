import { promises as fs } from 'node:fs'
import type { Database as DatabaseT } from 'better-sqlite3'
import { moveDocumentMetadataReplacingDestination } from './documentMetadata.js'

export async function renameDocumentWithMetadata(input: {
  db: DatabaseT
  fromPath: string
  toPath: string
  fromAbs: string
  toAbs: string
  renameFile?: (from: string, to: string) => Promise<void>
  moveMetadata?: (db: DatabaseT, fromPath: string, toPath: string) => boolean
}): Promise<void> {
  const { db, fromPath, toPath, fromAbs, toAbs } = input
  const renameFile = input.renameFile ?? fs.rename
  const moveMetadata = input.moveMetadata ?? moveDocumentMetadataReplacingDestination
  await renameFile(fromAbs, toAbs)
  try {
    if (!moveMetadata(db, fromPath, toPath)) {
      throw new Error(`source metadata missing: ${fromPath}`)
    }
  } catch (metadataError) {
    try {
      await renameFile(toAbs, fromAbs)
    } catch (rollbackError) {
      throw new AggregateError(
        [metadataError, rollbackError],
        'metadata move failed and filesystem rollback also failed',
      )
    }
    throw metadataError
  }
}
