import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

import { recoverInterruptedOperations } from '../crashRecovery'
import { applyMigrations } from '../db'
import { writeDurableJournal } from '../atomicTextWrite'
import {
  restoreDocumentMetadataMutationCAS,
  saveDocumentMetadata,
  snapshotDocumentMetadataMutation,
  validateSnapshotOwnership,
} from '../documentMetadata'
import { validateFolderMoveJournalV4Provenance } from '../folderMoveJournalValidation'
import {
  AtomicRenameLandedGenerationReadError,
  executeFolderMoveV4Physical,
} from '../folderMoveV4Executor'
import {
  listPhysicalMoveEntries,
  type FolderMoveJournalV4,
} from '../folderMoveTransaction'
import { setContentDir } from '../paths'

const TSX_CLI = fileURLToPath(import.meta.resolve('tsx/cli'))
const ATOMIC_CRASH_CHILD = path.join(
  import.meta.dirname,
  'fixtures',
  'folder-atomic-after-rename-crash-child.ts',
)

let vault: string
let db: Database.Database

beforeEach(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-round15-'))
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  setContentDir(vault)
})

afterEach(async () => {
  vi.restoreAllMocks()
  db.close()
  await fs.rm(vault, { recursive: true, force: true })
})

async function seed(files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(vault, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content)
  }
}

async function writeJournal(journal: FolderMoveJournalV4): Promise<string> {
  const journalAbs = path.join(vault, '.proj.docus-journal-abcdef012345')
  await fs.writeFile(journalAbs, JSON.stringify(journal))
  return journalAbs
}

function makeManifestJournal(
  entries: FolderMoveJournalV4['entries'],
  directories: string[],
): FolderMoveJournalV4 {
  return {
    version: 4,
    op: 'folder-rename',
    phase: 'files-landed',
    srcRel: 'proj',
    destRel: 'ren',
    strategy: 'atomic-rename',
    sourceDev: 1,
    sourceIno: 1,
    destDev: '1',
    destIno: '1',
    entries,
    directories,
    metadataDisposition: { kind: 'prefix-move' },
  }
}

describe('Round-15 directory manifest closure', () => {
  const entry = (relativeFilePath: string): FolderMoveJournalV4['entries'][number] => ({
    relativeFilePath,
    sourceDev: '1',
    sourceIno: '1',
    sourceHash: 'a'.repeat(64),
    documentId: 'doc-1',
    documentPath: `proj/${relativeFilePath.slice(0, -3)}`,
  })

  it('accepts a root-level file with an empty directory manifest', async () => {
    const journal = makeManifestJournal([entry('a.md')], [])
    const journalAbs = await writeJournal(journal)
    expect(await validateFolderMoveJournalV4Provenance(journal, vault, journalAbs)).toBeNull()
  })

  it('requires and accepts the parent closure for nested files', async () => {
    const missing = makeManifestJournal([entry('sub/a.md')], [])
    const journalAbs = await writeJournal(missing)
    expect(await validateFolderMoveJournalV4Provenance(missing, vault, journalAbs))
      .toContain('file parent sub')

    const complete = makeManifestJournal([entry('sub/a.md')], ['sub'])
    await fs.writeFile(journalAbs, JSON.stringify(complete))
    expect(await validateFolderMoveJournalV4Provenance(complete, vault, journalAbs)).toBeNull()
  })
})

describe('Round-15 metadata-committed physical parity', () => {
  it.each([
    ['missing file', async () => {
      await fs.rm(path.join(vault, 'ren/a.md'))
    }],
    ['extra file', async () => {
      await fs.writeFile(path.join(vault, 'ren/external.txt'), 'external')
    }],
    ['replaced inode', async () => {
      const replacement = path.join(vault, 'replacement')
      await fs.writeFile(replacement, '# hello\n')
      await fs.rm(path.join(vault, 'ren/a.md'))
      await fs.rename(replacement, path.join(vault, 'ren/a.md'))
    }],
    ['missing directory', async () => {
      await fs.rmdir(path.join(vault, 'ren/empty'))
    }],
    ['extra directory', async () => {
      await fs.mkdir(path.join(vault, 'ren/external'))
    }],
  ])('retains the journal for a %s', async (_label, mutate) => {
    await seed({ 'ren/a.md': '# hello\n' })
    await fs.mkdir(path.join(vault, 'ren/empty'))
    saveDocumentMetadata(db, { id: 'doc-1', path: 'ren/a', title: 'Hello' })
    const destinationStat = await fs.stat(path.join(vault, 'ren'), { bigint: true })
    const physical = await listPhysicalMoveEntries(path.join(vault, 'ren'), (relativeFilePath) =>
      relativeFilePath === 'a.md'
        ? { documentId: 'doc-1', documentPath: 'proj/a' }
        : null,
    )
    const journal: FolderMoveJournalV4 = {
      version: 4,
      op: 'folder-rename',
      phase: 'metadata-committed',
      srcRel: 'proj',
      destRel: 'ren',
      strategy: 'atomic-rename',
      sourceDev: Number(destinationStat.dev),
      sourceIno: Number(destinationStat.ino),
      destDev: destinationStat.dev.toString(),
      destIno: destinationStat.ino.toString(),
      entries: physical.entries.map((entry) => ({
        relativeFilePath: entry.relativeFilePath,
        sourceDev: entry.sourceDev!,
        sourceIno: entry.sourceIno!,
        sourceHash: entry.sourceHash,
        documentId: entry.documentId,
        documentPath: entry.documentPath,
      })),
      directories: physical.directories,
      metadataDisposition: { kind: 'prefix-move' },
    }
    const journalAbs = await writeJournal(journal)
    await mutate()

    const report = await recoverInterruptedOperations(vault, db)

    expect(report.actions).toContainEqual(expect.objectContaining({
      action: 'quarantined',
      detail: expect.stringContaining('metadata-committed destination exact parity failed'),
    }))
    expect(await fs.stat(journalAbs)).toBeDefined()
    expect(db.prepare('SELECT id FROM documents WHERE path = ?').get('ren/a')).toEqual({ id: 'doc-1' })
  })
})

