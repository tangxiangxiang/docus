<script setup lang="ts">
/* The HistoryPanel is the side panel that lives in the left column
   when the user activates the History activity-bar button. It has
   three regions:

   1. Commit composer — textarea + "Commit N files" button. The
      textarea uses the same compact 40px-autoresize style as the
      AI composer (inputEl + autoresize, see AiPanel.vue for the
      identical pattern; the `rows="1"` is required to override
      WebKit/Blink's 2-row empty-textarea default).

   2. Changes — the dirty file list. Each row is a checkbox; the
      default selection is "all checked". The user can untick
      individual files before committing. Clicking the row (not the
      checkbox) loads that file's diff in the main area.

   3. Timeline — newest-first commit list. Each row is a commit
      (subject, time-ago, files). Clicking a commit makes it the
      "old" side of the diff for the currently selected file; the
      "new" side stays at HEAD.

   The panel renders the empty state (no git / uninitialized repo /
   no changes) inline — never a separate splash screen — so the
   layout stays stable while the user figures out what's going on. */
import { computed, onMounted, ref, watch } from 'vue'
import { useHistory } from '../../composables/vault/useHistory.js'
import { getLiveTabs } from '../../composables/vault/useEditorTabs.js'
import { useToast } from '../../composables/useToast.js'
import type { CommitRecord } from '../../lib/history-api.js'

const h = useHistory()
const toast = useToast()

/* Set of dirty paths the user has ticked. Plain Set (not reactive)
   for cheap toggle. The button label and enabled-state are derived
   from this; the value is read at commit time. Default: all
   checked. */
const selected = ref<Set<string>>(new Set())
watch(
  () => h.status.value.map((e) => e.path).join('|'),
  () => {
    // When the dirty list changes (new save, or after a commit
    // cleans some files), default any new entries to checked. We do
    // NOT uncheck what the user explicitly unchecked — but in v1 we
    // do, because the only thing this UI supports is "commit a
    // batch", and a half-checked set after the list shrinks is
    // confusing. Reset to "all checked" on every status refresh.
    selected.value = new Set(h.status.value.map((e) => e.path))
  },
  { immediate: true },
)

const selectedCount = computed(() => selected.value.size)
const canCommit = computed(
  () => selectedCount.value > 0 && h.commitMessage.value.trim().length > 0 && !h.busy.value,
)

async function onCommit() {
  if (!canCommit.value) return
  const r = await h.createCommit([...selected.value], h.commitMessage.value)
  if (r) {
    h.commitMessage.value = ''
  }
}

function onToggleDirty(path: string) {
  h.toggleDirty(path, selected.value)
}

function onRowClick(path: string) {
  // The diff is between the previous commit and the current
  // working tree (or HEAD if the file is clean at HEAD). For now
  // we use HEAD^..HEAD as a sensible default — clicking a file
  // shows the "last commit's change to that file" diff. The user
  // can pick a different old ref from the timeline.
  void h.selectFile(path, { oldRef: 'HEAD~1', newRef: 'HEAD' })
}

function onCommitClick(sha: string) {
  // Make this commit the OLD side; keep new=HEAD. The user can
  // reverse direction with the swap button on the DiffView.
  if (h.selectedFile.value) {
    void h.selectFile(h.selectedFile.value, { oldRef: sha, newRef: 'HEAD' })
    return
  }
  // No file selected yet — rather than silently stashing the ref
  // and leaving the diff area stuck on "No file selected", pick
  // the first file in this commit (or, failing that, the first
  // dirty file) and load its diff. Clicking a commit should
  // always produce a visible result.
  const commit = h.log.value.find((c) => c.sha === sha) as CommitRecord | undefined
  const candidate = commit?.files[0] ?? h.status.value[0]?.path
  if (!candidate) {
    toast.error('Open a file or make a change first — no file to diff.')
    return
  }
  void h.selectFile(candidate, { oldRef: sha, newRef: 'HEAD' })
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mon = Math.floor(day / 30)
  if (mon < 12) return `${mon}mo ago`
  return `${Math.floor(mon / 12)}y ago`
}

// --- composer autoresize (same pattern as AiPanel) -----------------------

