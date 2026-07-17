import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AtomicTextWriteConflictError,
  UnstableTextSnapshotError,
  atomicReplaceText,
  atomicReplaceTextIfUnchanged,
  prepareAtomicTextWrite,
  readStableTextSnapshot,
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
