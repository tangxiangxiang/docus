// Module-level shared reactive state for the reading-mode TOC panel.
// ReadingPane writes the heading list, active heading id, and a scroll-to
// handler; TocPanel (a sibling in the vault grid, not a child) reads them
// to render the page navigation.
//
// Plain module-level refs keep sibling consumers in sync without
// requiring a shared component parent or provide/inject wiring.

import { ref, type Ref } from 'vue'
import type { Heading } from './useMarkdownRender'

export const tocHeadings: Ref<Heading[]> = ref([])
export const tocActiveId: Ref<string> = ref('')
export const tocScrollTo: Ref<((id: string) => void) | null> = ref(null)

/* Whether the Links half of the right rail has nothing to show.
   Written by LinksPanel via a watchEffect on its own `isEmpty`
   computed (which depends on the async backlinks fetch + the
   link index), read by TocPanel to drive the right-rail collapse
   (when exactly one half is empty, the empty half is hidden and
   the populated one fills the column). Lives at module level for
   the same reason `tocHeadings` does — TocPanel and LinksPanel are
   siblings in the vault grid, not parent/child, so provide/inject
   would be ceremony for no benefit. */
export const linksEmpty: Ref<boolean> = ref(true)
