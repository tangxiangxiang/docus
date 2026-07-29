import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

async function syncParentDirectoryBestEffort(filePath: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    directory = await fs.open(path.dirname(filePath), 'r')
    await directory.sync()
  } catch {
    // Directory fsync is not supported uniformly (notably on Windows).
  } finally {
    await directory?.close().catch(() => {})
  }
}

/**
 * Durably create one file without ever replacing or removing an incumbent.
 *
 * Cleanup is deliberately conditional on a successful O_EXCL open.  In
 * particular, EEXIST means this call never owned the directory entry and
 * therefore must leave both its bytes and inode untouched.
 */
export async function writeCreateOnlyDurableFile(
  filePath: string,
  data: string | Buffer | Uint8Array,
  options: { mode?: number; encoding?: BufferEncoding } = {},
): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  let createdByThisCall = false
  try {
    handle = await fs.open(
      filePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      options.mode,
    )
    createdByThisCall = true
    if (typeof data === 'string') {
      await handle.writeFile(data, options.encoding ?? 'utf8')
    } else {
      await handle.writeFile(data)
    }
    await handle.sync()
    await handle.close()
    handle = null
    await syncParentDirectoryBestEffort(filePath)
  } catch (error) {
    await handle?.close().catch(() => {})
    if (createdByThisCall) {
      await fs.rm(filePath, { force: true }).catch(() => {})
      await syncParentDirectoryBestEffort(filePath)
    }
    throw error
  }
}
