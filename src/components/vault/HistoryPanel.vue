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
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useHistory } from '../../composables/vault/useHistory.js'
import { useOptionalVaultContext } from '../../composables/vault/context/useVaultContext.js'
import { useToast } from '../../composables/useToast.js'
import { useI18n } from '../../composables/useI18n.js'
import { WORKTREE_REF, type CommitRecord } from '../../lib/history-api.js'
import { suggestCommitMessage } from '../../lib/ai-api.js'
import EmptyState from './EmptyState.vue'

const props = defineProps<{
  currentPath?: string | null
}>()
const vaultContext = useOptionalVaultContext()

const h = useHistory()
const toast = useToast()
const { t } = useI18n()

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
const generatingCommitMessage = ref(false)
const canGenerateCommitMessage = computed(
  () => selectedCount.value > 0 && !h.busy.value && !generatingCommitMessage.value,
)

function diffTextForPrompt(): string {
  const diff = h.currentDiff.value
  if (!diff) return ''
  return diff.ops.map((op) => {
    const prefix = op.op === 'add' ? '+' : op.op === 'remove' ? '-' : ' '
    const oldLine = op.oldLine === null ? '' : String(op.oldLine)
    const newLine = op.newLine === null ? '' : String(op.newLine)
    return `${prefix} old:${oldLine} new:${newLine} ${op.text}`
  }).join('\n')
}

async function onCommit() {
  if (!canCommit.value) return
  const r = await h.createCommit([...selected.value], h.commitMessage.value)
  if (r) {
    h.commitMessage.value = ''
  }
}

async function onGenerateCommitMessage() {
  if (!canGenerateCommitMessage.value) return
  generatingCommitMessage.value = true
  try {
    const paths = [...selected.value]
    const selectedPath = h.selectedFile.value && paths.includes(h.selectedFile.value)
      ? h.selectedFile.value
      : paths[0]
    const { message } = await suggestCommitMessage({
      paths,
      selectedPath,
      diffText: selectedPath === h.selectedFile.value ? diffTextForPrompt() : undefined,
    })
    h.commitMessage.value = message
    toast.success(t('history.ai_message_success'))
  } catch (err) {
    toast.error(t('history.ai_message_failed', { error: (err as Error).message }))
  } finally {
    generatingCommitMessage.value = false
  }
}

function onToggleDirty(path: string) {
  h.toggleDirty(path, selected.value)
}

function dirtyStatus(entry: { index: string; worktree: string }): string {
  if (entry.index === '?' || entry.worktree === '?') return 'A'
  if (entry.index === 'D' || entry.worktree === 'D') return 'D'
  if (entry.index === 'R' || entry.worktree === 'R') return 'R'
  if (entry.index === 'M' || entry.worktree === 'M') return 'M'
  return entry.index.trim() || entry.worktree.trim() || 'M'
}

function dirtyStatusLabel(status: string): string {
  if (status === 'A') return t('history.added')
  if (status === 'D') return t('history.deleted')
  if (status === 'R') return t('history.renamed')
  return t('history.modified')
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
    toast.error(t('history.no_file_to_diff'))
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

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuCommit = ref<CommitRecord | null>(null)

function openCommitMenu(e: MouseEvent, commit: CommitRecord) {
  e.preventDefault()
  e.stopPropagation()
  menuCommit.value = commit
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuVisible.value = true
  nextTick(() => {
    document.addEventListener('click', closeCommitMenu, { once: true })
    document.addEventListener('keydown', onCommitMenuEscape)
  })
}

function closeCommitMenu() {
  menuVisible.value = false
  document.removeEventListener('keydown', onCommitMenuEscape)
}

function onCommitMenuEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') closeCommitMenu()
}

async function onDropCommit() {
  const commit = menuCommit.value
  if (!commit) return
  closeCommitMenu()
  const ok = typeof window !== 'undefined'
    && window.confirm(t('history.drop_confirm', {
      sha: commit.sha.slice(0, 7),
      subject: commit.subject,
    }))
  if (!ok) return
  const r = await h.dropCommit(commit.sha)
  if (r) toast.success(t('history.drop_success', { sha: commit.sha.slice(0, 7) }))
  else toast.error(t('history.drop_failed', {
    error: h.actionError.value ?? t('common.unknown_error'),
  }))
}

function toHistoryPath(path: string): string {
  return path.endsWith('.md') ? path : `${path}.md`
}

function selectInitialFile() {
  const live = vaultContext?.editor.tabs
  const candidate =
    props.currentPath
    ?? live?.value.find((t) => t.path)?.path

  if (!candidate || h.selectedFile.value) return
  const historyPath = toHistoryPath(candidate)
  if (isDirty(historyPath)) {
    void h.selectFile(historyPath, { oldRef: 'HEAD', newRef: WORKTREE_REF })
    return
  }
  void h.selectFile(historyPath, { oldRef: 'HEAD~1', newRef: 'HEAD' })
}

