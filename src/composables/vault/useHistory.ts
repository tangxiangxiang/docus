// Vault-scoped, read-only Git state used by the document-first History
// timeline and ActivityBar badge. Mutation workflows live in their focused
// composables (snapshots, comparisons, and restore), so this service does not
// expose the obsolete commit-first selection or legacy diff-view state.

import { computed, ref, watch, type Ref } from 'vue'
import * as api from '../../lib/history-api.js'
import type { Capability, CommitRecord, StatusEntry } from '../../lib/history-api.js'
import type { VaultContext } from './context/types'
import { getFallbackVaultFileChanges, type VaultFileChanges } from './context/fileChanges'
import { useOptionalVaultContext } from './context/useVaultContext'

export interface HistoryState {
  capability: Ref<Capability | null>
  status: Ref<StatusEntry[]>
  log: Ref<CommitRecord[]>
  logLoading: Ref<boolean>
  logLoaded: Ref<boolean>
  available: Ref<boolean>
  dirtyCount: Ref<number>
  refreshCapability(): Promise<void>
  refreshStatus(): Promise<void>
  refreshLog(opts?: { path?: string }): Promise<void>
}

interface HistoryInstance {
  use(): HistoryState
  reset(): void
}

function createHistoryInstance(fileChanges: VaultFileChanges): HistoryInstance {
  const capability = ref<Capability | null>(null)
  const status = ref<StatusEntry[]>([])
  const log = ref<CommitRecord[]>([])
  const logLoading = ref(false)
  const logLoaded = ref(false)
  const available = ref(false)
  const dirtyCount = computed(() => status.value.length)
  let hydrated = false
  let fileChangeUnsubscribe: (() => void) | null = null
  let lastSeenFileChangeSeq = 0

  async function refreshCapability(): Promise<void> {
    try {
      const result = await api.getCapability()
      capability.value = result
      available.value = result.gitAvailable && result.repoInitialized
    } catch {
      capability.value = { gitAvailable: false, repoInitialized: false }
      available.value = false
    }
  }

  async function refreshStatus(): Promise<void> {
    try {
      const result = await api.getStatus()
      status.value = result.dirty
      available.value = result.available
    } catch {
      status.value = []
      available.value = false
    }
  }

  async function refreshLog(opts: { path?: string } = {}): Promise<void> {
    logLoading.value = true
    try {
      const result = await api.getLog({ path: opts.path, limit: 200 })
      log.value = Array.isArray(result?.commits) ? result.commits : []
    } catch {
      log.value = []
    } finally {
      logLoading.value = false
      logLoaded.value = true
    }
  }

  function use(): HistoryState {
    if (!hydrated) {
      hydrated = true
      void refreshCapability().then(() => {
        if (!available.value) return
        void refreshStatus()
        void refreshLog()
      })

      fileChangeUnsubscribe = watch(
        () => fileChanges.events.value,
        (events) => {
          if (!available.value) return
          for (const event of events) {
            if (event.seq <= lastSeenFileChangeSeq) continue
            lastSeenFileChangeSeq = event.seq
            void refreshStatus()
          }
        },
        { flush: 'post' },
      )
    }

    return {
      capability,
      status,
      log,
      logLoading,
      logLoaded,
      available,
      dirtyCount,
      refreshCapability,
      refreshStatus,
      refreshLog,
    }
  }

  function reset(): void {
    capability.value = null
    status.value = []
    log.value = []
    logLoading.value = false
    logLoaded.value = false
    available.value = false
    hydrated = false
    lastSeenFileChangeSeq = 0
    fileChangeUnsubscribe?.()
    fileChangeUnsubscribe = null
  }

  return { use, reset }
}

const historyByVault = new WeakMap<VaultContext, HistoryInstance>()
let legacyOwner: VaultFileChanges | null = null
let legacyHistory: HistoryInstance | null = null

function getLegacyHistory(): HistoryInstance {
  const owner = getFallbackVaultFileChanges()
  if (!legacyHistory || legacyOwner !== owner) {
    legacyHistory?.reset()
    legacyOwner = owner
    legacyHistory = createHistoryInstance(owner)
  }
  return legacyHistory
}

export function useHistory(): HistoryState {
  const context = useOptionalVaultContext()
  if (!context) return getLegacyHistory().use()

  let history = historyByVault.get(context)
  if (!history) {
    history = createHistoryInstance(context.fileChanges)
    historyByVault.set(context, history)
  }
  return history.use()
}

export function __resetHistoryStateForTesting(): void {
  legacyHistory?.reset()
  legacyHistory = null
  legacyOwner = null
}