const composerEl = ref<HTMLTextAreaElement | null>(null)
const COMPOSER_MAX_H = 160
function autoresize() {
  const el = composerEl.value
  if (!el) return
  el.style.height = 'auto'
  const natural = el.scrollHeight
  el.style.height = Math.min(natural, COMPOSER_MAX_H) + 'px'
  el.style.overflowY = natural > COMPOSER_MAX_H ? 'auto' : 'hidden'
}
watch(() => h.commitMessage.value, () => autoresize())
onMounted(() => autoresize())

/* On mount, if a tab is open and we have a clean baseline, default
   the selected file to the active tab so the diff area shows
   something useful immediately. */
onMounted(() => {
  const live = getLiveTabs()
  if (live && live.value.length > 0) {
    const active = live.value.find((t) => t.path)
    const candidate = active?.path
    if (candidate && !h.selectedFile.value) {
      void h.selectFile(candidate, { oldRef: 'HEAD~1', newRef: 'HEAD' })
    }
  }
})
</script>

<template>
  <section class="history-panel" aria-label="History">
    <header class="history-header">
      <span class="history-title">History</span>
      <span class="history-subtitle" v-if="h.capability.value?.repoInitialized">
        {{ h.dirtyCount.value }} changed
      </span>
    </header>

    <!-- Not-available state: git missing or not yet initialized.
         The capability probe runs at app start; this is the resting
         state for a vault where the binary isn't on PATH. -->
    <div v-if="h.capability.value && !h.capability.value.gitAvailable" class="history-empty">
      <div class="empty-title">Git is not available</div>
      <div class="empty-hint">Install git and add it to your PATH, then reload.</div>
    </div>
    <div v-else-if="h.capability.value && !h.capability.value.repoInitialized" class="history-empty">
      <div class="empty-title">Initializing vault…</div>
    </div>

    <template v-else>
      <!-- Commit composer -->
      <div class="history-composer">
        <textarea
          ref="composerEl"
          v-model="h.commitMessage.value"
          rows="1"
          class="history-composer-input"
          placeholder="Commit message…"
          @keydown.enter.exact.prevent="onCommit"
        />
        <button
          type="button"
          class="history-commit-btn"
          :disabled="!canCommit"
          :title="selectedCount === 0 ? 'No files selected' : h.commitMessage.value.trim().length === 0 ? 'Message required' : 'Commit selected files'"
          @click="onCommit"
        >
          <span v-if="h.busy.value">…</span>
          <span v-else>Commit {{ selectedCount }} {{ selectedCount === 1 ? 'file' : 'files' }}</span>
        </button>
      </div>

      <!-- Changes -->
      <div class="history-section">
        <div class="history-section-title">Changes ({{ h.status.value.length }})</div>
        <div v-if="h.status.value.length === 0" class="history-empty-inline">No changes.</div>
        <ul v-else class="history-dirty">
          <li
            v-for="entry in h.status.value"
            :key="entry.path"
            class="history-dirty-row"
            :class="{ selected: h.selectedFile.value === entry.path }"
            @click="onRowClick(entry.path)"
          >
            <input
              type="checkbox"
              :checked="selected.has(entry.path)"
              :aria-label="`Include ${entry.path} in commit`"
              @click.stop
              @change="onToggleDirty(entry.path)"
            />
            <span class="history-dirty-path">{{ entry.path }}</span>
            <span class="history-dirty-status">
              {{ entry.index === '?' ? 'A' : entry.worktree === 'M' ? 'M' : entry.index === 'D' || entry.worktree === 'D' ? 'D' : entry.worktree === '?' ? '?' : entry.index !== ' ' ? entry.index : ' ' }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Timeline -->
      <div class="history-section">
        <div class="history-section-title">Timeline ({{ h.log.value.length }})</div>
        <div v-if="h.log.value.length === 0" class="history-empty-inline">No commits yet.</div>
        <ul v-else class="history-timeline">
          <li
            v-for="c in h.log.value"
            :key="c.sha"
            class="history-commit-row"
            @click="onCommitClick(c.sha)"
          >
            <div class="history-commit-row-head">
              <span class="history-commit-sha">{{ c.sha.slice(0, 7) }}</span>
              <span class="history-commit-when">{{ timeAgo(c.date) }}</span>
            </div>
            <div class="history-commit-subject" :title="c.subject">{{ c.subject }}</div>
            <div v-if="c.files.length" class="history-commit-files">{{ c.files.join(', ') }}</div>
          </li>
        </ul>
      </div>

      <div v-if="h.error.value" class="history-error">{{ h.error.value }}</div>
    </template>
  </section>
</template>
