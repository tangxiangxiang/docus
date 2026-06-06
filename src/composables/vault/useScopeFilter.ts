// Scope filter for the vault's file tree. The filter narrows the tree
// to one of the three Zettelkasten roots (inbox / literature / zettel)
// and is rendered as chips in the NavBar (the file tree's header is too
// narrow on 150px sidebars). Both the NavBar and the FileTree need to
// read this state, so it lives in a composable with module-level refs
// — a tiny singleton pattern that keeps the storage key and watchers
// in one place instead of two.

import { ref, computed, watch } from 'vue'
import { PROTECTED_ROOTS } from '../zettelProtocol'
import type { TreeNode } from '../../lib/api'

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
// Held in a module-level ref so the scopeCounts computed re-runs when
// the tree changes (VaultView pushes the latest tree via setTree).
const treeRef = ref<TreeNode[]>([])
let persistenceWired = false

function countDescendantFiles(node: TreeNode): number {
  if (node.kind === 'file') return 1
  return (node.children ?? []).reduce((sum, c) => sum + countDescendantFiles(c), 0)
}

const scopeCounts = computed<Record<string, number>>(() => {
  const root = treeRef.value[0]
  if (!root || root.kind !== 'folder') return {}
  const out: Record<string, number> = {}
  for (const c of root.children) {
    if (PROTECTED_ROOTS.has(c.path)) out[c.path] = countDescendantFiles(c)
  }
  return out
})

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

  function setTree(tree: TreeNode[]) {
    treeRef.value = tree
  }

  return { activeScope, scopeCounts, toggleScope, setTree }
}
