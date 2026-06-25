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
import { WORKTREE_REF, type CommitRecord } from '../../lib/history-api.js'

const h = useHistory()
const toast = useToast()

/* True if `path` appears in the dirty list — i.e. the working tree
   has edits not yet reflected in HEAD. Used by the row click / mount
   flows to pick the right diff defaults: dirty files diff against the
   working tree (so the user sees their uncommitted changes), clean
   files diff against HEAD~1 (so the user sees the last commit). */
function isDirty(path: string): boolean {
  return h.status.value.some((e) => e.path === path)
}

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
  // Clicking a dirty file should show the user's uncommitted edits,
  // not "what the last commit did". Diff HEAD vs the working tree so
  // the +1s they just typed land in the "new" column. For a clean
  // file, fall back to HEAD~1..HEAD — there's nothing unsaved to show.
  if (isDirty(path)) {
    void h.selectFile(path, { oldRef: 'HEAD', newRef: WORKTREE_REF })
    return
  }
  void h.selectFile(path, { oldRef: 'HEAD~1', newRef: 'HEAD' })
}

function onCommitClick(sha: string) {
  // Clicking a commit should produce a diff the user actually wanted.
  // With no file selected, pick the first file in this commit (or the
  // first dirty file as a last resort). With a file selected, keep it
  // if THIS commit actually touched it — otherwise the diff would
  // render as an empty "no changes" page and look broken. In that
  // case, switch to the commit's own first file so the user sees
  // what the commit did.
  //
  // The diff compares `sha~1` (the commit's parent) vs `sha` — i.e.
  // "what THIS commit changed". That's the standard convention in
  // GitHub / SourceTree / VSCode: clicking a commit row shows that
  // commit's own change, NOT the cumulative delta from sha up to
  // HEAD. (The cumulative view is reachable by clicking the most
  // recent commit, which is HEAD~1..HEAD for that file.)
  const commit = h.log.value.find((c) => c.sha === sha) as CommitRecord | undefined
  const current = h.selectedFile.value
  const inCommit = current && commit?.files.includes(current)
  const candidate = inCommit
    ? current
    : (commit?.files[0] ?? h.status.value[0]?.path ?? current)
  if (!candidate) {
    toast.error('Open a file or make a change first — no file to diff.')
    return
  }
  void h.selectFile(candidate, { oldRef: `${sha}~1`, newRef: sha })
}

/* Click on a specific file chip inside a commit row: open that
   file's diff at this commit. The chip's @click.stop prevents the
   row's onCommitClick from also firing (which would re-select
   files[0] and overwrite the user's intent). Same refs as the row
   click — show that commit's own change, not the cumulative diff. */
function onCommitFileClick(sha: string, path: string) {
  void h.selectFile(path, { oldRef: `${sha}~1`, newRef: sha })
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
   something useful immediately. For dirty files we diff HEAD vs the
   working tree (so the user's uncommitted edits show up); for clean
   files we fall back to the last commit (HEAD~1..HEAD). */
onMounted(() => {
  const live = getLiveTabs()
  if (live && live.value.length > 0) {
    const active = live.value.find((t) => t.path)
    const candidate = active?.path
    if (candidate && !h.selectedFile.value) {
      if (isDirty(candidate)) {
        void h.selectFile(candidate, { oldRef: 'HEAD', newRef: WORKTREE_REF })
      } else {
        void h.selectFile(candidate, { oldRef: 'HEAD~1', newRef: 'HEAD' })
      }
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
      <div class="empty-title">
        {{ h.capability.value.initError ? 'Vault git unavailable' : 'Initializing vault…' }}
      </div>
      <div v-if="h.capability.value.initError" class="empty-hint">{{ h.capability.value.initError }}</div>
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
      <div class="history-section history-section-changes">
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
      <div class="history-section history-section-timeline">
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
            <!-- One chip per file. Each chip opens the diff for THAT
                 specific file at this commit; @click.stop prevents
                 the row-level handler (which would re-select files[0])
                 from also firing. The "selected" highlight is keyed
                 on (sha, path) — not just path — because the same
                 file appears in many commits and only one of those
                 chips represents the diff currently on screen. -->
            <div v-if="c.files.length" class="history-commit-files">
              <button
                v-for="path in c.files"
                :key="path"
                type="button"
                class="history-commit-file-chip"
                :class="{
                  selected:
                    h.selectedFile.value === path
                    && h.selectedOldRef.value === c.sha,
                }"
                :title="`Show diff of ${path} at ${c.sha.slice(0, 7)}`"
                @click.stop="onCommitFileClick(c.sha, path)"
              >{{ path }}</button>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="h.error.value" class="history-error">{{ h.error.value }}</div>
    </template>
  </section>
</template>
