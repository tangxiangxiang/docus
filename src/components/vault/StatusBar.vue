<script setup lang="ts">
import { computed } from 'vue'
import type { SaveStatus } from './tabs'

const props = defineProps<{
  path: string | null
  saveStatus: SaveStatus
  error: string | null
  size: number
  dirty: boolean
}>()

// The leading glyphs (● ✓ ⟳ !) come from CSS `::before` on
// `.sb-status[data-status=...]` (see style.css ~line 1351). This computed
// only owns the *text* — prepending glyphs here would render the icon
// twice. The `$(loading) Saving…` placeholder was a leftover from a
// VSCode-status-bar port; the CSS-side `⟳ ` glyph now carries the state.
const statusLabel = computed(() => {
  if (!props.path) return '—'
  if (props.saveStatus === 'saving') return 'Saving…'
  if (props.saveStatus === 'dirty') return 'Unsaved'
  if (props.saveStatus === 'saved') return 'Saved'
  if (props.saveStatus === 'error') return props.error ?? 'Error'
  return 'Idle'
})

const sizeLabel = computed(() => {
  if (!props.size) return ''
  if (props.size < 1024) return `${props.size} B`
  return `${(props.size / 1024).toFixed(1)} KB`
})

// Path segments for the center group. Drops the .md extension from
// the leaf segment — it's an internal storage detail, not part of
// the document's identity as a zettel. Rendered inline with `›`
// separators in a single text run so a single `text-overflow:
// ellipsis` on the wrapper handles long-path truncation.
const pathLabel = computed(() => {
  if (!props.path) return null
  const segs = props.path.split('/')
  const last = segs.length - 1
  if (last >= 0 && segs[last].endsWith('.md')) segs[last] = segs[last].slice(0, -3)
  return segs.join(' › ')
})
</script>

<template>
  <footer class="status-bar" aria-label="Status bar">
    <div class="sb-left">
      <!-- aria-live="polite" so screen readers hear the save state
           change ("Unsaved" → "Saving…" → "Saved") without being
           interrupted. aria-atomic="true" re-announces the whole
           status instead of just the diff. -->
      <span
        class="sb-item sb-status"
        :data-status="saveStatus"
        aria-live="polite"
        aria-atomic="true"
      >{{ statusLabel }}</span>
    </div>
    <!-- Center group carries the document path (formerly the
         breadcrumb row above the editor). It owns the flexible
         middle of the footer so the left save-status and the right
         size/format metadata never get squeezed. The chain
         ellipsizes from the right edge when the path is longer
         than the available width. -->
    <div class="sb-center" aria-label="Path">
      <span v-if="pathLabel" class="sb-path" :title="pathLabel">{{ pathLabel }}</span>
      <span v-else class="sb-path sb-path-empty">—</span>
    </div>
    <div class="sb-right">
      <span class="sb-item">Markdown</span>
      <span v-if="sizeLabel" class="sb-item">{{ sizeLabel }}</span>
    </div>
  </footer>
</template>

<style scoped>
/* Center group owns the flexible middle of the footer. `min-width: 0`
   is the critical bit — without it, flex children refuse to shrink
   below their intrinsic content width and overflow the footer.
   The .sb-path inline block inside lets text-overflow:ellipsis
   actually clip the run; flex containers themselves don't honor it. */
.sb-center {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 12px;
  font-size: 0.75rem;
  color: var(--vs-text-2, #aaa);
  user-select: none;
  overflow: hidden;
  display: flex;
  align-items: center;
}
.sb-path {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.sb-path-empty {
  font-style: italic;
  color: var(--vs-text-3, #888);
}
</style>
