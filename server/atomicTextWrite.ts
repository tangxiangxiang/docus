import { randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export interface PreparedAtomicTextWrite {
  readonly temporaryPath: string
  commit(): Promise<void>
  rollback(): Promise<void>
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