describe('Round-15 real atomic route crash', () => {
  it('recovers and remains idempotent after rename lands before destination stat', async () => {
    await seed({ 'proj/a.md': '# hello\n' })
    const sourceStat = await fs.stat(path.join(vault, 'proj'), { bigint: true })
    const dbPath = path.join(vault, 'metadata.sqlite')
    const child = spawn(process.execPath, [TSX_CLI, ATOMIC_CRASH_CHILD], {
      env: {
        ...process.env,
        DOCUS_FOLDER_VAULT: vault,
        DOCUS_FOLDER_DB: dbPath,
      },
      stdio: 'pipe',
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    expect(stdout, stderr).toContain('READY:ATOMIC_RENAME_LANDED')
    expect(exit.code).toBe(92)
    await expect(fs.stat(path.join(vault, 'proj'))).rejects.toMatchObject({ code: 'ENOENT' })
    const destinationStat = await fs.stat(path.join(vault, 'ren'), { bigint: true })
    expect(destinationStat.dev.toString()).toBe(sourceStat.dev.toString())
    expect(destinationStat.ino.toString()).toBe(sourceStat.ino.toString())

    const journalName = (await fs.readdir(vault)).find(name => name.startsWith('.proj.docus-journal-'))
    expect(journalName).toBeDefined()
    const journalAbs = path.join(vault, journalName!)
    const journal = JSON.parse(await fs.readFile(journalAbs, 'utf8')) as FolderMoveJournalV4
    expect(journal.phase).toBe('gate-created')
    expect(`${journal.destDev}:${journal.destIno}`).not.toBe(
      `${destinationStat.dev}:${destinationStat.ino}`,
    )
    expect(`${journal.sourceDev}:${journal.sourceIno}`).toBe(
      `${destinationStat.dev}:${destinationStat.ino}`,
    )

    const persistedDb = new Database(dbPath)
    try {
      const first = await recoverInterruptedOperations(vault, persistedDb)
      expect(first.actions).toContainEqual(expect.objectContaining({ action: 'completed-rename' }))
      await expect(fs.stat(journalAbs)).rejects.toMatchObject({ code: 'ENOENT' })
      const identity = persistedDb.prepare('SELECT id FROM documents WHERE path = ?')
        .get('ren/a') as { id: string }
      expect(identity.id).toBeTruthy()

      const second = await recoverInterruptedOperations(vault, persistedDb)
      expect(second.actions.some(action => action.action === 'completed-rename')).toBe(false)
      expect(persistedDb.prepare('SELECT id FROM documents WHERE path = ?').get('ren/a'))
        .toEqual(identity)
      expect((await fs.readdir(vault)).some(name => name.includes('.docus-journal-'))).toBe(false)
    } finally {
      persistedDb.close()
    }
  })
})

describe('Round-15 post-rename stat failure', () => {
  it('retains a gate-created journal that recovery can complete', async () => {
    await seed({ 'proj/a.md': '# hello\n' })
    saveDocumentMetadata(db, { id: 'doc-1', path: 'proj/a', title: 'Hello' })
    const sourceStat = await fs.stat(path.join(vault, 'proj'), { bigint: true })
    const physical = await listPhysicalMoveEntries(path.join(vault, 'proj'), relativeFilePath =>
      relativeFilePath === 'a.md'
        ? { documentId: 'doc-1', documentPath: 'proj/a' }
        : null,
    )
    const prepared: FolderMoveJournalV4 & { phase: 'prepared' } = {
      version: 4,
      op: 'folder-rename',
      phase: 'prepared',
      srcRel: 'proj',
      destRel: 'ren',
      strategy: 'atomic-rename',
      sourceDev: Number(sourceStat.dev),
      sourceIno: Number(sourceStat.ino),
      entries: physical.entries.map(entry => ({
        relativeFilePath: entry.relativeFilePath,
        sourceDev: entry.sourceDev!,
        sourceIno: entry.sourceIno!,
        sourceHash: entry.sourceHash,
        documentId: entry.documentId,
        documentPath: entry.documentPath,
      })),
      directories: physical.directories,
      metadataDisposition: { kind: 'prefix-move' },
    }
    const journalAbs = path.join(vault, '.proj.docus-journal-abcdef012345')
    await writeDurableJournal(journalAbs, prepared)
    let renameLanded = false
    const realStat = fs.stat.bind(fs)
    vi.spyOn(fs, 'stat').mockImplementation(async (target, options) => {
      if (renameLanded && String(target) === path.join(vault, 'ren')) {
        throw Object.assign(new Error('injected post-rename stat failure'), { code: 'EIO' })
      }
      return realStat(target, options as never)
    })

    await expect(executeFolderMoveV4Physical({
      contentDir: vault,
      journalAbs,
      journal: prepared,
      srcAbs: path.join(vault, 'proj'),
      destAbs: path.join(vault, 'ren'),
      strategy: 'atomic-rename',
      afterAtomicRenameBeforeParity: () => { renameLanded = true },
    })).rejects.toBeInstanceOf(AtomicRenameLandedGenerationReadError)

    const persisted = JSON.parse(await fs.readFile(journalAbs, 'utf8')) as FolderMoveJournalV4
    expect(persisted.phase).toBe('gate-created')
    await expect(realStat(path.join(vault, 'proj'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await realStat(path.join(vault, 'ren'))).toBeDefined()
    vi.restoreAllMocks()

    const report = await recoverInterruptedOperations(vault, db)
    expect(report.actions).toContainEqual(expect.objectContaining({ action: 'completed-rename' }))
    await expect(fs.stat(journalAbs)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(db.prepare('SELECT id FROM documents WHERE path = ?').get('ren/a')).toEqual({ id: 'doc-1' })
  })
})

describe('Round-15 snapshot CAS full-row ownership', () => {
  it.each([
    ['document title', "UPDATE documents SET title = 'External' WHERE id = 'doc-1'"],
    ['document summary', "UPDATE documents SET summary = 'External' WHERE id = 'doc-1'"],
    ['document created_at', "UPDATE documents SET created_at = 998 WHERE id = 'doc-1'"],
    ['document updated_at', "UPDATE documents SET updated_at = 999 WHERE id = 'doc-1'"],
    ['tag name', "UPDATE tags SET name = 'External' WHERE normalized_name = 'owned'"],
    ['tag normalized_name', "UPDATE tags SET normalized_name = 'external' WHERE normalized_name = 'owned'"],
    ['document tag', `INSERT INTO tags (id, name, normalized_name) VALUES (999, 'External', 'external');
      DELETE FROM document_tags WHERE document_id = 'doc-1';
      INSERT INTO document_tags (document_id, tag_id) VALUES ('doc-1', 999)`],
    ['embedding content_hash', "UPDATE document_embeddings SET content_hash = 'external' WHERE document_id = 'doc-1'"],
    ['embedding model', "UPDATE document_embeddings SET model = 'external' WHERE document_id = 'doc-1'"],
    ['embedding bytes', "UPDATE document_embeddings SET embedding = X'0909' WHERE document_id = 'doc-1'"],
    ['embedding indexed_at', "UPDATE document_embeddings SET indexed_at = 999 WHERE document_id = 'doc-1'"],
    ['migration original_path', "UPDATE metadata_migrations SET original_path = 'external/a' WHERE path = 'proj/a'"],
    ['migration status', "UPDATE metadata_migrations SET status = 'failed' WHERE path = 'proj/a'"],
    ['migration source_hash', "UPDATE metadata_migrations SET source_hash = 'external' WHERE path = 'proj/a'"],
    ['migration error', "UPDATE metadata_migrations SET error = 'external' WHERE path = 'proj/a'"],
    ['migration updated_at', "UPDATE metadata_migrations SET updated_at = 999 WHERE path = 'proj/a'"],
  ])('rejects %s drift without overwriting it', (_label, mutation) => {
    saveDocumentMetadata(db, {
      id: 'doc-1',
      path: 'proj/a',
      title: 'Owned',
      summary: 'Owned summary',
      tags: ['Owned'],
      createdAt: 1,
      updatedAt: 2,
    })
    db.prepare(`INSERT INTO document_embeddings
      (document_id, content_hash, model, embedding, indexed_at)
      VALUES ('doc-1', 'owned', 'owned', X'0102', 1)`).run()
    db.prepare(`INSERT INTO metadata_migrations
      (path, document_id, original_path, status, source_hash, error, updated_at)
      VALUES ('proj/a', 'doc-1', 'proj/a', 'verified', 'owned', '', 1)`).run()
    const snapshot = snapshotDocumentMetadataMutation(db, ['proj/a'])
    db.exec(mutation)

    expect(() => restoreDocumentMetadataMutationCAS(
      db,
      snapshot,
      current => validateSnapshotOwnership(current, snapshot),
    )).toThrow(/metadata ownership/)

    const current = snapshotDocumentMetadataMutation(db, ['proj/a'])
    expect(validateSnapshotOwnership(current, snapshot)).toBe(false)
  })
})
