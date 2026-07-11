import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations } from '../db'
import { saveDocumentMetadata } from '../documentMetadata'
import {
  cleanDocumentFrontmatter,
  exportDocumentFrontmatter,
  previewFrontmatterCleanup,
  renderCanonicalFrontmatter,
  restoreDocumentFrontmatter,
} from '../frontmatterArchive'
import { getMetadataMigrationRecord, migrateVaultMetadata, trackCleanedDocumentWrite } from '../metadataMigration'
import { CONTENT_DIR, setContentDir } from '../paths'

let db: Database.Database
let root: string
const originalContentDir = CONTENT_DIR

beforeEach(async () => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-frontmatter-archive-'))
  setContentDir(root)
})

afterEach(async () => {
  setContentDir(originalContentDir)
  db.close()
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, raw: string) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, raw, 'utf8')
}

describe('Frontmatter archive and cleanup preview', () => {
  it('exports canonical database metadata in a stable field order', () => {
    const metadata = saveDocumentMetadata(db, {
      path: 'note', title: 'Title', summary: 'Summary', tags: ['a'], aliases: ['Alias'],
      createdAt: Date.UTC(2025, 0, 2), updatedAt: Date.UTC(2026, 1, 3),
    })
    expect(renderCanonicalFrontmatter(metadata)).toBe([
      '---', 'title: Title', 'created: 2025-01-02', 'updated: 2026-02-03',
      'tags:', '  - a', 'summary: Summary', 'aliases:', '  - Alias', '---', '', '',
    ].join('\n'))
  })

  it('previews only verified, hash-matching files and reports custom fields', async () => {
    const raw = '---\ntitle: Legacy\nsource: inbox/original\ncustom: value\n---\n\n# Body\n'
    await write('note.md', raw)
    await migrateVaultMetadata(db, root)
    const preview = await previewFrontmatterCleanup(db)
    expect(preview.blocked).toEqual([])
    expect(preview.candidates).toEqual([expect.objectContaining({
      path: 'note', removedBytes: Buffer.byteLength('---\ntitle: Legacy\nsource: inbox/original\ncustom: value\n---\n\n'),
      customFields: ['custom', 'source'],
    })])
    expect(exportDocumentFrontmatter(db, 'note', 'original')).toContain('source: inbox/original')
    expect(exportDocumentFrontmatter(db, 'note', 'canonical')).toContain('title: Legacy')
  })

  it('blocks cleanup when the source changes after verification', async () => {
    await write('note.md', '---\ntitle: Note\n---\n\nbody\n')
    await migrateVaultMetadata(db, root)
    await fs.appendFile(path.join(root, 'note.md'), 'changed\n')
    const preview = await previewFrontmatterCleanup(db)
    expect(preview.candidates).toEqual([])
    expect(preview.blocked).toEqual([{ path: 'note', reason: 'source changed after verification' }])
  })

  it('cleans verified Frontmatter and restores the exact original bytes', async () => {
    const raw = '---\n# comment\ntitle: Note\ncustom: yes\n---\n\n# Body\n'
    await write('note.md', raw)
    await migrateVaultMetadata(db, root)

    const cleaned = await cleanDocumentFrontmatter(db, ['note'])
    expect(cleaned.failed).toEqual([])
    expect(cleaned.changed[0].newRaw).toBe('# Body\n')
    expect(await fs.readFile(path.join(root, 'note.md'), 'utf8')).toBe('# Body\n')
    expect(getMetadataMigrationRecord(db, 'note')?.status).toBe('cleaned')

    const startupPass = await migrateVaultMetadata(db, root)
    expect(startupPass.skipped).toBe(1)
    expect(getMetadataMigrationRecord(db, 'note')?.status).toBe('cleaned')

    const restored = await restoreDocumentFrontmatter(db, ['note'], 'original')
    expect(restored.failed).toEqual([])
    expect(await fs.readFile(path.join(root, 'note.md'), 'utf8')).toBe(raw)
    expect(getMetadataMigrationRecord(db, 'note')?.status).toBe('verified')
  })

  it('refuses restore when the cleaned body changed outside the tracked write flow', async () => {
    await write('note.md', '---\ntitle: Note\n---\n\nbody\n')
    await migrateVaultMetadata(db, root)
    await cleanDocumentFrontmatter(db, ['note'])
    await fs.appendFile(path.join(root, 'note.md'), 'changed\n')
    const restored = await restoreDocumentFrontmatter(db, ['note'], 'original')
    expect(restored.changed).toEqual([])
    expect(restored.failed[0]).toMatchObject({ path: 'note', reason: expect.stringContaining('body changed') })
  })

  it('allows restore after a tracked editor or AI body write', async () => {
    await write('note.md', '---\ntitle: Note\n---\n\nbody\n')
    await migrateVaultMetadata(db, root)
    await cleanDocumentFrontmatter(db, ['note'])
    await fs.writeFile(path.join(root, 'note.md'), 'edited body\n', 'utf8')
    expect(trackCleanedDocumentWrite(db, 'note', 'edited body\n')).toBe(true)
    const restored = await restoreDocumentFrontmatter(db, ['note'], 'original')
    expect(restored.failed).toEqual([])
    expect(await fs.readFile(path.join(root, 'note.md'), 'utf8')).toContain('edited body\n')
  })
})
