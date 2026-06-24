<script setup lang="ts">
/* Side-by-side line + word diff renderer. Takes the FileDiff shape
   from useHistory().currentDiff and renders two columns: "old" on
   the left, "new" on the right.

   Layout strategy — "paired rows":
     - equal rows: same line text in both columns
     - remove row: only the old column has the line; new column is
       a blank placeholder aligned at the same height
     - add row: only the new column has the line; old column blank
     - adjacent remove+add with word-level breakdown: both columns
       fill, with intra-line highlights from the L1 `words` field

   We don't do "unified" / unified-diff style for v1 — side-by-side
   reads more naturally for the small markdown files a vault holds,
   and the word-level highlighting is much more legible when the
   two halves are in their own columns. If/when we add a toggle,
   unified mode can layer on top.

   Performance: every diff op is one row. For a typical 200-line
   markdown note the diff has at most a few hundred rows, well
   under any virtualization threshold. We don't virtualize — that
   would break the row-pairing invariant in the remove/add gaps. */
import { computed } from 'vue'
import { useHistory } from '../../composables/vault/useHistory.js'
import type { DiffOp } from '../../lib/history-api.js'

const h = useHistory()

/**
 * Pair the raw ops into "rows" for side-by-side rendering. The
 * invariant: a row always has a left slot and a right slot; each
 * slot is either a DiffOp or `null` (a blank gap on that side).
 *
 * We don't try to align intra-block add/remove — if there are
 * three removes followed by two adds, the renderer just shows
 * three remove rows with empty right slots, then two add rows
 * with empty left slots. This loses some visual alignment vs.
 * word-diff style, but it's unambiguous and the word-level
 * `words` field handles the "same line edited" case explicitly.
 */
const rows = computed<{ left: DiffOp | null; right: DiffOp | null }[]>(() => {
  const ops = h.currentDiff.value?.ops ?? []
  const out: { left: DiffOp | null; right: DiffOp | null }[] = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.op === 'equal') {
      out.push({ left: op, right: op })
      i++
    } else if (op.op === 'remove') {
      // Walk forward to collect a run of removes followed by adds.
      // Each remove gets a row with empty right; each add gets a
      // row with empty left. The order is preserved.
      const removes: DiffOp[] = []
      while (i < ops.length && ops[i].op === 'remove') {
        removes.push(ops[i])
        i++
      }
      const adds: DiffOp[] = []
      while (i < ops.length && ops[i].op === 'add') {
        adds.push(ops[i])
        i++
      }
      const max = Math.max(removes.length, adds.length)
      for (let j = 0; j < max; j++) {
        out.push({
          left: j < removes.length ? removes[j] : null,
          right: j < adds.length ? adds[j] : null,
        })
      }
    } else {
      // lone add (no preceding remove) — just emit it.
      out.push({ left: null, right: op })
      i++
    }
  }
  return out
})

const stats = computed(() => h.currentDiff.value?.stats ?? { added: 0, removed: 0, equal: 0 })
const hasDiff = computed(() => h.selectedFile.value !== null)
</script>

<template>
  <section class="diff-view" aria-label="Diff">
    <!-- Empty state: no file selected. The HistoryPanel is the
         primary driver — when it picks a file it sets the diff,
         and we render the result here. Until then, the main area
         stays empty rather than rendering a confusing default. -->
    <div v-if="!hasDiff" class="diff-empty">
      <div class="empty-title">No file selected</div>
      <div class="empty-hint">Pick a dirty file or a commit in the History panel.</div>
    </div>

    <template v-else>
      <header class="diff-header">
        <div class="diff-path">{{ h.selectedFile.value }}</div>
        <div class="diff-stats">
          <span class="diff-stat-add">+{{ stats.added }}</span>
          <span class="diff-stat-del">-{{ stats.removed }}</span>
          <span class="diff-stat-eq">{{ stats.equal }} unchanged</span>
        </div>
        <div class="diff-refs">
          <span class="diff-ref">{{ h.selectedOldRef.value.slice(0, 7) }}</span>
          <span class="diff-ref-sep">→</span>
          <span class="diff-ref">{{ h.selectedNewRef.value.slice(0, 7) }}</span>
        </div>
      </header>

      <div v-if="h.busy.value" class="diff-loading">Loading diff…</div>
      <div v-else-if="rows.length === 0" class="diff-empty">
        <div class="empty-title">No changes</div>
        <div class="empty-hint">The two refs are identical.</div>
      </div>

      <div v-else class="diff-table" role="table">
        <div class="diff-row diff-row-head" role="row">
          <div class="diff-cell diff-cell-num" role="columnheader">old</div>
          <div class="diff-cell diff-cell-text" role="columnheader"></div>
          <div class="diff-cell diff-cell-num" role="columnheader">new</div>
          <div class="diff-cell diff-cell-text" role="columnheader"></div>
        </div>
        <div
          v-for="(row, idx) in rows"
          :key="idx"
          class="diff-row"
          :class="{
            'is-add': row.right && !row.left,
            'is-del': row.left && !row.right,
            'is-edit': row.left && row.right && row.left.text !== row.right.text,
          }"
          role="row"
        >
          <div class="diff-cell diff-cell-num" role="cell">
            {{ row.left?.oldLine ?? '' }}
          </div>
          <div class="diff-cell diff-cell-text" role="cell">
            <template v-if="row.left?.words">
              <span
                v-for="(w, j) in row.left.words"
                :key="j"
                :class="['diff-word', `diff-word-${w.op}`]"
              >{{ w.text }}</span>
            </template>
            <template v-else>{{ row.left?.text ?? '' }}</template>
          </div>
          <div class="diff-cell diff-cell-num" role="cell">
            {{ row.right?.newLine ?? '' }}
          </div>
          <div class="diff-cell diff-cell-text" role="cell">
            <template v-if="row.right?.words">
              <span
                v-for="(w, j) in row.right.words"
                :key="j"
                :class="['diff-word', `diff-word-${w.op}`]"
              >{{ w.text }}</span>
            </template>
            <template v-else>{{ row.right?.text ?? '' }}</template>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