function timeAgo(iso: string): string {
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return ''
  const diff = Date.now() - timestamp
  const min = Math.floor(diff / 60_000)
  if (min < 1) return t('history.just_now')
  if (min < 60) return t('history.minutes_ago', { count: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('history.hours_ago', { count: hr })
  const day = Math.floor(hr / 24)
  if (day < 30) return t('history.days_ago', { count: day })
  const mon = Math.floor(day / 30)
  if (mon < 12) return t('history.months_ago', { count: mon })
  return t('history.years_ago', { count: Math.floor(mon / 12) })
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
onMounted(async () => {
  // Opening the history panel should reflect the current working tree.
  // Without this refresh, a newly-created untracked file can race the
  // initial status load and be treated as clean, which makes the panel
  // ask for HEAD~1..HEAD instead of HEAD..WORKTREE.
  await h.refreshStatus()
  selectInitialFile()
})
</script>

<template>
  <section class="history-panel" :aria-label="t('history.title')">
    <header class="history-header">
      <span class="history-title">{{ t('history.title') }}</span>
      <span class="history-subtitle" v-if="h.capability.value?.repoInitialized">
        {{ t('history.changed', { count: h.dirtyCount.value }) }}
      </span>
    </header>

    <!-- Not-available state: git missing or not yet initialized.
         The capability probe runs at app start; this is the resting
         state for a vault where the binary isn't on PATH. -->
    <div v-if="h.capability.value && !h.capability.value.gitAvailable" class="history-empty">
      <EmptyState size="compact" :title="t('history.git_unavailable')">
        {{ t('history.git_unavailable_body') }}
      </EmptyState>
    </div>
    <div v-else-if="h.capability.value && !h.capability.value.repoInitialized" class="history-empty">
      <EmptyState size="compact" :title="h.capability.value.initError ? t('history.vault_git_unavailable') : t('history.initializing')">
        <template v-if="h.capability.value.initError">{{ h.capability.value.initError }}</template>
      </EmptyState>
    </div>

    <template v-else>
      <!-- Commit composer -->
      <div class="history-composer">
        <div class="history-composer-input-wrap">
          <textarea
            ref="composerEl"
            v-model="h.commitMessage.value"
            rows="1"
            class="history-composer-input"
            :placeholder="t('history.commit_placeholder')"
            @keydown.enter.exact.prevent="onCommit"
          />
          <button
            type="button"
            class="history-ai-message-btn"
            :disabled="!canGenerateCommitMessage"
            :title="selectedCount === 0 ? t('history.select_files_first') : t('history.generate_message')"
            :aria-label="t('history.generate_message')"
            @click="onGenerateCommitMessage"
          >{{ generatingCommitMessage ? '…' : '✧' }}</button>
        </div>
        <button
          type="button"
          class="history-commit-btn"
          :disabled="!canCommit"
          :title="selectedCount === 0 ? t('history.no_files_selected') : h.commitMessage.value.trim().length === 0 ? t('history.message_required') : t('history.commit_selected')"
          @click="onCommit"
        >
          <span v-if="h.busy.value">…</span>
          <span v-else>{{ t('history.commit_files', { count: selectedCount, unit: t(selectedCount === 1 ? 'history.file_one' : 'history.files_many') }) }}</span>
        </button>
      </div>

      <!-- Changes -->
      <div class="history-section history-section-changes">
        <div class="history-section-title">
          <span>{{ t('history.changes') }}</span>
          <span class="history-section-count">{{ h.status.value.length }}</span>
        </div>
        <div v-if="h.status.value.length === 0" class="history-empty-inline">{{ t('history.no_changes') }}</div>
        <ul v-else class="history-dirty">
          <li
            v-for="entry in h.status.value"
            :key="entry.path"
            class="history-dirty-row"
            :class="{ selected: h.selectedFile.value === entry.path }"
            tabindex="0"
            @click="onRowClick(entry.path)"
            @keydown.enter.prevent="onRowClick(entry.path)"
          >
            <input
              type="checkbox"
              :checked="selected.has(entry.path)"
              :aria-label="t('history.include_path', { path: entry.path })"
              @click.stop
              @change="onToggleDirty(entry.path)"
            />
            <span class="history-dirty-path">{{ entry.path }}</span>
            <span
              class="history-dirty-status"
              :class="`is-${dirtyStatus(entry).toLowerCase()}`"
              :title="dirtyStatusLabel(dirtyStatus(entry))"
            >
              {{ dirtyStatus(entry) }}
            </span>
          </li>
        </ul>
      </div>

      <!-- Timeline -->
      <div class="history-section history-section-timeline">
        <div class="history-section-title">
          <span>{{ t('history.timeline') }}</span>
          <span class="history-section-count">{{ h.log.value.length }}</span>
        </div>
        <div v-if="h.log.value.length === 0" class="history-empty-inline">{{ t('history.no_commits') }}</div>
        <ul v-else class="history-timeline">
          <li
            v-for="c in h.log.value"
            :key="c.sha"
            class="history-commit-row"
            :class="{ selected: h.selectedNewRef.value === c.sha }"
            tabindex="0"
            @click="onCommitClick(c.sha)"
            @keydown.enter.prevent="onCommitClick(c.sha)"
            @contextmenu="openCommitMenu($event, c)"
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
                    && h.selectedNewRef.value === c.sha,
                }"
                :title="t('history.show_diff', { path, sha: c.sha.slice(0, 7) })"
                @click.stop="onCommitFileClick(c.sha, path)"
              >{{ path }}</button>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="h.actionError.value" class="history-error" role="alert">{{ h.actionError.value }}</div>
    </template>
    <Teleport to="body">
      <div
        v-if="menuVisible"
        class="history-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        role="menu"
        @click.stop
      >
        <button type="button" class="danger" role="menuitem" @click="onDropCommit">
          {{ t('history.drop_commit') }}
        </button>
      </div>
    </Teleport>
  </section>
</template>
