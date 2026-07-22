import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export interface PreparedAtomicTextWrite {
  readonly temporaryPath: string
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
 * A prepared replacement whose commit is ownership-verified: it never
 * overwrites a generation it did not verify. See commit() below.
 */
export interface PreparedAtomicTextReplace {
  readonly temporaryPath: string
  /**
   * Commit the replacement with an external-writer-safe protocol:
   *
   *   1. OWNERSHIP — atomically rename the current target aside to a
   *      private staging path. Whoever wins this rename owns the old
   *      generation; there is no check-to-rename window afterwards.
   *   2. VERIFY — the staged bytes must still equal `expectedRaw`.
   *      An external save that landed before the takeover is detected
   *      here: the staged bytes are restored create-only and the
   *      commit fails closed.
   *   3. COMMIT — link(2) the new generation into the target path.
   *      link is create-only: if an external writer recreated the
   *      path while we held the staged generation, EEXIST fails the
   *      commit and the external file is preserved untouched.
   *
   * Any external generation wins. The caller's bytes are never written
   * over a generation the caller did not prove it still owned.
   */
  commit(expectedRaw: string): Promise<void>
  rollback(): Promise<void>
}

/** Prepare a durable temporary file whose commit atomically creates, but can
 * never replace, the target path. */
export async function prepareAtomicTextCreate(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<PreparedAtomicTextWrite> {
  const prepared = await prepareAtomicTextWrite(targetPath, raw, options)
  let settled = false
  return {
    temporaryPath: prepared.temporaryPath,
    async commit() {
      if (settled) return
      try {
        // link(2) is the create-only counterpart to rename: it atomically
        // fails with EEXIST and never replaces a newer generation.
        await fs.link(prepared.temporaryPath, targetPath)
        settled = true
        await fs.rm(prepared.temporaryPath, { force: true }).catch(() => {})
        await syncParentDirectoryBestEffort(targetPath)
      } catch (error) {
        settled = true
        await fs.rm(prepared.temporaryPath, { force: true }).catch(() => {})
        throw error
      }
    },
    async rollback() {
      if (settled) return
      settled = true
      await fs.rm(prepared.temporaryPath, { force: true }).catch(() => {})
    },
  }
}

export interface StableTextSnapshot {
  raw: string
  stat: {
    mtimeMs: number
    size: number
    mode: number
  }
}

export class AtomicTextWriteConflictError extends Error {
  readonly current: StableTextSnapshot

  constructor(current: StableTextSnapshot) {
    super('document changed before atomic replacement')
    this.name = 'AtomicTextWriteConflictError'
    this.current = current
  }
}

/** The target disappeared (an external delete) before the commit could
 * take ownership of its generation. */
export class AtomicTextWriteTargetMissingError extends Error {
  constructor(targetPath: string) {
    super(`atomic replacement target disappeared: ${targetPath}`)
    this.name = 'AtomicTextWriteTargetMissingError'
  }
}

export class UnstableTextSnapshotError extends Error {
  readonly latest: StableTextSnapshot

  constructor(latest: StableTextSnapshot) {
    super('document did not stabilize while reading')
    this.name = 'UnstableTextSnapshotError'
    this.latest = latest
  }
}

async function syncParentDirectoryBestEffort(targetPath: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    directory = await fs.open(path.dirname(targetPath), constants.O_RDONLY)
    await directory.sync()
  } catch {
    // Directory fsync is not supported on every platform/filesystem.
  } finally {
    await directory?.close().catch(() => {})
  }
}

async function renameWithTransientWindowsRetry(from: string, to: string): Promise<void> {
  const delays = process.platform === 'win32' ? [0, 5, 20, 50] : [0]
  let lastError: unknown
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error
    }
  }
  throw lastError
}

/**
 * Restore a staged generation to the target path WITHOUT ever
 * replacing a newer one: link(2) is create-only, so a path an external
 * writer recreated wins — the staged bytes then stay quarantined on
 * disk under their staging name rather than clobbering the new
 * generation.
 */
async function restoreStagedGeneration(stagedPath: string, targetPath: string): Promise<void> {
  try {
    await fs.link(stagedPath, targetPath)
    await fs.rm(stagedPath, { force: true }).catch(() => {})
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // A newer external generation owns the path: never clobber it.
      return
    }
    // link failed for some other reason; put the bytes back only if
    // the path is still unclaimed.
    const targetExists = await fs.stat(targetPath).then(() => true, () => false)
    if (!targetExists) {
      await renameWithTransientWindowsRetry(stagedPath, targetPath).catch(() => {})
    }
  }
}

