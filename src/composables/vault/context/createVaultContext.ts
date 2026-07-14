import type { ComputedRef, Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import type { VaultContext } from './types'
import type { VaultFileChanges } from './fileChanges'
import { createVaultTocState } from '../useTocState'

export function createVaultContext(options: {
  vaultId: Ref<string | null>
  fileChanges: VaultFileChanges
  tabs: Ref<Tab[]>
  activePath: Ref<string | null>
  activeTab: ComputedRef<Tab | null>
  openPost: (path: string) => Promise<void>
}): VaultContext {
  const cleanups = new Set<() => void>()
  let disposed = false
  return {
    vaultId: options.vaultId,
    fileChanges: options.fileChanges,
    toc: createVaultTocState(),
    editor: {
      tabs: options.tabs,
      activePath: options.activePath,
      activeTab: options.activeTab,
      openPost: options.openPost,
      getLiveContent(path: string): string | null {
        const tab = options.tabs.value.find((candidate) => candidate.path === path)
        return tab && !tab.loading ? tab.raw : null
      },
    },
    onDispose(cleanup) {
      if (disposed) {
        cleanup()
        return () => {}
      }
      cleanups.add(cleanup)
      return () => { cleanups.delete(cleanup) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      const callbacks = [...cleanups]
      cleanups.clear()
      for (const cleanup of callbacks) {
        try {
          cleanup()
        } catch (error) {
          console.error('Vault cleanup failed', error)
        }
      }
    },
  }
}
