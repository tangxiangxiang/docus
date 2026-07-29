import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

import { syncParentDirectoryBestEffort } from './atomicTextWrite.js'
import type { FolderMoveGateProof } from './folderMoveTransaction.js'

export function folderMoveGateMarkerAbs(
  destinationAbs: string,
  proof: FolderMoveGateProof,
): string {
  return path.join(destinationAbs, proof.markerName)
}

export async function writeFolderMoveGateProof(
  destinationAbs: string,
  proof: FolderMoveGateProof,
): Promise<void> {
  const markerAbs = folderMoveGateMarkerAbs(destinationAbs, proof)
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(
      markerAbs,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    )
    await handle.writeFile(proof.secret, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await syncParentDirectoryBestEffort(markerAbs)
  } catch (error) {
    await handle?.close().catch(() => {})
    await fs.rm(markerAbs, { force: true }).catch(() => {})
    await syncParentDirectoryBestEffort(markerAbs)
    throw error
  }
}

export async function verifyFolderMoveGateProof(
  destinationAbs: string,
  proof: FolderMoveGateProof,
): Promise<boolean> {
  const markerAbs = folderMoveGateMarkerAbs(destinationAbs, proof)
  try {
    const stat = await fs.lstat(markerAbs)
    if (!stat.isFile() || stat.isSymbolicLink()) return false
    return await fs.readFile(markerAbs, 'utf8') === proof.secret
  } catch {
    return false
  }
}

export async function removeFolderMoveGateProof(
  destinationAbs: string,
  proof: FolderMoveGateProof,
): Promise<void> {
  const markerAbs = folderMoveGateMarkerAbs(destinationAbs, proof)
  if (!await verifyFolderMoveGateProof(destinationAbs, proof)) {
    throw new Error(`folder move gate proof is missing or mismatched: ${markerAbs}`)
  }
  await fs.rm(markerAbs, { force: true })
  await syncParentDirectoryBestEffort(markerAbs)
}
