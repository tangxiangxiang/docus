// Scope filter for the vault's file tree. The filter narrows the tree to a
// user-facing content scope and is rendered as chips in the NavBar (the file
// tree's header is too narrow on 150px sidebars). Both the NavBar and the
// FileTree need to read this state, so it lives in a composable with
// module-level refs — a tiny singleton pattern that keeps the storage key and
// watchers in one place instead of two.

import { ref, watch } from 'vue'
import { SCOPE_ROOTS, type ScopeKey } from '../../../shared/scopeProtocol'

const STORAGE_KEY = 'docus.vault.activeScope'
const DEFAULT_SCOPE: ScopeKey = 'note'

function loadScope(): ScopeKey {
  if (typeof localStorage === 'undefined') return DEFAULT_SCOPE
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SCOPE
    // Diary is permission-bearing. A persisted Diary selection is only a
    // preference from a previous application session, never proof of a live
    // secondary-password capability. Start safely in note; the shell-level
    // access coordinator can select Diary only after the current session is
    // unlocked.
    if (raw === 'diary') return DEFAULT_SCOPE
    if (Object.prototype.hasOwnProperty.call(SCOPE_ROOTS, raw)) return raw as ScopeKey
    // Keep an existing saved root selection useful after the UI changes from
    // root chips to content scopes. All three legacy roots belong to note.
    if (SCOPE_ROOTS.note.includes(raw as typeof SCOPE_ROOTS.note[number])) return 'note'
    return DEFAULT_SCOPE
  } catch {
    return DEFAULT_SCOPE
  }
}

const activeScope = ref<ScopeKey>(loadScope())
let persistenceWired = false

export function useScopeFilter() {
  if (!persistenceWired && typeof window !== 'undefined') {
    watch(activeScope, (v) => {
      try { localStorage.setItem(STORAGE_KEY, v) } catch { /* ignore */ }
    }, { immediate: true })
    persistenceWired = true
  }

  function selectScope(scope: ScopeKey): void {
    if (activeScope.value === scope) return
    activeScope.value = scope
  }

  return { activeScope, selectScope }
}
