import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { applyMigrations } from '../db'
import {
  getDocumentMetadata,
  saveDocumentMetadata,
} from '../documentMetadata'
import { __setDirectoryMoveStrategyOverrideForTesting } from '../documentFileLifecycle'
import app, { __setMetadataDbForTesting } from '../index'
import { __resetLinkIndexForTesting } from '../linkIndex'
import { setContentDir } from '../paths'

let vault: string
let originalContentDir: string
let db: Database.Database

beforeEach(async () => {
  originalContentDir = path.resolve(process.cwd(), 'src/content')
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-folder-route-'))
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  __setMetadataDbForTesting(db)
  setContentDir(vault)
  __resetLinkIndexForTesting()
  __setDirectoryMoveStrategyOverrideForTesting('atomic-rename')
})

afterEach(async () => {
  __setDirectoryMoveStrategyOverrideForTesting(null)
  __setMetadataDbForTesting(null)
  db.close()
  setContentDir(originalContentDir)
  __resetLinkIndexForTesting()
  await fs.rm(vault, { recursive: true, force: true })
})

describe('folder route v4 coordinator', () => {
  it('finishes a real PATCH through the shared final verifier', async () => {
    await fs.mkdir(path.join(vault, 'proj'))
    await fs.writeFile(path.join(vault, 'proj', 'a.md'), '# a\n')
    saveDocumentMetadata(db, {
      id: 'route-a-id',
      path: 'proj/a',
      title: 'A',
      updatedAt: 1,
    })

    const response = await app.fetch(new Request('http://localhost/api/folders/proj', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPath: 'ren' }),
    }))

    expect(response.status).toBe(200)
    expect(await fs.readFile(path.join(vault, 'ren', 'a.md'), 'utf8')).toBe('# a\n')
    await expect(fs.stat(path.join(vault, 'proj'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(getDocumentMetadata(db, 'ren/a')?.id).toBe('route-a-id')
    expect(getDocumentMetadata(db, 'proj/a')).toBeNull()
    expect((await fs.readdir(vault)).some(name => name.includes('.docus-journal-'))).toBe(false)
  })
})
