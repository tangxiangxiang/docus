import type { ComputedRef, Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import type { VaultFileChanges } from './fileChanges'
import type { VaultTocState } from '../useTocState'

export interface VaultEditorContext {
  tabs: Ref<Tab[]>
  activePath: Ref<string | null>
  activeTab: ComputedRef<Tab | null>
  openPost: (path: string) => Promise<void>
  getLiveContent: (path: string) => string | null
}

export interface VaultContext {
  vaultId: Ref<string | null>
  fileChanges: VaultFileChanges
  editor: VaultEditorContext
  toc: VaultTocState
  onDispose: (cleanup: () => void) => () => void
  dispose: () => void
}
