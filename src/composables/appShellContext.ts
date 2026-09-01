import type { InjectionKey, Ref } from 'vue'

/**
 * Small bridge between the global app chrome and the Vault-owned settings
 * surface.  SettingsModal still belongs to VaultView because its Tags section
 * uses the live Vault context; the shell only signals that the modal should
 * open.
 */
export interface AppShellContext {
  readonly settingsRequestTick: Readonly<Ref<number>>
}

export const AppShellContextKey: InjectionKey<AppShellContext> = Symbol('docus.app-shell')
