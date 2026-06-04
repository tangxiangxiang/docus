// Tag filter state. Pure view-state: which tag (if any) the user has
// selected from the TagPanel. The composable also owns the side-effect
// that selecting a tag must surface the Files panel — the user picks a
// tag in the TagPanel (visible when activePanel === 'tags'), and the
// selection should bring the file tree back into view so the filtered
// files can be browsed.
//
// The activePanel ref is taken by ref (not getter) so the onTagSelect
// closure can mutate it directly. This makes the coupling explicit in
// the constructor signature — the only thing that can flip activePanel
// from a tag click is onTagSelect.

import { ref, type Ref } from 'vue'
import type { ActivePanel } from './useVaultLayout'

export function useTagFilter(opts: {
  activePanel: Ref<ActivePanel>
}) {
  const activeTagFilter = ref<string | null>(null)

  function onTagSelect(tag: string) {
    if (activeTagFilter.value === tag) {
      activeTagFilter.value = null          // toggle off
    } else {
      activeTagFilter.value = tag
      opts.activePanel.value = 'files'      // ensure file tree is visible
    }
  }

  return {
    activeTagFilter,
    onTagSelect,
  }
}
