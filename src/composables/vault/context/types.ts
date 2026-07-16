import type { ComputedRef, Ref } from 'vue'
import type { Tab } from '../../../components/vault/tabs'
import type { VaultFileChanges } from './fileChanges'
import type { VaultTocState } from '../useTocState'
import type { DocumentLifecycle } from '../useDocumentLifecycle'

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
  lifecycle?: DocumentLifecycle
  onDispose: (cleanup: () => void) => () => void
  dispose: () => void
}
