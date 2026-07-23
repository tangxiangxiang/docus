// Unit tests for the create-only move primitives that protect rename
// destinations and rollback sources from external writers (round 5):
// POSIX rename(2) atomically REPLACES targets, so every move that can
// race an external editor (Obsidian/vim/sync ignore in-process locks)
// must be create-only — link(2) for files, an mkdir gate for folders.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { promises as fs, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyMigrations } from '../db'
import { getDocumentMetadata, saveDocumentMetadata } from '../documentMetadata'
import {
  RenameDestinationOccupiedError,
  RenameSourceReusedError,
  createOnlyMoveDirectory,
  createOnlyMoveFile,
  renameDocumentWithMetadata,
  __setCreateOnlyMoveHooksForTesting,
} from '../documentFileLifecycle'

let dir: string
let db: InstanceType<typeof Database>

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-move-'))
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  applyMigrations(db)
})

afterEach(async () => {
  __setCreateOnlyMoveHooksForTesting(null)
  db.close()
  await fs.rm(dir, { recursive: true, force: true })
})

async function names(): Promise<string[]> {
  return fs.readdir(dir)
}

describe('createOnlyMoveFile', () => {
  it('never overwrites an external destination when hard links are unsupported', async () => {
    const from = path.join(dir, 'old.md')
    const to = path.join(dir, 'new.md')
    await fs.writeFile(from, '# ours\n', 'utf8')
    const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(Object.assign(new Error('unsupported'), { code: 'EPERM' }))
    const realStat = fs.stat.bind(fs)
    const stat = vi.spyOn(fs, 'stat').mockImplementationOnce(async (candidate) => {
      expect(candidate).toBe(to)
      await fs.writeFile(to, '# external\n', 'utf8')
      throw Object.assign(new Error('not found at check time'), { code: 'ENOENT' })
    }).mockImplementation(realStat)
    try {
      await expect(createOnlyMoveFile(from, to)).rejects.toMatchObject({ code: 'EPERM' })
      expect(await fs.readFile(to, 'utf8')).toBe('# external\n')
      expect(await fs.readFile(from, 'utf8')).toBe('# ours\n')
    } finally {
      link.mockRestore()
      stat.mockRestore()
    }
  })

  it('reports source reuse when a non-EEXIST link failure leaves the old generation staged', async () => {
    const from = path.join(dir, 'old.md')
    const to = path.join(dir, 'new.md')
    await fs.writeFile(from, '# ours\n', 'utf8')
    const link = vi.spyOn(fs, 'link').mockImplementationOnce(async () => {
      await fs.writeFile(from, '# external\n', 'utf8')
      throw Object.assign(new Error('injected I/O failure'), { code: 'EIO' })
    })
    try {
      const error = await createOnlyMoveFile(from, to).catch((caught) => caught)
      expect(error).toBeInstanceOf(RenameSourceReusedError)
      expect(error.destinationOccupied).toBe(false)
      expect(error.survivingPath).toBe('staging')
      expect(await fs.readFile(from, 'utf8')).toBe('# external\n')
      expect((await names()).some((name) => name.includes('.docus-rename-'))).toBe(true)
    } finally { link.mockRestore() }
  })

  it('moves a file and leaves no staging residue', async () => {
    await fs.writeFile(path.join(dir, 'old.md'), '# doc\n', 'utf8')

    await createOnlyMoveFile(path.join(dir, 'old.md'), path.join(dir, 'new.md'))

    expect(await fs.readFile(path.join(dir, 'new.md'), 'utf8')).toBe('# doc\n')
    expect(await names()).toEqual(['new.md'])
  })

  it('fails closed when an external writer claimed the destination, preserving both files', async () => {
    await fs.writeFile(path.join(dir, 'old.md'), '# ours\n', 'utf8')
    await fs.writeFile(path.join(dir, 'new.md'), '# external\n', 'utf8')

    await expect(
      createOnlyMoveFile(path.join(dir, 'old.md'), path.join(dir, 'new.md')),
    ).rejects.toBeInstanceOf(RenameDestinationOccupiedError)

    // The external destination wins; the source is restored create-only.
    expect(await fs.readFile(path.join(dir, 'new.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(dir, 'old.md'), 'utf8')).toBe('# ours\n')
    expect((await names()).some((name) => name.includes('.docus-rename-'))).toBe(false)
  })

  it('moves to a nested destination and fsyncs nothing over an existing parent file', async () => {
    await fs.mkdir(path.join(dir, 'sub'), { recursive: true })
    await fs.writeFile(path.join(dir, 'old.md'), '# doc\n', 'utf8')

    await createOnlyMoveFile(path.join(dir, 'old.md'), path.join(dir, 'sub', 'moved.md'))

    expect(await fs.readFile(path.join(dir, 'sub', 'moved.md'), 'utf8')).toBe('# doc\n')
    expect(await fs.readdir(path.join(dir, 'sub'))).toEqual(['moved.md'])
    expect((await names()).some((name) => name.includes('.docus-rename-'))).toBe(false)
  })
})

describe('createOnlyMoveDirectory', () => {
  it('moves a whole tree in one atomic rename and leaves no gate residue', async () => {
    await fs.mkdir(path.join(dir, 'src'))
    await fs.writeFile(path.join(dir, 'src', 'a.md'), '# a\n', 'utf8')
    await fs.mkdir(path.join(dir, 'src', 'nested'))
    await fs.writeFile(path.join(dir, 'src', 'nested', 'b.md'), '# b\n', 'utf8')

    const moved = await createOnlyMoveDirectory(path.join(dir, 'src'), path.join(dir, 'dest'))

    expect(moved).toEqual({ restored: true })
    expect(await fs.readFile(path.join(dir, 'dest', 'a.md'), 'utf8')).toBe('# a\n')
    expect(await fs.readFile(path.join(dir, 'dest', 'nested', 'b.md'), 'utf8')).toBe('# b\n')
    expect(await names()).toEqual(['dest'])
  })

  it('fails closed when an external folder claimed the destination', async () => {
    await fs.mkdir(path.join(dir, 'src'))
    await fs.writeFile(path.join(dir, 'src', 'a.md'), '# a\n', 'utf8')
    await fs.mkdir(path.join(dir, 'dest'))
    await fs.writeFile(path.join(dir, 'dest', 'external.md'), '# external\n', 'utf8')

    const moved = await createOnlyMoveDirectory(path.join(dir, 'src'), path.join(dir, 'dest'))

    expect(moved).toEqual({ restored: false })
    expect(await fs.readFile(path.join(dir, 'dest', 'external.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(dir, 'src', 'a.md'), 'utf8')).toBe('# a\n')
  })

  it('fails closed when the destination is an external EMPTY directory', async () => {
    // The gate's job: rename(2) would silently REPLACE an empty
    // directory, destroying external state. mkdir's EEXIST must fail
    // the move closed BEFORE the rename is ever attempted.
    await fs.mkdir(path.join(dir, 'src'))
    await fs.writeFile(path.join(dir, 'src', 'a.md'), '# a\n', 'utf8')
    await fs.mkdir(path.join(dir, 'dest'))

    const moved = await createOnlyMoveDirectory(path.join(dir, 'src'), path.join(dir, 'dest'))

    expect(moved).toEqual({ restored: false })
    // External empty directory preserved; source tree untouched.
    expect(await fs.readdir(path.join(dir, 'dest'))).toEqual([])
    expect(await fs.readFile(path.join(dir, 'src', 'a.md'), 'utf8')).toBe('# a\n')
  })

  it('fails closed when the destination path holds a FILE', async () => {
    await fs.mkdir(path.join(dir, 'src'))
    await fs.writeFile(path.join(dir, 'dest'), '# a file, not a folder\n', 'utf8')

    const moved = await createOnlyMoveDirectory(path.join(dir, 'src'), path.join(dir, 'dest'))

    expect(moved).toEqual({ restored: false })
    expect(await fs.readFile(path.join(dir, 'dest'), 'utf8')).toBe('# a file, not a folder\n')
    expect((await fs.stat(path.join(dir, 'src'))).isDirectory()).toBe(true)
  })

  it('fails closed when external content lands inside the mkdir gate before the rename', async () => {
    // The dangerous in-flight window: our own empty gate directory is
    // claimed by an external writer between mkdir and rename. rename
    // then fails (ENOTEMPTY) and rmdir proves the directory is no
    // longer ours — the source tree must stay untouched.
    await fs.mkdir(path.join(dir, 'src'))
    await fs.writeFile(path.join(dir, 'src', 'a.md'), '# a\n', 'utf8')
    __setCreateOnlyMoveHooksForTesting({
      afterMkdirGate: async (gateDir) => {
        await fs.writeFile(path.join(gateDir, 'external.md'), '# external\n', 'utf8')
      },
    })

    const moved = await createOnlyMoveDirectory(path.join(dir, 'src'), path.join(dir, 'dest'))

    expect(moved).toEqual({ restored: false })
    expect(await fs.readFile(path.join(dir, 'dest', 'external.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(dir, 'src', 'a.md'), 'utf8')).toBe('# a\n')
  })
})

describe('renameDocumentWithMetadata (create-only default)', () => {
  it('never replaces an external destination file and leaves metadata untouched', async () => {
    await fs.writeFile(path.join(dir, 'old.md'), '# ours\n', 'utf8')
    await fs.writeFile(path.join(dir, 'new.md'), '# external\n', 'utf8')
    saveDocumentMetadata(db, { id: 'move-id', path: 'old', title: 'Old', updatedAt: 1 })

    await expect(renameDocumentWithMetadata({
      db, fromPath: 'old', toPath: 'new',
      fromAbs: path.join(dir, 'old.md'), toAbs: path.join(dir, 'new.md'),
    })).rejects.toBeInstanceOf(RenameDestinationOccupiedError)

    expect(await fs.readFile(path.join(dir, 'new.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(dir, 'old.md'), 'utf8')).toBe('# ours\n')
    // The metadata move never ran: identity still on the source path.
    expect(getDocumentMetadata(db, 'old')?.id).toBe('move-id')
    expect(getDocumentMetadata(db, 'new')).toBeNull()
  })

  it('moves file AND metadata on the happy path', async () => {
    await fs.writeFile(path.join(dir, 'old.md'), '# ours\n', 'utf8')
    saveDocumentMetadata(db, { id: 'move-id', path: 'old', title: 'Old', updatedAt: 1 })

    await renameDocumentWithMetadata({
      db, fromPath: 'old', toPath: 'new',
      fromAbs: path.join(dir, 'old.md'), toAbs: path.join(dir, 'new.md'),
    })

    expect(await fs.readFile(path.join(dir, 'new.md'), 'utf8')).toBe('# ours\n')
    expect(getDocumentMetadata(db, 'new')?.id).toBe('move-id')
    expect(getDocumentMetadata(db, 'old')).toBeNull()
    expect((await names()).some((name) => name.includes('.docus-rename-'))).toBe(false)
  })

  it('rollback never overwrites a re-used source path; identity follows the bytes', async () => {
    // The reviewer's rollback scenario: the forward move succeeds, the
    // metadata move then fails, and an external writer re-creates the
    // source path before the rollback runs. The create-only rollback
    // must fail closed (RenameSourceReusedError) with the external
    // file preserved — never a plain rename back over it.
    await fs.writeFile(path.join(dir, 'old.md'), '# ours\n', 'utf8')
    saveDocumentMetadata(db, { id: 'move-id', path: 'old', title: 'Old', updatedAt: 1 })

    await expect(renameDocumentWithMetadata({
      db, fromPath: 'old', toPath: 'new',
      fromAbs: path.join(dir, 'old.md'), toAbs: path.join(dir, 'new.md'),
      moveMetadata: () => {
        // External writer re-uses the now-empty source path, then the
        // metadata move "fails".
        writeFileSync(path.join(dir, 'old.md'), '# external\n', 'utf8')
        throw new Error('injected metadata move failure')
      },
    })).rejects.toBeInstanceOf(RenameSourceReusedError)

    // External source file untouched; our bytes stayed at the destination.
    expect(await fs.readFile(path.join(dir, 'old.md'), 'utf8')).toBe('# external\n')
    expect(await fs.readFile(path.join(dir, 'new.md'), 'utf8')).toBe('# ours\n')
    expect((await names()).some((name) => name.includes('.docus-rename-'))).toBe(false)
  })
})
