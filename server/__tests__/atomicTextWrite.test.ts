import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AtomicTextWriteConflictError,
  AtomicTextWriteTargetMissingError,
  UnstableTextSnapshotError,
  atomicRemoveTextIfUnchanged,
  atomicReplaceText,
  atomicReplaceTextIfUnchanged,
  prepareAtomicTextCreate,
  prepareAtomicTextWrite,
  readStableTextSnapshot,
  removeDurableJournal,
  writeDurableJournal,
} from '../atomicTextWrite'

let directory = ''
let target = ''

async function temporaryFiles(): Promise<string[]> {
  return (await fs.readdir(directory)).filter((name) => name.includes('.docus-save-'))
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'docus-atomic-write-'))
  target = path.join(directory, 'note.md')
  await fs.writeFile(target, 'original', 'utf8')
  await fs.chmod(target, 0o640)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('atomic text writes', () => {
  it('fsyncs the parent directory after journal creation and removal', async () => {
    const journal = path.join(directory, '.note.md.docus-journal-aaaa')
    const opened: string[] = []
    const originalOpen = fs.open.bind(fs)
    const open = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      opened.push(String(args[0]))
      return originalOpen(...args)
    })
    try {
      await writeDurableJournal(journal, { version: 1, op: 'test' })
      expect(opened).toContain(directory)
      opened.length = 0
      await removeDurableJournal(journal)
      expect(opened).toContain(directory)
    } finally { open.mockRestore() }
  })

  it('replaces complete content, preserves mode, and removes its temporary file', async () => {
    const before = await fs.stat(target)
    await atomicReplaceText(target, 'complete replacement', { mode: before.mode })

    const after = await fs.stat(target)
    expect(await fs.readFile(target, 'utf8')).toBe('complete replacement')
    expect(after.mode & 0o777).toBe(before.mode & 0o777)
    expect(await temporaryFiles()).toEqual([])
  })

  it('keeps the original intact and cleans up when rename fails', async () => {
    const renameError = Object.assign(new Error('rename failed'), { code: 'EIO' })
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(renameError)

    await expect(atomicReplaceText(target, 'replacement')).rejects.toThrow('rename failed')
    expect(rename).toHaveBeenCalledOnce()
    expect(await fs.readFile(target, 'utf8')).toBe('original')
    expect(await temporaryFiles()).toEqual([])
  })

  it('can discard a prepared complete write without touching the target', async () => {
    const prepared = await prepareAtomicTextWrite(target, 'replacement')
    expect(await fs.readFile(target, 'utf8')).toBe('original')
    expect(await temporaryFiles()).toHaveLength(1)

    await prepared.rollback()
    expect(await fs.readFile(target, 'utf8')).toBe('original')
    expect(await temporaryFiles()).toEqual([])
  })

  it('atomically creates without replacing an existing target', async () => {
    const prepared = await prepareAtomicTextCreate(target, 'replacement')
    await expect(prepared.commit()).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(target, 'utf8')).toBe('original')
    expect(await temporaryFiles()).toEqual([])

    const missing = path.join(directory, 'created.md')
    const create = await prepareAtomicTextCreate(missing, 'created')
    await create.commit()
    expect(await fs.readFile(missing, 'utf8')).toBe('created')
    expect(await temporaryFiles()).toEqual([])
  })

  it('retries a snapshot when content changes between read and stat', async () => {
    const readFile = vi.spyOn(fs, 'readFile')
      .mockResolvedValueOnce('B')
      .mockResolvedValueOnce('C')
      .mockResolvedValueOnce('C')
      .mockResolvedValueOnce('C')

    const snapshot = await readStableTextSnapshot(target)

    expect(snapshot.raw).toBe('C')
    expect(readFile).toHaveBeenCalledTimes(4)
  })

  it('fails closed when the content never stabilizes', async () => {
    const readFile = vi.spyOn(fs, 'readFile')
      .mockResolvedValueOnce('B')
      .mockResolvedValueOnce('C')
      .mockResolvedValueOnce('B')
      .mockResolvedValueOnce('C')
      .mockResolvedValueOnce('B')
      .mockResolvedValueOnce('C')

    await expect(readStableTextSnapshot(target)).rejects
      .toBeInstanceOf(UnstableTextSnapshotError)
    expect(readFile).toHaveBeenCalledTimes(6)
  })

  it('does not restore over content that changed after the original replacement', async () => {
    await fs.writeFile(target, 'external C', 'utf8')

    await expect(atomicReplaceTextIfUnchanged(
      target,
      'written B',
      'previous A',
    )).rejects.toBeInstanceOf(AtomicTextWriteConflictError)

    expect(await fs.readFile(target, 'utf8')).toBe('external C')
    expect(await temporaryFiles()).toEqual([])
  })
})

