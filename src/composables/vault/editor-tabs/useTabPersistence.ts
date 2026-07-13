import { useDebounceFn } from '@vueuse/core'
import { watch, type Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'

const TAB_PERSIST_KEY = 'docus:tabs:v1'
const TAB_PERSIST_MAX = 20
const TAB_PERSIST_DEBOUNCE_MS = 100

let vaultIdPromise: Promise<string | null> | null = null
let cachedVaultId: string | null = null

export interface PersistedTabs {
  v: number
  paths: string[]
  active: string | null
}

function fetchVaultId(): Promise<string | null> {
  if (!vaultIdPromise) {
    vaultIdPromise = fetch('/api/health')
      .then((r) => r.json() as Promise<{ vaultId?: string }>)
      .then((j) => j.vaultId ?? null)
      .catch(() => null)
  }
  return vaultIdPromise
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

export function useTabPersistence(tabs: Ref<Tab[]>, activePath: Ref<string | null>) {
  const debouncedPersist = useDebounceFn(
    () => writePersistedTabs(tabs.value, activePath.value, cachedVaultId),
    TAB_PERSIST_DEBOUNCE_MS,
  )
  watch([tabs, activePath], () => { debouncedPersist() }, { deep: false })

  async function resolveVaultId(): Promise<string | null> {
    cachedVaultId = await fetchVaultId()
    return cachedVaultId
  }
  return { resolveVaultId }
}

export function __setVaultIdForTesting(vaultId: string | null): void {
  cachedVaultId = vaultId
  vaultIdPromise = Promise.resolve(vaultId)
}

export function resetTabPersistenceForTesting(): void {
  cachedVaultId = null
  vaultIdPromise = null
}
