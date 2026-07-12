// Scope filter for the vault's file tree. The filter narrows the tree
// to one of the three vault roots (inbox / literature / archive)
// and is rendered as chips in the NavBar (the file tree's header is too
// narrow on 150px sidebars). Both the NavBar and the FileTree need to
// read this state, so it lives in a composable with module-level refs
// — a tiny singleton pattern that keeps the storage key and watchers
// in one place instead of two.

import { ref, watch } from 'vue'
import { PROTECTED_ROOTS } from '../archiveProtocol'

const STORAGE_KEY = 'docus.vault.activeScope'

function loadScope(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw && PROTECTED_ROOTS.has(raw) ? raw : null
  } catch {
    return null
  }
}

const activeScope = ref<string | null>(loadScope())
let persistenceWired = false

export function useScopeFilter() {
  if (!persistenceWired && typeof window !== 'undefined') {
    watch(activeScope, (v) => {
      try { localStorage.setItem(STORAGE_KEY, v ?? '') } catch { /* ignore */ }
    })
    persistenceWired = true
  }

  function toggleScope(root: string) {
    activeScope.value = activeScope.value === root ? null : root
  }

  return { activeScope, toggleScope }
}
