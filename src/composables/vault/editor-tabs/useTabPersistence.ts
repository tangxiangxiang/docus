import { useDebounceFn } from '@vueuse/core'
import { ref, watch, type Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'

const TAB_PERSIST_KEY = 'docus:tabs:v1'
const TAB_PERSIST_MAX = 20
const TAB_PERSIST_DEBOUNCE_MS = 100

let vaultIdOverrideForTesting: { value: string | null } | null = null

export interface PersistedTabs {
  v: number
  paths: string[]
  active: string | null
}

function storageKey(vaultId: string | null): string {
  return vaultId ? `${TAB_PERSIST_KEY}:${vaultId}` : TAB_PERSIST_KEY
}

export function readPersistedTabs(vaultId: string | null): PersistedTabs | null {
  let raw: string | null
  try { raw = localStorage.getItem(storageKey(vaultId)) } catch { return null }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed === 'object' && parsed !== null
        && (parsed as { v?: unknown }).v === 1
        && Array.isArray((parsed as { paths?: unknown }).paths)) {
      const paths = (parsed as { paths: unknown[] }).paths
        .filter((p): p is string => typeof p === 'string')
        .slice(0, TAB_PERSIST_MAX)
      const rawActive = (parsed as { active?: unknown }).active
      return { v: 1, paths, active: typeof rawActive === 'string' ? rawActive : null }
    }
  } catch { /* corrupt JSON is treated as empty */ }
  return null
}

function writePersistedTabs(tabs: Tab[], active: string | null, vaultId: string | null) {
  try {
    const data: PersistedTabs = {
      v: 1,
      paths: tabs.map((t) => t.path).slice(0, TAB_PERSIST_MAX),
      active,
    }
    localStorage.setItem(storageKey(vaultId), JSON.stringify(data))
  } catch { /* persistence is best-effort */ }
}

/**
 * Synchronous + debounced tab-set persistence.
 *
 * Returns:
 *   - `vaultId` / `resolveVaultId`: fetches and caches the vault id
 *     used to scope the localStorage key.
 *   - `persist`: a SYNCHRONOUS writer. Every close / rename /
 *     restore-failure mutation calls this so a page refresh before
 *     the debounce flushes cannot resurrect a closed tab. This is
 *     also called on `beforeunload` so the user closing the tab
 *     keeps the latest state.
 *   - the debounced watcher is wired internally; callers don't need
 *     to touch it.
 */
export function useTabPersistence(tabs: Ref<Tab[]>, activePath: Ref<string | null>) {
  const vaultId = ref<string | null>(null)
  let vaultIdPromise: Promise<string | null> | null = null
  let disposed = false

  function fetchVaultId(): Promise<string | null> {
    if (vaultIdOverrideForTesting) return Promise.resolve(vaultIdOverrideForTesting.value)
    if (!vaultIdPromise) {
      vaultIdPromise = fetch('/api/health')
        .then((response) => response.json() as Promise<{ vaultId?: string }>)
        .then((payload) => payload.vaultId ?? null)
        .catch(() => null)
    }
    return vaultIdPromise
  }

  function persist(): void {
    writePersistedTabs(tabs.value, activePath.value, vaultId.value)
  }

  const debouncedPersist = useDebounceFn(() => {
    if (!disposed) persist()
  }, TAB_PERSIST_DEBOUNCE_MS)
  const stopWatch = watch([tabs, activePath], () => { debouncedPersist() }, { deep: false })

  // Flush synchronously before teardown. dispose() marks the instance
  // inactive so a trailing debounce callback cannot overwrite storage
  // after another Vault instance has mounted.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', persist)
  }

  async function resolveVaultId(): Promise<string | null> {
    vaultId.value = await fetchVaultId()
    return vaultId.value
  }

  function dispose(): void {
    if (disposed) return
    persist()
    disposed = true
    stopWatch()
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', persist)
    }
  }

  return { vaultId, resolveVaultId, persist, dispose }
}

export function __setVaultIdForTesting(vaultId: string | null): void {
  vaultIdOverrideForTesting = { value: vaultId }
}

export function resetTabPersistenceForTesting(): void {
  vaultIdOverrideForTesting = null
}
