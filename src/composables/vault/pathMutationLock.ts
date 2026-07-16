import { ref } from 'vue'

// Vault-scoped, in-memory exclusion for workflows that mutate document bytes.
// Paths use the History API's exact `.md` representation.
export function createPathMutationLock() {
  const paths = ref<Set<string>>(new Set())

  function acquire(requestedPaths: readonly string[]): (() => void) | null {
    if (requestedPaths.some((path) => paths.value.has(path))) return null
    const next = new Set(paths.value)
    for (const path of requestedPaths) next.add(path)
    paths.value = next

    let released = false
    return () => {
      if (released) return
      released = true
      const remaining = new Set(paths.value)
      for (const path of requestedPaths) remaining.delete(path)
      paths.value = remaining
    }
  }

  function has(path: string): boolean {
    return paths.value.has(path)
  }

  return { paths, acquire, has }
}
