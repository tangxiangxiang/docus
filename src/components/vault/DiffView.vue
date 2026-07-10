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
import { computed, ref } from 'vue'
import { useHistory } from '../../composables/vault/useHistory.js'
import { useToast } from '../../composables/useToast.js'
import { useI18n } from '../../composables/useI18n.js'
import { WORKTREE_REF, type DiffOp } from '../../lib/history-api.js'
import EmptyState from './EmptyState.vue'

const h = useHistory()
const toast = useToast()
const { t } = useI18n()

/* Refs come back from the API as HEAD-ish names, sha prefixes, or the
   WORKTREE sentinel. Timeline clicks use `<sha>~1` for the old side;
   display the resolved parent sha when it is present in the loaded
   timeline so the pane labels don't show the child sha on both sides. */
function refLabel(ref: string): string {
  if (ref === WORKTREE_REF) return t('diff.working_tree')
  const parent = ref.match(/^([0-9a-f]{7,40})~1$/i)
  if (parent) {
    const idx = h.log.value.findIndex((c) => c.sha.startsWith(parent[1]))
    const parentCommit = idx >= 0 ? h.log.value[idx + 1] : undefined
    return parentCommit ? parentCommit.sha.slice(0, 7) : t('diff.empty')
  }
  return ref.slice(0, 7)
}

/**
 * The restore button only makes sense when the two refs actually
 * differ. If they match, the file is already at the old version —
 * restoring would be a no-op (and confusing). `rows` is computed
 * elsewhere and reflects the paired rows the renderer shows.
 */
// A pure addition has no old-side blob to restore. Showing the action
// there leads to a guaranteed 404 from /history/restore because the
// file did not exist at the selected old ref.
const canRestore = computed(() => rows.value.some((row) => row.left !== null))

async function onRestore() {
  const file = h.selectedFile.value
  const ref = h.selectedOldRef.value
  if (!file) return
  // WORKTREE is a sentinel, not a real git ref — restoring to it
  // would mean "overwrite the file with the working tree version",
  // which is a no-op (the working tree IS the working tree). Block
  // it explicitly so the user gets a clear error instead of a
  // confusing git stderr.
  if (ref === WORKTREE_REF) {
    toast.error(t('diff.cannot_restore_worktree'))
    return
  }
  const label = refLabel(ref)
  // Native confirm: this is destructive and we don't want to ship a
  // modal component just for this. The user has the diff on screen
  // already, so they know what they're about to overwrite.
  const ok = typeof window !== 'undefined'
    && window.confirm(t('diff.restore_confirm', { file, label }))
  if (!ok) return
  const success = await h.restoreFile(file, ref)
  if (success) {
    toast.success(t('diff.restore_success', { file, label }))
  } else {
    toast.error(t('diff.restore_failed', {
      error: h.actionError.value ?? t('common.unknown_error'),
    }))
  }
}

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

const oldPane = ref<HTMLElement | null>(null)
const newPane = ref<HTMLElement | null>(null)
let syncingScroll = false

function syncVerticalScroll(source: 'old' | 'new') {
  if (syncingScroll) return
  const from = source === 'old' ? oldPane.value : newPane.value
  const to = source === 'old' ? newPane.value : oldPane.value
  if (!from || !to) return
  syncingScroll = true
  to.scrollTop = from.scrollTop
  requestAnimationFrame(() => {
    syncingScroll = false
  })
}
</script>

<template>
  <section class="diff-view" :aria-label="t('diff.title')" :aria-busy="h.busy.value">
    <!-- Empty state: no file selected. The HistoryPanel is the
         primary driver — when it picks a file it sets the diff,
         and we render the result here. Until then, the main area
         stays empty rather than rendering a confusing default. -->
    <div v-if="!hasDiff" class="diff-empty">
      <EmptyState size="compact" :title="t('diff.no_file_selected')">
        {{ t('diff.pick_file') }}
      </EmptyState>
    </div>

    <template v-else>
      <header class="diff-header">
        <div class="diff-path">{{ h.selectedFile.value }}</div>
        <div class="diff-stats">
          <span class="diff-stat-add">+{{ stats.added }}</span>
          <span class="diff-stat-del">-{{ stats.removed }}</span>
          <span class="diff-stat-eq">{{ t('diff.unchanged', { count: stats.equal }) }}</span>
        </div>
        <div class="diff-refs">
          <span class="diff-ref">{{ refLabel(h.selectedOldRef.value) }}</span>
          <span class="diff-ref-sep">→</span>
          <span class="diff-ref">{{ refLabel(h.selectedNewRef.value) }}</span>
        </div>
        <!-- Restore: overwrite the on-disk file with the OLD ref's
             version. Only shown when there's something to restore
             (i.e. the old side differs from the new side — when
             they're identical the diff is empty and the button would
             be a no-op anyway, but we still gate it for clarity).
             Hidden when the old ref is WORKTREE (a no-op restore
             target — see onRestore). We confirm with a native
             dialog because this is genuinely destructive: the
             working tree is overwritten and any unsaved local
             edits to that file are lost. -->
        <div class="diff-actions">
          <button
            v-if="canRestore && h.selectedOldRef.value !== WORKTREE_REF"
            class="diff-restore-btn"
            :disabled="h.busy.value"
            :title="t('diff.overwrite_title', { file: h.selectedFile.value ?? '', label: refLabel(h.selectedOldRef.value) })"
            @click="onRestore"
          >{{ t('diff.restore_old') }}</button>
        </div>
      </header>

      <div v-if="h.busy.value && !h.currentDiff.value" class="diff-loading">
        <span class="diff-loading-indicator" aria-hidden="true" />
        {{ t('diff.loading') }}
      </div>
      <div v-else-if="h.diffError.value && !h.currentDiff.value" class="diff-empty diff-error" role="alert">
        <EmptyState size="compact" :title="t('diff.unable')">
          {{ h.diffError.value }}
        </EmptyState>
      </div>
      <div v-else-if="rows.length === 0" class="diff-empty">
        <EmptyState size="compact" :title="t('diff.no_changes')">
          {{ t('diff.identical') }}
        </EmptyState>
      </div>

      <div v-else class="diff-table" role="group" :aria-label="t('diff.side_by_side')">
        <div
          ref="oldPane"
          class="diff-pane diff-pane-old"
          role="table"
          :aria-label="t('diff.old_version')"
          @scroll="syncVerticalScroll('old')"
        >
          <div class="diff-pane-title">
            <span class="diff-pane-label">{{ t('diff.old') }}</span>
            <span class="diff-pane-ref">{{ refLabel(h.selectedOldRef.value) }}</span>
          </div>
          <div
            v-for="(row, idx) in rows"
            :key="`old-${idx}`"
            class="diff-row"
            :class="{
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
          </div>
        </div>

        <div
          ref="newPane"
          class="diff-pane diff-pane-new"
          role="table"
          :aria-label="t('diff.new_version')"
          @scroll="syncVerticalScroll('new')"
        >
          <div class="diff-pane-title">
            <span class="diff-pane-label">{{ t('diff.new') }}</span>
            <span class="diff-pane-ref">{{ refLabel(h.selectedNewRef.value) }}</span>
          </div>
          <div
            v-for="(row, idx) in rows"
            :key="`new-${idx}`"
            class="diff-row"
            :class="{
              'is-add': row.right && !row.left,
              'is-edit': row.left && row.right && row.left.text !== row.right.text,
            }"
            role="row"
          >
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
      </div>
    </template>
  </section>
</template>
