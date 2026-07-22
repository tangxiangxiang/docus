const documentWriteTails = new Map<string, Promise<void>>()
const documentWriteWaiters = new Map<string, number>()

/**
 * Reserved lock key that serializes every operation that changes vault
 * tree membership (file/folder create, delete, rename/move, recovery
 * create). Membership-changing operations acquire this FIRST, then the
 * sorted document path locks — one global acquisition order, so a
 * folder lifecycle transaction can never interleave with a child being
 * created or removed underneath it. Content-only writes (body PUT, AI
 * write/patch, metadata/frontmatter) take document path locks only, so
 * they never contend with structural operations except on the exact
 * documents they touch. The `@@` spelling is not a valid vault segment
 * (SEGMENT_RE is `[a-z0-9-]`), so no real path can collide with it.
 */
export const VAULT_STRUCTURE_LOCK = '@@vault-structure'

export function withVaultStructureLock<T>(operation: () => Promise<T>): Promise<T> {
  return withDocumentWriteLock(VAULT_STRUCTURE_LOCK, operation)
}

/**
 * Serialize document write transactions by Vault-relative path while allowing
 * unrelated documents to proceed independently.
 */
export async function withDocumentWriteLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = documentWriteTails.get(path) ?? Promise.resolve()
  const queued = documentWriteTails.has(path)
  if (queued) documentWriteWaiters.set(path, (documentWriteWaiters.get(path) ?? 0) + 1)
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  documentWriteTails.set(path, tail)

  await previous.catch(() => {})
  if (queued) {
    const remaining = (documentWriteWaiters.get(path) ?? 1) - 1
    if (remaining > 0) documentWriteWaiters.set(path, remaining)
    else documentWriteWaiters.delete(path)
  }
  try {
    return await operation()
  } finally {
    release()
    if (documentWriteTails.get(path) === tail) {
      documentWriteTails.delete(path)
    }
  }
}

/** Acquire a mutation footprint in one global order to avoid deadlocks. */
export function withDocumentWriteLocks<T>(
  paths: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const lockPaths = [...new Set(paths)].sort()
  const locked = lockPaths.reduceRight(
    (next, lockPath) => () => withDocumentWriteLock(lockPath, next),
    operation,
  )
  return locked()
}

export function pendingDocumentWriteLocksForTesting(): number {
  return documentWriteTails.size
}

/** How many operations are currently queued behind the lock for `path`. */
export function documentWriteLockWaitersForTesting(path: string): number {
  return documentWriteWaiters.get(path) ?? 0
}
