import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export interface CreatedDurableFile {
  path: string
  parentPath: string
  fileIdentity: { dev: string; ino: string }
  parentIdentity: { dev: string; ino: string }
}

async function captureDirectoryIdentity(directoryPath: string): Promise<{ dev: string; ino: string }> {
  const stat = await fs.lstat(directoryPath, { bigint: true })
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`durable file parent is not a directory: ${directoryPath}`)
  return { dev: stat.dev.toString(), ino: stat.ino.toString() }
}

async function captureFileIdentity(filePath: string): Promise<{ dev: string; ino: string }> {
  const stat = await fs.lstat(filePath, { bigint: true })
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`durable file is not a regular file: ${filePath}`)
  return { dev: stat.dev.toString(), ino: stat.ino.toString() }
}

async function verifyCreatedDurableFile(owned: CreatedDurableFile): Promise<void> {
  const [file, parent] = await Promise.all([
    captureFileIdentity(owned.path),
    captureDirectoryIdentity(owned.parentPath),
  ])
  if (file.dev !== owned.fileIdentity.dev || file.ino !== owned.fileIdentity.ino
    || parent.dev !== owned.parentIdentity.dev || parent.ino !== owned.parentIdentity.ino) {
    throw new Error(`durable file ownership changed: ${owned.path}`)
  }
}

async function removeCreatedDurableFile(owned: CreatedDurableFile): Promise<void> {
  await verifyCreatedDurableFile(owned)
  await fs.unlink(owned.path)
  await syncParentDirectoryBestEffort(owned.path)
}

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
): Promise<CreatedDurableFile> {
  const parentPath = path.dirname(filePath)
  const parentIdentity = await captureDirectoryIdentity(parentPath)
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  let createdByThisCall = false
  let owned: CreatedDurableFile | null = null
  try {
    handle = await fs.open(
      filePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      options.mode,
    )
    createdByThisCall = true
    const stat = await handle.stat({ bigint: true })
    if (!stat.isFile()) throw new Error(`durable file is not regular: ${filePath}`)
    owned = {
      path: filePath,
      parentPath,
      fileIdentity: { dev: stat.dev.toString(), ino: stat.ino.toString() },
      parentIdentity,
    }
    await verifyCreatedDurableFile(owned)
    if (typeof data === 'string') {
      await handle.writeFile(data, options.encoding ?? 'utf8')
    } else {
      await handle.writeFile(data)
    }
    await handle.sync()
    await handle.close()
    handle = null
    if (!owned) throw new Error(`durable file ownership was not established: ${filePath}`)
    await verifyCreatedDurableFile(owned)
    await syncParentDirectoryBestEffort(filePath)
    return owned
  } catch (error) {
    await handle?.close().catch(() => {})
    if (createdByThisCall && owned) {
      await removeCreatedDurableFile(owned).catch(() => {})
    }
    throw error
  }
}
