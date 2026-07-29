import { promises as fs } from 'node:fs'
import path from 'node:path'

import { isPhysicallyContained } from './documentFileLifecycle.js'

export type FolderMoveDirectoryEntry = {
  relativeDirectoryPath: string
  sourceDev: string
  sourceIno: string
}

export type FolderMoveDirectoryRemovalResult = {
  removed: string[]
  retained: string[]
  rootRemoved: boolean
  conflict: string[]
}

/**
 * Walk every directory under dirAbs (excluding the root itself) and
 * capture its dev/ino. Symlinks, junctions and any other non-directory
 * entries are rejected; an ABI-like replacement directory that misses
 * the journal's generation proof is the whole point of this helper.
 *
 * The returned list is sorted deepest-first so per-directory removal
 * proceeds bottom-up (an entry's parent cannot be removed until the
 * entry itself is processed).
 */
export async function captureFolderMoveDirectoryEntries(
  dirAbs: string,
  vaultRoot?: string,
): Promise<FolderMoveDirectoryEntry[]> {
  const entries: FolderMoveDirectoryEntry[] = []
  const walk = async (current: string, rel: string): Promise<void> => {
    const dirents = await fs.readdir(current, { withFileTypes: true })
    for (const dirent of dirents) {
      const abs = path.join(current, dirent.name)
      const nextRel = rel === '' ? dirent.name : `${rel}/${dirent.name}`
      if (vaultRoot && !(await isPhysicallyContained(vaultRoot, abs))) {
        throw new Error(
          `folder move directory escaped the vault: ${nextRel}`,
        )
      }
      const stat = await fs.lstat(abs, { bigint: true })
      if (dirent.isSymbolicLink()
        || !stat.isDirectory()
        || dirent.isFile()
        || dirent.isBlockDevice()
        || dirent.isCharacterDevice()
        || dirent.isFIFO()
        || dirent.isSocket()) {
        throw new Error(
          `unsupported entry inside the moved folder: ${nextRel}`,
        )
      }
      entries.push({
        relativeDirectoryPath: nextRel,
        sourceDev: stat.dev.toString(),
        sourceIno: stat.ino.toString(),
      })
      await walk(abs, nextRel)
    }
  }
  await walk(dirAbs, '')
  entries.sort((left, right) => {
    const depth = right.relativeDirectoryPath.split('/').length
      - left.relativeDirectoryPath.split('/').length
    return depth || (left.relativeDirectoryPath < right.relativeDirectoryPath
      ? -1
      : left.relativeDirectoryPath > right.relativeDirectoryPath
        ? 1
        : 0)
  })
  return entries
}

export function validateFolderMoveDirectoryGeneration(
  journal: {
    directories: string[]
    directoryGenerations?: FolderMoveDirectoryEntry[]
  },
): string | null {
  const sortedDeclared = [...new Set(journal.directories)].sort()
  const declaredSet = new Set(sortedDeclared)
  const generations = journal.directoryGenerations ?? []
  if (generations.length !== sortedDeclared.length) return null
  const seen = new Set<string>()
  for (const entry of generations) {
    if (!entry || typeof entry.relativeDirectoryPath !== 'string') return null
    if (typeof entry.sourceDev !== 'string' || !/^\d+$/.test(entry.sourceDev)) return null
    if (typeof entry.sourceIno !== 'string' || !/^[1-9]\d*$/.test(entry.sourceIno)) return null
    if (seen.has(entry.relativeDirectoryPath)) return null
    seen.add(entry.relativeDirectoryPath)
    if (!declaredSet.has(entry.relativeDirectoryPath)) return null
  }
  if (seen.size !== declaredSet.size) return null
  for (const declared of sortedDeclared) {
    if (!seen.has(declared)) return null
  }
  return 'ok'
}
