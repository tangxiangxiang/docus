const documentWriteTails = new Map<string, Promise<void>>()

/**
 * Serialize document write transactions by Vault-relative path while allowing
 * unrelated documents to proceed independently.
 */
export async function withDocumentWriteLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = documentWriteTails.get(path) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => current)
  documentWriteTails.set(path, tail)

  await previous.catch(() => {})
  try {
    return await operation()
  } finally {
    release()
    if (documentWriteTails.get(path) === tail) {
      documentWriteTails.delete(path)
    }
  }
}

export function pendingDocumentWriteLocksForTesting(): number {
  return documentWriteTails.size
}