/**
 * The ownership protocol: the commit takes ownership of the current
 * generation FIRST (atomic rename aside), verifies the staged bytes,
 * and only then links the replacement in create-only. There is no
 * check-to-rename window — an external writer winning any race keeps
 * its bytes and the call fails closed. These tests pin that contract
 * at the helper level; the REST/AI routes build on it.
 */
describe('ownership-verified commit (no check-to-rename window)', () => {
  /** Every on-disk intermediate the protocol can create. */
  async function intermediateFiles(): Promise<string[]> {
    return (await fs.readdir(directory)).filter((name) =>
      name.includes('.docus-save-')
        || name.includes('.docus-staged-')
        || name.includes('.docus-remove-'))
  }

  it('replaces when the expectation still holds, preserving mode, leaving no intermediates', async () => {
    const before = await fs.stat(target)

    await atomicReplaceTextIfUnchanged(target, 'original', 'replacement')

    const after = await fs.stat(target)
    expect(await fs.readFile(target, 'utf8')).toBe('replacement')
    expect(after.mode & 0o777).toBe(before.mode & 0o777)
    expect(await intermediateFiles()).toEqual([])
  })

  it('detects an external save that lands before the takeover and keeps the external bytes', async () => {
    // The reviewer scenario: target holds base A, the caller verified A
    // and prepared B, and an external writer saves C in the final
    // window before the commit touches the path. The external save must
    // travel with the generation into staging and be detected there —
    // never silently overwritten.
    const originalRename = fs.rename.bind(fs)
    const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      await fs.writeFile(target, 'external C', 'utf8')
      return originalRename(from as string, to as string)
    })
    try {
      await expect(atomicReplaceTextIfUnchanged(
        target,
        'base A',
        'docus B',
      )).rejects.toBeInstanceOf(AtomicTextWriteConflictError)

      expect(await fs.readFile(target, 'utf8')).toBe('external C')
      expect(await intermediateFiles()).toEqual([])
    } finally {
      rename.mockRestore()
    }
  })

  it('preserves an external file recreated after the takeover (create-only commit loses to EEXIST)', async () => {
    // After the current generation is staged, an external writer
    // recreates the path. The create-only link(2) commit must fail
    // closed and leave the external file untouched.
    const originalLink = fs.link.bind(fs)
    const link = vi.spyOn(fs, 'link').mockImplementationOnce(async () => {
      await fs.writeFile(target, 'external C', 'utf8')
      throw Object.assign(new Error('link exists'), { code: 'EEXIST' })
    })
    try {
      const prepared = await prepareAtomicTextWrite(target, 'docus B')
      await expect(prepared.commit('original')).rejects.toMatchObject({
        name: 'AtomicTextWriteConflictError',
        current: expect.objectContaining({ raw: 'external C' }),
      })

      expect(await fs.readFile(target, 'utf8')).toBe('external C')
      expect(await intermediateFiles()).toEqual([])
    } finally {
      link.mockRestore()
    }
  })

  it('reports a missing target instead of recreating it from stale expectations', async () => {
    const prepared = await prepareAtomicTextWrite(target, 'docus B')
    await fs.rm(target)

    await expect(prepared.commit('original')).rejects
      .toBeInstanceOf(AtomicTextWriteTargetMissingError)

    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await intermediateFiles()).toEqual([])
  })

  it('removes a file whose bytes still match the expectation', async () => {
    await atomicRemoveTextIfUnchanged(target, 'original')

    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await intermediateFiles()).toEqual([])
  })

  it('does not remove bytes an external writer replaced, and resolves without error', async () => {
    // The caller's write is already gone — the external bytes win and
    // the removal is a no-op, not a failure.
    await fs.writeFile(target, 'external C', 'utf8')

    await atomicRemoveTextIfUnchanged(target, 'our write A')

    expect(await fs.readFile(target, 'utf8')).toBe('external C')
    expect(await intermediateFiles()).toEqual([])
  })

  it('treats an already-missing target as a no-op removal', async () => {
    await fs.rm(target)

    await atomicRemoveTextIfUnchanged(target, 'whatever')

    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await intermediateFiles()).toEqual([])
  })
})
