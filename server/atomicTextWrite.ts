import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export interface PreparedAtomicTextWrite {
  readonly temporaryPath: string
  commit(): Promise<void>
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

export async function prepareAtomicTextWrite(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<PreparedAtomicTextWrite> {
  const directory = path.dirname(targetPath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.docus-save-${randomUUID()}`,
  )
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  let settled = false

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

  return {
    temporaryPath,
    async commit() {
      if (settled) return
      try {
        await renameWithTransientWindowsRetry(temporaryPath, targetPath)
        settled = true
        await syncParentDirectoryBestEffort(targetPath)
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => {})
        settled = true
        throw error
      }
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

export async function atomicReplaceTextIfUnchanged(
  targetPath: string,
  expectedRaw: string,
  replacementRaw: string,
  options: { mode?: number } = {},
): Promise<void> {
  const prepared = await prepareAtomicTextWrite(targetPath, replacementRaw, options)
  try {
    const current = await readStableTextSnapshot(targetPath)
    if (current.raw !== expectedRaw) {
      throw new AtomicTextWriteConflictError(current)
    }
    await prepared.commit()
  } catch (error) {
    await prepared.rollback()
    throw error
  }
}

/**
 * Remove a text file only while the bytes being removed still match the
 * caller's write. Renaming first means a writer that changes the same inode
 * before cleanup is detected on the staged file and restored, rather than
 * being silently deleted.
 */
export async function atomicRemoveTextIfUnchanged(
  targetPath: string,
  expectedRaw: string,
): Promise<void> {
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.docus-remove-${randomUUID()}`,
  )
  await renameWithTransientWindowsRetry(targetPath, stagedPath)
  try {
    const staged = await readStableTextSnapshot(stagedPath)
    if (staged.raw !== expectedRaw) {
      if (!await fs.stat(targetPath).then(() => true, () => false)) {
        await renameWithTransientWindowsRetry(stagedPath, targetPath)
      }
      throw new AtomicTextWriteConflictError(staged)
    }
    await fs.rm(stagedPath)
    await syncParentDirectoryBestEffort(targetPath)
  } catch (error) {
    const targetExists = await fs.stat(targetPath).then(() => true, () => false)
    const stagedExists = await fs.stat(stagedPath).then(() => true, () => false)
    if (!targetExists && stagedExists) {
      try {
        await renameWithTransientWindowsRetry(stagedPath, targetPath)
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'conditional text removal failed and staged content could not be restored',
        )
      }
    }
    throw error
  }
}

export async function atomicReplaceText(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<void> {
  const prepared = await prepareAtomicTextWrite(targetPath, raw, options)
  try {
    await prepared.commit()
  } catch (error) {
    await prepared.rollback()
    throw error
  }
}
