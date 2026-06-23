// Module-level shared reactive state for the reading-mode TOC panel.
// ReadingPane writes the heading list, active heading id, and a scroll-to
// handler; TocPanel (a sibling in the vault grid, not a child) reads them
// to render the page navigation.
//
// Same pattern as setSelectPanelForClicks / getSelectPanelForClicks in
// useVaultLayout.ts: plain module-level refs, no provide/inject needed.

import { ref, type Ref } from 'vue'
import type { Heading } from './useMarkdownRender'

export const tocHeadings: Ref<Heading[]> = ref([])
export const tocActiveId: Ref<string> = ref('')
export const tocScrollTo: Ref<((id: string) => void) | null> = ref(null)
