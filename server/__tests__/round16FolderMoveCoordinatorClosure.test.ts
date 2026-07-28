import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

import app, { __setMetadataDbForTesting } from '../index'
import { recoverInterruptedOperations } from '../crashRecovery'
import { applyMigrations } from '../db'
import {
  getDocumentMetadata,
  saveDocumentMetadata,
} from '../documentMetadata'
import {
  __setCreateOnlyMoveHooksForTesting,
  __setDirectoryMoveStrategyOverrideForTesting,
} from '../documentFileLifecycle'
import { __resetLinkIndexForTesting } from '../linkIndex'
import { setContentDir } from '../paths'
import { __setFolderRaceHooksForTesting } from '../routes/folders'
import type { FolderMoveJournalV4 } from '../folderMoveTransaction'

const TSX_CLI = fileURLToPath(import.meta.resolve('tsx/cli'))
const DELETE_PREPARED_CHILD = path.join(
  import.meta.dirname,
  'fixtures',
  'folder-delete-prepared-crash-child.ts',
)

let vault: string
let originalContentDir: string
let db: Database.Database

beforeEach(async () => {
  originalContentDir = path.resolve(process.cwd(), 'src/content')
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-round16-'))
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
  __setMetadataDbForTesting(db)
  setContentDir(vault)
  __resetLinkIndexForTesting()
  __setDirectoryMoveStrategyOverrideForTesting('atomic-rename')
})

afterEach(async () => {
  vi.restoreAllMocks()
  __setCreateOnlyMoveHooksForTesting(null)
  __setDirectoryMoveStrategyOverrideForTesting(null)
  __setFolderRaceHooksForTesting(null)
  __setMetadataDbForTesting(null)
  db.close()
  setContentDir(originalContentDir)
  __resetLinkIndexForTesting()
  await fs.rm(vault, { recursive: true, force: true })
})

async function seedFolder(folder = 'proj'): Promise<void> {
  await fs.mkdir(path.join(vault, folder))
  await fs.writeFile(path.join(vault, folder, 'a.md'), '# hello\n')
  saveDocumentMetadata(db, {
    id: `${folder}-a-id`,
    path: `${folder}/a`,
    title: 'Hello',
    updatedAt: 1,
  })
}