async function writeTemporaryTextFile(
  targetPath: string,
  raw: string,
  options: { mode?: number },
): Promise<string> {
  const directory = path.dirname(targetPath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.docus-save-${randomUUID()}`,
  )
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      options.mode,
    )
    await handle.writeFile(raw, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = null
    if (options.mode !== undefined) {
      await fs.chmod(temporaryPath, options.mode)
    }
  } catch (error) {
    await handle?.close().catch(() => {})
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
  return temporaryPath
}

export async function prepareAtomicTextWrite(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<PreparedAtomicTextReplace> {
  const temporaryPath = await writeTemporaryTextFile(targetPath, raw, options)
  let settled = false

  return {
    temporaryPath,
    async commit(expectedRaw: string) {
      if (settled) return
      const stagedPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.docus-staged-${randomUUID()}`,
      )
      const fail = async (error: unknown): Promise<never> => {
        settled = true
        await fs.rm(temporaryPath, { force: true }).catch(() => {})
        throw error
      }
      // 1. OWNERSHIP: atomically take the current generation aside. An
      //    external save that landed before this rename travels with
      //    the bytes to staging and is detected at verification; one
      //    that recreates the path afterwards loses to the create-only
      //    link below. Either way it is never silently overwritten.
      try {
        await renameWithTransientWindowsRetry(targetPath, stagedPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return fail(new AtomicTextWriteTargetMissingError(targetPath))
        }
        return fail(error)
      }
      // 2. VERIFY the owned generation.
      let stagedSnapshot: StableTextSnapshot
      try {
        stagedSnapshot = await readStableTextSnapshot(stagedPath)
      } catch (error) {
        await restoreStagedGeneration(stagedPath, targetPath)
        return fail(error)
      }
      if (stagedSnapshot.raw !== expectedRaw) {
        await restoreStagedGeneration(stagedPath, targetPath)
        return fail(new AtomicTextWriteConflictError(stagedSnapshot))
      }
      // 3. COMMIT create-only: link(2) never replaces. EEXIST means a
      //    new external generation landed while we held the staged
      //    bytes — preserve it. The staged generation equals
      //    expectedRaw, which the caller already holds, so both of our
      //    files are removed and the conflict reports the winner.
      try {
        await fs.link(temporaryPath, targetPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          await fs.rm(stagedPath, { force: true }).catch(() => {})
          let current: StableTextSnapshot
          try {
            current = await readStableTextSnapshot(targetPath)
          } catch {
            return fail(error)
          }
          return fail(new AtomicTextWriteConflictError(current))
        }
        await restoreStagedGeneration(stagedPath, targetPath)
        return fail(error)
      }
      settled = true
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
      await fs.rm(stagedPath, { force: true }).catch(() => {})
      await syncParentDirectoryBestEffort(targetPath)
    },
    async rollback() {
      if (settled) return
      settled = true
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
    },
  }
}

/**
 * Read around stat so a content change observed during snapshot collection is
 * retried instead of pairing an old body with a newer file status.
 */
export async function readStableTextSnapshot(
  targetPath: string,
  maxAttempts = 3,
): Promise<StableTextSnapshot> {
  let latest: StableTextSnapshot | null = null
  const numericStat = async () => {
    const stat = await fs.stat(targetPath)
    return {
      mtimeMs: Number(stat.mtimeMs),
      size: Number(stat.size),
      mode: Number(stat.mode),
    }
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await fs.readFile(targetPath, 'utf8')
    const stat = await numericStat()
    const after = await fs.readFile(targetPath, 'utf8')
    latest = {
      raw: after,
      stat: after === before ? stat : await numericStat(),
    }
    if (after === before) return latest
  }
  throw new UnstableTextSnapshotError(latest!)
}

/**
 * Replace a text file only while its current bytes still match the
 * caller's expectation, with no check-to-rename window: the commit
 * takes ownership of the current generation first (atomic rename
 * aside), verifies it, and links the replacement in create-only. An
 * external writer winning any race keeps its bytes and the call fails
 * closed with AtomicTextWriteConflictError (or
 * AtomicTextWriteTargetMissingError if the target was deleted). The
 * file's mode is preserved.
 */
export async function atomicReplaceTextIfUnchanged(
  targetPath: string,
  expectedRaw: string,
  replacementRaw: string,
  options: { mode?: number } = {},
): Promise<void> {
  let mode = options.mode
  if (mode === undefined) {
    mode = await fs.stat(targetPath).then((stat) => Number(stat.mode), () => undefined)
  }
  const prepared = await prepareAtomicTextWrite(targetPath, replacementRaw, { mode })
  try {
    await prepared.commit(expectedRaw)
  } catch (error) {
    await prepared.rollback()
    throw error
  }
}

/**
 * Remove a text file only while the bytes being removed still match the
 * caller's write. Renaming first means a writer that changes the same inode
 * before cleanup is detected on the staged file and restored create-only
 * (a recreated path wins), rather than being silently deleted. If the
 * bytes changed, the removal is a no-op: the caller's write is already
 * gone and the external bytes stay. A missing target is likewise a
 * no-op — there is nothing left to remove.
 */
export async function atomicRemoveTextIfUnchanged(
  targetPath: string,
  expectedRaw: string,
): Promise<void> {
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.docus-remove-${randomUUID()}`,
  )
  try {
    await renameWithTransientWindowsRetry(targetPath, stagedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  let staged: StableTextSnapshot
  try {
    staged = await readStableTextSnapshot(stagedPath)
  } catch (error) {
    await restoreStagedGeneration(stagedPath, targetPath)
    throw error
  }
  if (staged.raw !== expectedRaw) {
    await restoreStagedGeneration(stagedPath, targetPath)
    return
  }
  await fs.rm(stagedPath)
  await syncParentDirectoryBestEffort(targetPath)
}

/**
 * Unconditional replacement: prepare + rename. Callers that need
 * external-writer safety must use atomicReplaceTextIfUnchanged (or
 * prepareAtomicTextWrite's ownership-verified commit) instead.
 */
export async function atomicReplaceText(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<void> {
  const temporaryPath = await writeTemporaryTextFile(targetPath, raw, options)
  try {
    await renameWithTransientWindowsRetry(temporaryPath, targetPath)
    await syncParentDirectoryBestEffort(targetPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}
