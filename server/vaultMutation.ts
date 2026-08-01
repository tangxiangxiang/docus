/**
 * Test probe reserved for the cross-feature Vault mutation boundary.
 *
 * The RED suite installs `onWait` and expects a History mutation to report
 * that it queued behind an already-active folder/recovery transaction. The
 * production coordinator added by the remediation owns this notification;
 * before that coordinator exists, the competing History mutation reaches its
 * own mutation hook instead and the RED assertion fails deterministically.
 */
export type VaultMutationHooks = {
  onWait?: (vaultRoot: string) => void | Promise<void>
}

let hooks: VaultMutationHooks | null = null

export function __setVaultMutationHooksForTesting(
  next: VaultMutationHooks | null,
): void {
  hooks = next
}

export async function notifyVaultMutationWaitForTesting(
  vaultRoot: string,
): Promise<void> {
  await hooks?.onWait?.(vaultRoot)
}