async function patchFolder(
  source = 'proj',
  destination = 'ren',
  updateReferences = false,
): Promise<Response> {
  return app.fetch(new Request(`http://localhost/api/folders/${source}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newPath: destination, updateReferences }),
  }))
}

async function readOnlyV4Journal(): Promise<{
  absolutePath: string
  journal: FolderMoveJournalV4
}> {
  const names = (await fs.readdir(vault)).filter(name => name.includes('.docus-journal-'))
  expect(names).toHaveLength(1)
  const absolutePath = path.join(vault, names[0]!)
  return {
    absolutePath,
    journal: JSON.parse(await fs.readFile(absolutePath, 'utf8')) as FolderMoveJournalV4,
  }
}

describe('Round-16 HTTP executor ownership', () => {
  it('keeps a real post-rename stat failure under durable recovery ownership', async () => {
    await seedFolder()
    let renameLanded = false
    let injected = false
    const realStat = fs.stat.bind(fs)
    vi.spyOn(fs, 'stat').mockImplementation(async (target, options) => {
      if (renameLanded && !injected && String(target) === path.join(vault, 'ren')) {
        injected = true
        throw Object.assign(new Error('injected post-rename stat failure'), { code: 'EIO' })
      }
      return realStat(target, options as never)
    })
    __setCreateOnlyMoveHooksForTesting({
      afterAtomicRenameBeforeParity: () => { renameLanded = true },
    })

    const response = await patchFolder()

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/recovery journal retained/),
    })
    const persisted = await readOnlyV4Journal()
    expect(persisted.journal.phase).toBe('gate-created')
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect(getDocumentMetadata(db, 'ren/a')).toBeNull()
    await expect(realStat(path.join(vault, 'proj'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(vault, 'ren', 'a.md'), 'utf8')).toBe('# hello\n')

    vi.restoreAllMocks()
    __setCreateOnlyMoveHooksForTesting(null)
    const first = await recoverInterruptedOperations(vault, db)
    expect(first.actions).toContainEqual(expect.objectContaining({
      action: 'completed-rename',
      detail: 'v4 metadata-committed transaction verified and cleaned',
    }))
    expect(getDocumentMetadata(db, 'ren/a')?.id).toBe('proj-a-id')
    await expect(fs.stat(persisted.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' })
    const second = await recoverInterruptedOperations(vault, db)
    expect(second.actions).toEqual([])
  })

  it('does not enter the legacy outer rollback when the landed generation mismatches', async () => {
    await seedFolder()
    const ownedStash = path.join(vault, 'owned-stash')
    __setCreateOnlyMoveHooksForTesting({
      afterAtomicRenameBeforeParity: async (_source, destination) => {
        await fs.rename(destination, ownedStash)
        await fs.mkdir(destination)
        await fs.writeFile(path.join(destination, 'a.md'), '# external\n')
      },
    })

    const response = await patchFolder()

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/generation.*recovery journal retained/i),
    })
    const persisted = await readOnlyV4Journal()
    expect(persisted.journal.phase).toBe('gate-created')
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect(getDocumentMetadata(db, 'ren/a')).toBeNull()
    expect(await fs.readFile(path.join(vault, 'ren', 'a.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(ownedStash, 'a.md'), 'utf8')).toBe('# hello\n')

    __setCreateOnlyMoveHooksForTesting(null)
    const report = await recoverInterruptedOperations(vault, db)
    expect(report.actions).toContainEqual({
      path: persisted.absolutePath,
      action: 'quarantined',
      detail: 'atomic gate-created state cannot prove either an intact gate or a landed source generation',
    })
    expect(await fs.readFile(path.join(vault, 'ren', 'a.md'), 'utf8')).toBe('# external\n')
    expect(await fs.stat(persisted.absolutePath)).toBeDefined()
  })

  it('rereads a gate-created journal after the files-landed rewrite fails', async () => {
    await seedFolder()
    let renameLanded = false
    let injected = false
    const realRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (renameLanded && !injected
        && String(from).includes('.rewrite-')
        && String(to).includes('.docus-journal-')) {
        injected = true
        throw Object.assign(new Error('injected files-landed rewrite failure'), { code: 'EIO' })
      }
      return realRename(from, to)
    })
    __setCreateOnlyMoveHooksForTesting({
      afterAtomicRenameBeforeParity: () => { renameLanded = true },
    })

    const response = await patchFolder()

    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/durable phase gate-created.*recovery journal retained/i),
    })
    const persisted = await readOnlyV4Journal()
    expect(persisted.journal.phase).toBe('gate-created')
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect(getDocumentMetadata(db, 'ren/a')).toBeNull()
    expect(await fs.readFile(path.join(vault, 'ren', 'a.md'), 'utf8')).toBe('# hello\n')
  })
})

describe('Round-16 prepared snapshot restore recovery', () => {
  it('resumes a delete rollback killed immediately after its prepared journal', async () => {
    await fs.mkdir(path.join(vault, 'gone'))
    await fs.writeFile(path.join(vault, 'gone', 'a.md'), '# delete rollback\n')
    const dbPath = path.join(vault, 'metadata.sqlite')
    const persistedDb = new Database(dbPath)
    persistedDb.pragma('foreign_keys = ON')
    applyMigrations(persistedDb)
    saveDocumentMetadata(persistedDb, {
      id: 'delete-a-id',
      path: 'gone/a',
      title: 'Delete rollback',
      updatedAt: 1,
    })
    persistedDb.close()

    const child = spawn(process.execPath, [TSX_CLI, DELETE_PREPARED_CHILD], {
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
    const exit = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolve(code))
    })
    expect(stdout, stderr).toContain('READY:DELETE_ROLLBACK_PREPARED')
    expect(exit).toBe(93)

    const prepared = await readOnlyV4Journal()
    expect(prepared.journal.phase).toBe('prepared')
    expect(prepared.journal.metadataDisposition.kind).toBe('snapshot-restore')
    await expect(fs.stat(path.join(vault, 'gone'))).rejects.toMatchObject({ code: 'ENOENT' })

    const recoveryDb = new Database(dbPath)
    try {
      const first = await recoverInterruptedOperations(vault, recoveryDb)
      expect(first.actions).toContainEqual(expect.objectContaining({
        action: 'completed-rename',
        detail: 'v4 metadata-committed transaction verified and cleaned',
      }))
      expect(await fs.readFile(path.join(vault, 'gone', 'a.md'), 'utf8')).toBe('# delete rollback\n')
      expect(getDocumentMetadata(recoveryDb, 'gone/a')?.id).toBe('delete-a-id')
      await expect(fs.stat(prepared.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' })

      const second = await recoverInterruptedOperations(vault, recoveryDb)
      expect(second.actions).toEqual([])
      expect(getDocumentMetadata(recoveryDb, 'gone/a')?.id).toBe('delete-a-id')
    } finally {
      recoveryDb.close()
    }
  })
})

describe('Round-16 reverse final verification', () => {
  it('retains the rollback journal when the restored directory inode is externally replaced', async () => {
    await seedFolder()
    await fs.writeFile(path.join(vault, 'ref.md'), 'see [[proj/a]]\n')
    await app.fetch(new Request('http://localhost/api/links/index'))
    const replacementStash = path.join(vault, 'restored-owned-stash')
    __setFolderRaceHooksForTesting({
      afterRenamePlanBuilt: async () => {
        await fs.writeFile(path.join(vault, 'ref.md'), 'external save\n')
      },
    })
    __setCreateOnlyMoveHooksForTesting({
      afterReverseMetadataBeforeFinalVerify: async (source) => {
        await fs.rename(source, replacementStash)
        await fs.mkdir(source)
        await fs.copyFile(
          path.join(replacementStash, 'a.md'),
          path.join(source, 'a.md'),
        )
      },
    } as Parameters<typeof __setCreateOnlyMoveHooksForTesting>[0])

    const response = await patchFolder('proj', 'ren', true)

    expect(response.status).toBe(409)
    const persisted = await readOnlyV4Journal()
    expect(persisted.journal.phase).toBe('metadata-committed')
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
    expect(getDocumentMetadata(db, 'ren/a')).toBeNull()
    expect(await fs.readFile(path.join(vault, 'proj', 'a.md'), 'utf8')).toBe('# hello\n')
    expect(await fs.readFile(path.join(replacementStash, 'a.md'), 'utf8')).toBe('# hello\n')

    __setFolderRaceHooksForTesting(null)
    __setCreateOnlyMoveHooksForTesting(null)
    const report = await recoverInterruptedOperations(vault, db)
    expect(report.actions).toContainEqual({
      path: persisted.absolutePath,
      action: 'quarantined',
      detail: 'metadata-committed destination generation does not match journal',
    })
    expect(await fs.stat(persisted.absolutePath)).toBeDefined()
    expect(getDocumentMetadata(db, 'proj/a')?.id).toBe('proj-a-id')
  })
})
