<script setup lang="ts">
// AI panel — UI + persistence + LLM. The close button emits `close`
// so the parent can decide what to do (typically toggleAi in
// VaultView). The composer sends a user message to the active
// session via useAiHistory.sendAndStream; the server streams back
// tokens that fill the assistant bubble in real time.
//
// The `configured` flag (from /api/ai/active) determines whether
// the send button is enabled. When false, a persistent banner
// explains the missing env var.
//
// The send button is a single toggle: when idle, it sends (type=
// submit so Enter still triggers it); when busy, it stops the
// in-flight stream (type=button, distinct color/icon so the
// destructive nature reads visually). See useAiHistory.stop() for
// the AbortController plumbing.
//
// Tool cards: when the assistant message carries tool calls
// (m.blocks?.toolCalls), each call is rendered as a card with the
// tool name, an icon, a status pill (ok / error / pending), and
// the result text. read_file / list_files cards are collapsed by
// default to keep the panel compact; the user can expand them.
import { onMounted, ref, watch, computed, inject, nextTick } from 'vue'
import { ICON_AI, ICON_HISTORY, ICON_NEW_CHAT, ICON_FILE_MD } from './icons'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useCurrentNote } from '../../composables/vault/useCurrentNote'
import { useSplitReview } from '../../composables/vault/useSplitReview'
import { writeDraftBatch, type Card, type SplitMode } from '../../lib/ai-api'
import { type PostSummary } from '../../lib/api'
import { useArchiveToZettel } from '../../composables/vault/useArchiveToZettel'
import { useToast } from '../../composables/useToast'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'
import AiSessionPicker from './AiSessionPicker.vue'
import AiToolCallCard from './AiToolCallCard.vue'

const props = defineProps<{
  posts?: PostSummary[]
}>()

const emit = defineEmits<{
  close: []
  'split-request': [path: string, mode: SplitMode]
  'refresh-tree': []
  open: [path: string]
}>()

const draft = ref('')
const pickerOpen = ref(false)
const history = useAiHistory()
const currentNote = useCurrentNote()
const { archive: archiveToZettel } = useArchiveToZettel()
const toast = useToast()
const { confirm } = useConfirm()
const { t } = useI18n()

// Injected by VaultView. Default to a fresh local instance if the panel
// ever renders without a provider (defensive — keeps the panel functional
// in isolation, e.g. in a test harness).
const review = inject<ReturnType<typeof useSplitReview> | null>('splitReview', null) ?? useSplitReview()

/* Composer auto-grow. The textarea is sized to its content (up to
   INPUT_MAX_H) so a short prompt is one line tall and a multi-line
   paste expands naturally — no internal scrollbar at the sizes
   people actually type. At the cap we flip to overflow-y:auto so a
   wall-of-text paste is still keyboard- / wheel-scrollable inside
   the field; the scrollbar itself is rendered transparent in
   style.css, so the input reads as scrollbar-free at a glance.

   - @input fires it on every keystroke (instant feedback while typing)
   - watch(draft) catches programmatic clears (after onSend sets
     draft.value = '') so the field collapses back to one line
   - onMounted fires the initial size for the empty state

   Setting height:'auto' first is the standard textarea autoresize
   trick — without it scrollHeight reflects the *current* height
   and never grows.

   The template pins `rows="1"`. Without it, an empty textarea in
   WebKit/Blink reports a 2-row scrollHeight (~60px) and autoresize
   writes that to the inline height, overriding CSS min-height. The
   explicit 1-row attribute makes the empty-state scrollHeight
   match the 40px floor we want. */
const inputEl = ref<HTMLTextAreaElement | null>(null)
const INPUT_MAX_H = 160
function autoresize() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  const natural = el.scrollHeight
  el.style.height = Math.min(natural, INPUT_MAX_H) + 'px'
  el.style.overflowY = natural > INPUT_MAX_H ? 'auto' : 'hidden'
}

onMounted(async () => {
  await history.loadActive()
  autoresize()
})
watch(draft, () => autoresize())

async function onSend() {
  const text = draft.value.trim()
  if (!text) return
  if (history.busy.value) return
  if (!history.configured.value) return
  // Slash commands are intercepted before the regular chat path so
  // "/split inbox" doesn't go to Claude as a regular user message.
  if (text.startsWith('/')) {
    const handled = await trySlashCommand(text)
    if (handled) {
      draft.value = ''
      return
    }
  }
  draft.value = '' // clear immediately for snappy UX
  await history.sendAndStream(text, {
    path: currentNote.path.value ?? '',
  })
}

function onStop() {
  // Triggers AbortController inside sendAndStream; the stream
  // ends, the for-await exits, busy flips to false, and the
  // assistant message gets an [aborted] tag.
  history.stop()
}

function onSendOrStop() {
  // Single button, two behaviors. The form's @submit still routes
  // Enter through onSend(), so this handler only governs clicks.
  if (history.busy.value) onStop()
  else onSend()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
}

async function onNewSession() {
  if (history.busy.value) return
  pickerOpen.value = false
  await history.createSession()
}

// Lightweight slash command: if the user types "/split" (with or
// without "inbox"/"literature" suffix) and the panel is not busy,
// route to the same splitCard flow that the tree menu uses.
//
// We only handle the parsing here — the actual LLM call lives in
// VaultView.splitCard, which the panel reaches by emitting a
// 'split-request' event the parent listens for. The parent sets the
// review state, the panel re-renders.
async function trySlashCommand(text: string): Promise<boolean> {
  const m = text.match(/^\/split(?:\s+(inbox|literature))?\s*$/i)
  if (!m) return false
  // Slash command: we don't have a path yet, so we ask the user
  // which note to split by reading the currently active note.
  // If no note is open, we surface a hint.
  const path = currentNote.path.value
  if (!path) return false
  const explicitMode = (m[1]?.toLowerCase() as SplitMode | undefined)
  // If the user passed an explicit mode, honor it. Otherwise infer
  // from the path prefix — same rule the tree menu uses.
  const mode: SplitMode = explicitMode
    ?? (path.startsWith('literature/') ? 'literature' : 'inbox')
  if (!path.startsWith('inbox/') && !path.startsWith('literature/')) {
    return false
  }
  review.setLoading(path, mode)
  // The actual fetch happens in VaultView's splitCard; we trigger
  // it by emitting. The parent handles it.
  emit('split-request', path, mode)
  return true
}

const quickPrompts = computed(() => {
  const hasNote = Boolean(currentNote.path.value)
  return hasNote
    ? [
        { label: t('quick_prompts.with_note.summarize.label'), text: t('quick_prompts.with_note.summarize.text') },
        { label: t('quick_prompts.with_note.find_related.label'), text: t('quick_prompts.with_note.find_related.text') },
        { label: t('quick_prompts.with_note.suggest_tidy.label'), text: t('quick_prompts.with_note.suggest_tidy.text') },
      ]
    : [
        { label: t('quick_prompts.no_note.browse.label'), text: t('quick_prompts.no_note.browse.text') },
        { label: t('quick_prompts.no_note.find_unprocessed.label'), text: t('quick_prompts.no_note.find_unprocessed.text') },
        { label: t('quick_prompts.no_note.suggest_tidy.label'), text: t('quick_prompts.no_note.suggest_tidy.text') },
      ]
})

const draftAreaFilter = ref<'all' | 'inbox' | 'literature'>('all')

const draftNotes = computed(() => {
  return (props.posts ?? [])
    .filter((post) => post.path.startsWith('inbox/draft/') || post.path.startsWith('literature/draft/'))
    .filter((post) => draftAreaFilter.value === 'all' || draftArea(post.path) === draftAreaFilter.value)
    .sort((a, b) => b.mtime - a.mtime)
})

function draftArea(path: string): string {
  return path.startsWith('literature/') ? 'literature' : 'inbox'
}

async function archiveDraft(path: string) {
  const movedPath = await archiveToZettel(path)
  if (!movedPath) return
  emit('refresh-tree')
  emit('open', movedPath)
}

/* Batch archive. Pre-computes unique target paths so the server-side
   -2 suffix collision handler doesn't kick in for each draft — the
   client has full visibility into all existing zettel paths via
   props.posts, so it can pick zettel/foo, zettel/foo-2, zettel/foo-3
   upfront and send each PATCH with its final name. This avoids the
   '5 drafts become foo-2/-3/-4/-5/-6' scatter problem.

   Conflicts are still possible between the pre-compute and the
   request landing (a parallel archive by the user, an external file
   move) — when that happens the server returns a 409 and the
   composable's archive() will toast the error. We don't retry; the
   user can re-trigger with the latest posts[] in hand. */
const batchArchivePreview = computed(() => {
  // Mirror the server's existing-set: anything currently under zettel/
  // is taken. We index by basename so 'zettel/foo' blocks 'zettel/foo-2'
  // as a basename collision too — the server would otherwise suffix on
  // first archive and we'd race.
  const taken = new Set<string>()
  for (const p of props.posts ?? []) {
    if (p.path.startsWith('zettel/')) {
      taken.add(p.path.slice('zettel/'.length).replace(/\.md$/, ''))
    }
  }
  // Inbox drafts first so a literature draft of the same slug gets
  // the -2 suffix (matches the server's per-call ordering: the FIRST
  // archived wins, the next gets -2). The user's mental model of
  // 'inbox < literature' as the canonical intake order matches this.
  const inbox = draftNotes.value.filter((d) => draftArea(d.path) === 'inbox')
  const literature = draftNotes.value.filter((d) => draftArea(d.path) === 'literature')
  const ordered = [...inbox, ...literature]

  const targets: { from: string; to: string }[] = []
  for (const d of ordered) {
    const base = d.path.split('/').pop()!.replace(/\.md$/, '')
    let candidate = base
    if (taken.has(candidate)) {
      for (let i = 2; i < 1000; i++) {
        const next = `${base}-${i}`
        if (!taken.has(next)) { candidate = next; break }
      }
    }
    taken.add(candidate)
    // targetPath goes to PATCH /api/posts/*, which accepts paths
    // WITHOUT the .md suffix and appends it itself server-side.
    targets.push({ from: d.path, to: `zettel/${candidate}` })
  }
  return targets
})

async function batchArchiveAll() {
  const targets = batchArchivePreview.value
  if (targets.length === 0) return
  const preview = targets.map((t) => `${t.to.replace(/^zettel\//, '')}.md`).join('\n')
  const ok = await confirm(`归档 ${targets.length} 张草稿:\n\n${preview}`)
  if (!ok) return
  let okCount = 0
  for (const t of targets) {
    const moved = await archiveToZettel(t.from, t.to)
    if (moved) okCount++
  }
  if (okCount > 0) emit('refresh-tree')
  if (okCount === targets.length) {
    toast.success(`已归档 ${okCount} 张`)
  } else {
    toast.error(`归档了 ${okCount}/${targets.length} 张，剩余的失败了`)
  }
}

async function useQuickPrompt(text: string) {
  draft.value = text
  await nextTick()
  autoresize()
  inputEl.value?.focus()
}

function draftPrefixForMode(mode: SplitMode): string {
  return mode === 'literature' ? 'literature/draft' : 'inbox/draft'
}

// Card-edit handlers. The review surface uses v-model on each
// field, so the handlers are simple: set, splice, push.

function updateCard(index: number, patch: Partial<Card>) {
  if (review.phase.value.kind !== 'review') return
  const card = review.phase.value.cards[index]
  if (!card) return
  Object.assign(card, patch)
}

function removeCard(index: number) {
  if (review.phase.value.kind !== 'review') return
  review.phase.value.cards.splice(index, 1)
  // Rebuild `selected` to match the surviving indices. Without
  // this, indices ≥ the removed one are stale and would point at
  // the wrong cards (the watcher on phase.kind doesn't re-fire on
  // a splice because `kind` doesn't change).
  selected.value = new Set(
    [...selected.value]
      .filter((i) => i !== index)
      .map((i) => (i > index ? i - 1 : i))
  )
  // If we just removed the last card, drop back to chat. The
  // empty-state UX: the 写入 button is disabled, but a cardless
  // review state is a weird dead-end so we close it.
  if (review.phase.value.cards.length === 0) review.reset()
}

function addBlankCard() {
  if (review.phase.value.kind !== 'review') return
  const path = currentNote.path.value ?? 'inbox/unknown'
  // Avoid the obvious collision: two clicks of "+ 新增卡片"
  // would otherwise produce two cards with slug "new-card",
  // and the batch route would silently rename one to "new-card-2".
  // Pick a slug that's not already in the current list.
  const existing = new Set(review.phase.value.cards.map((c) => c.slug))
  let slug = 'new-card'
  for (let i = 2; existing.has(slug); i++) slug = 'new-card-' + i
  review.phase.value.cards.push({
    title: '新卡片',
    body: '',
    tags: [],
    slug,
    source: path,
  })
  // The new card defaults to selected. The phase.kind watcher
  // doesn't re-fire on push, so we update `selected` directly.
  const newIndex = review.phase.value.cards.length - 1
  selected.value = new Set([...selected.value, newIndex])
}

// `selected` is a Set<number> of card indices. We keep it as a
// local reactive Set (not part of the composable) because it's
// purely UI state — the server doesn't care which cards are
// selected, only which cards the user submitted.
const selected = ref<Set<number>>(new Set())

// Reset selection whenever we enter a new review (the cards are
// new instances, so old indices don't apply).
watch(() => review.phase.value, (p) => {
  if (p.kind === 'review') {
    selected.value = new Set(p.cards.map((_, i) => i))
  } else {
    selected.value = new Set()
  }
}, { immediate: true, deep: true })

function toggleCard(index: number) {
  if (selected.value.has(index)) selected.value.delete(index)
  else selected.value.add(index)
  selected.value = new Set(selected.value)
}

const writableCards = computed<Card[]>(() => {
  if (review.phase.value.kind !== 'review') return []
  return review.phase.value.cards.filter((_, i) => selected.value.has(i))
})

const writeStatus = ref<{ written: number; skipped: number; failed: number } | null>(null)

async function onWrite() {
  if (review.phase.value.kind !== 'review') return
  if (writableCards.value.length === 0) return
  writeStatus.value = null
  let res: { written: unknown[]; skipped: unknown[]; failed: unknown[] }
  try {
    res = await writeDraftBatch({ cards: writableCards.value })
  } catch (err: any) {
    // Network/parse failure: stay on the review surface so the user
    // can retry. (Per-card failures inside `res.failed` are
    // already non-fatal and would have been reported in
    // `written`/`failed` below.)
    writeStatus.value = { written: 0, skipped: 0, failed: writableCards.value.length }
    return
  }
  writeStatus.value = {
    written: res.written.length,
    skipped: res.skipped.length,
    failed: res.failed.length,
  }
  emit('refresh-tree')
  // Drop back to the chat surface. The toast (set in VaultView via
  // the same refresh flow) tells the user the write happened; the
  // review surface staying open would be a dead-end. If the user
  // wants to write more cards from the same note, they can
  // /split again.
  review.reset()
}

// Whenever the review phase changes to 'review', initialize a
// `tagsInput: string` field on each card so the v-model input
// has a string to bind to. We do this in AiPanel (not the
// composable) because the tags stringification is a UI detail
// — the server only sees the array.
watch(() => review.phase.value, (p) => {
  if (p.kind === 'review') {
    for (const card of p.cards) {
      ;(card as any).tagsInput = card.tags.join(', ')
    }
  }
}, { immediate: true, deep: true })
</script>

<template>
  <aside class="ai-panel" aria-label="AI assistant">
    <header class="ai-header">
      <div class="ai-title">
        <span class="ai-title-icon" v-html="ICON_AI" aria-hidden="true" />
        <span class="ai-title-text">AI</span>
        <template v-if="history.activeSession.value?.title">
          <span class="ai-title-sep" aria-hidden="true">·</span>
          <span
            class="ai-title-session"
            :title="history.activeSession.value.title"
          >{{ history.activeSession.value.title }}</span>
        </template>
      </div>
      <button
        class="ai-header-btn"
        type="button"
        :title="pickerOpen ? 'Close history' : 'Open history'"
        :aria-label="pickerOpen ? 'Close history' : 'Open history'"
        aria-haspopup="dialog"
        :aria-expanded="pickerOpen"
        @click="togglePicker"
      ><span v-html="ICON_HISTORY" aria-hidden="true" /></button>
      <button
        class="ai-header-btn"
        type="button"
        title="New conversation"
        aria-label="New conversation"
        :disabled="history.busy.value"
        @click="onNewSession"
      ><span v-html="ICON_NEW_CHAT" aria-hidden="true" /></button>
    </header>

    <div
      v-if="!history.configured.value"
      class="ai-no-key-banner"
      role="status"
    >AI not configured — open Settings from the activity bar.</div>

    <!-- Review surface: shown when useSplitReview.phase is 'review'.
         The chat surface is hidden (not stacked) so the user isn't
         looking at two parallel UIs. Closing the review drops back
         to the chat surface exactly as it was. -->
    <div
      v-if="review.phase.value.kind === 'review'"
      class="ai-review"
      role="region"
      aria-label="Card draft review"
    >
      <div class="ai-review-header">
        <span class="ai-review-title">
          卡片草稿
          <span class="ai-review-mode">· {{ review.phase.value.kind === 'review' ? review.phase.value.mode : '' }}</span>
        </span>
        <span class="ai-review-count">{{ writableCards.length }} / {{ review.phase.value.kind === 'review' ? review.phase.value.cards.length : 0 }} 选中</span>
      </div>

      <ul class="ai-review-list">
        <li
          v-for="(card, i) in (review.phase.value.kind === 'review' ? review.phase.value.cards : [])"
          :key="i"
          class="ai-review-card"
        >
          <label class="ai-review-check">
            <input
              type="checkbox"
              :checked="selected.has(i)"
              @change="toggleCard(i)"
            />
          </label>
          <div class="ai-review-fields">
            <input
              v-model="card.title"
              class="ai-review-title-input"
              placeholder="标题"
              @input="updateCard(i, { title: ($event.target as HTMLInputElement).value })"
            />
            <input
              v-model="card.slug"
              class="ai-review-slug-input"
              placeholder="slug"
              :title="'将作为 ' + draftPrefixForMode(review.phase.value.mode) + '/' + card.slug + '.md 的文件名'"
              @input="updateCard(i, { slug: ($event.target as HTMLInputElement).value })"
            />
            <textarea
              v-model="card.body"
              class="ai-review-body"
              rows="4"
              placeholder="正文 (Markdown)"
              @input="updateCard(i, { body: ($event.target as HTMLTextAreaElement).value })"
            />
            <input
              v-model="(card as any).tagsInput"
              class="ai-review-tags"
              placeholder="tag, tag, tag"
              @input="updateCard(i, { tags: (($event.target as HTMLInputElement).value).split(',').map((s) => s.trim()).filter(Boolean) })"
            />
          </div>
          <button
            type="button"
            class="ai-review-remove"
            :aria-label="'删除卡片 ' + card.title"
            @click="removeCard(i)"
          >×</button>
        </li>
      </ul>

      <div class="ai-review-actions">
        <button
          type="button"
          class="ai-review-add"
          @click="addBlankCard"
        >+ 新增卡片</button>
        <button
          type="button"
          class="ai-review-cancel"
          @click="review.reset()"
        >取消</button>
        <button
          type="button"
          class="ai-review-write"
          :disabled="writableCards.length === 0"
          @click="onWrite"
        >写入 {{ draftPrefixForMode(review.phase.value.mode) }}/</button>
      </div>

      <div v-if="writeStatus" class="ai-review-status" role="status">
        已写入 draft {{ writeStatus.written }} 张,
        失败 {{ writeStatus.failed }} 张
        <span v-if="writeStatus.failed > 0">(检查控制台)</span>
      </div>
    </div>

    <template v-else>
      <!-- Loading / error banner: shown above the chat surface so
           the user gets feedback even if the chat is empty. -->
      <div
        v-if="review.phase.value.kind === 'loading'"
        class="ai-review-banner"
        role="status"
      >正在生成卡片草稿…</div>
      <div
        v-else-if="review.phase.value.kind === 'error'"
        class="ai-review-banner ai-review-banner-error"
        role="alert"
      >{{ review.phase.value.reason }}</div>

      <section
        v-if="draftNotes.length"
        class="ai-drafts"
        aria-label="Draft notes"
      >
        <div class="ai-drafts-head">
          <span class="ai-drafts-title">Drafts</span>
          <span class="ai-drafts-count">{{ draftNotes.length }}</span>
          <div class="ai-drafts-filter" role="radiogroup" aria-label="按来源区筛选">
            <button
              type="button"
              class="ai-drafts-filter-btn"
              :class="{ 'is-active': draftAreaFilter === 'all' }"
              role="radio"
              :aria-checked="draftAreaFilter === 'all'"
              @click="draftAreaFilter = 'all'"
            >全部</button>
            <button
              type="button"
              class="ai-drafts-filter-btn"
              :class="{ 'is-active': draftAreaFilter === 'inbox' }"
              role="radio"
              :aria-checked="draftAreaFilter === 'inbox'"
              @click="draftAreaFilter = 'inbox'"
            >Inbox</button>
            <button
              type="button"
              class="ai-drafts-filter-btn"
              :class="{ 'is-active': draftAreaFilter === 'literature' }"
              role="radio"
              :aria-checked="draftAreaFilter === 'literature'"
              @click="draftAreaFilter = 'literature'"
            >Lit</button>
          </div>
          <button
            type="button"
            class="ai-drafts-archive-all"
            title="归档所有 draft 到 zettel"
            aria-label="归档所有 draft 到 zettel"
            @click="batchArchiveAll"
          >归档全部</button>
        </div>
        <ul class="ai-drafts-list">
          <li
            v-for="note in draftNotes"
            :key="note.path"
            class="ai-draft-item"
          >
            <button
              type="button"
              class="ai-draft-open"
              :title="note.path"
              @click="emit('open', note.path)"
            >
              <span class="ai-draft-title">{{ note.title || note.path.split('/').pop() }}</span>
              <span class="ai-draft-path">{{ draftArea(note.path) }}</span>
            </button>
            <button
              type="button"
              class="ai-draft-archive"
              :aria-label="'归档 ' + note.title"
              title="归档到 zettel"
              @click="archiveDraft(note.path)"
            >归档</button>
          </li>
        </ul>
      </section>

      <div class="ai-messages" role="log" aria-live="polite">
        <template v-if="history.messages.value.length === 0">
          <div class="ai-empty-chat">
            <div class="ai-empty-head">
              <span class="ai-empty-icon" v-html="ICON_AI" aria-hidden="true" />
              <div>
                <div class="ai-empty-title">
                  {{ currentNote.path.value ? 'Ask about current note' : 'Ask about your vault' }}
                </div>
                <div class="ai-empty-subtitle">
                  {{ currentNote.path.value || 'No document selected' }}
                </div>
              </div>
            </div>
            <div class="ai-quick-prompts" aria-label="Quick prompts">
              <button
                v-for="p in quickPrompts"
                :key="p.label"
                type="button"
                class="ai-quick-prompt"
                @click="useQuickPrompt(p.text)"
              >{{ p.label }}</button>
            </div>
          </div>
        </template>
        <template v-else>
          <div
            v-for="m in history.messages.value"
            :key="m.id || `${m.sessionId}-${m.createdAt}`"
            class="ai-message"
            :class="[m.role, { 'ai-streaming': m.id === 0 || m.id === -1 }]"
          >
            <div
              v-if="m.role === 'assistant'"
              class="ai-avatar"
              v-html="ICON_AI"
              aria-hidden="true"
            />
            <div class="ai-bubble">
              <div v-if="m.content" class="ai-text">{{ m.content }}</div>
              <AiToolCallCard
                v-for="tc in m.blocks?.toolCalls ?? []"
                :key="tc.id"
                :call="tc"
              />
            </div>
          </div>
        </template>
      </div>

      <form class="ai-composer" @submit.prevent="onSend">
        <!-- Two-layer card: the input sits on top, the toolbar
             (slash shortcut + current-note context + send button)
             sits below as a separate row. The thin top border on
             the toolbar is what makes the two halves read as
             distinct layers, matching the Claude Code CLI composer. -->
        <div class="ai-composer-card">
          <textarea
            ref="inputEl"
            v-model="draft"
            class="ai-input"
            rows="1"
            placeholder="Ask Claude…"
            aria-label="Ask Claude"
            @keydown="onKeydown"
            @input="autoresize"
          />
          <div class="ai-toolbar">
            <div class="ai-toolbar-left">
              <!-- Current-note context chip. The AI panel already
                   passes currentNote.path into sendAndStream, so
                   the chip is informational — it tells the user
                   which note will be sent as context for the next
                   message. We keep the full path on hover (via
                   title) and ellipsize in the visible label. -->
              <span
                v-if="currentNote.path.value"
                class="ai-context"
                :title="currentNote.path.value"
              >
                <span class="ai-context-icon" v-html="ICON_FILE_MD" aria-hidden="true" />
                <span class="ai-context-path">{{ currentNote.path.value }}</span>
              </span>
              <span v-else class="ai-context ai-context-empty">
                no document
              </span>
            </div>
            <div class="ai-toolbar-right">
              <button
                class="ai-send"
                :class="{ 'ai-send-busy': history.busy.value }"
                type="button"
                :title="history.busy.value ? 'Stop' : 'Send (Enter)'"
                :aria-label="history.busy.value ? 'Stop' : 'Send'"
                :disabled="!history.busy.value && (!draft.trim() || !history.configured.value)"
                @click="onSendOrStop"
              >{{ history.busy.value ? '■' : '↑' }}</button>
            </div>
          </div>
        </div>
      </form>

      <AiSessionPicker v-if="pickerOpen" @close="pickerOpen = false" />
    </template>
  </aside>
</template>

<style scoped>
/* Tool card styles. Kept scoped to AiPanel.vue so they don't leak.
   The base .ai-bubble styles handle alignment with the avatar. */
.ai-text {
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-empty-chat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0;
  color: var(--vs-text-2, #858585);
}
.ai-empty-head {
  display: flex;
  align-items: center;
  gap: 9px;
}
.ai-empty-icon {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: color-mix(in srgb, var(--vs-accent, #007acc) 82%, var(--vs-text-1, #d4d4d4));
  background: color-mix(in srgb, var(--vs-accent, #007acc) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--vs-accent, #007acc) 22%, transparent);
  border-radius: 7px;
}
.ai-empty-icon :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}
.ai-empty-title {
  color: var(--vs-text-1, #d4d4d4);
  font-size: 0.86rem;
  font-weight: 600;
  line-height: 1.25;
}
.ai-empty-subtitle {
  margin-top: 2px;
  max-width: 230px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vs-text-3, #6a6a6a);
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.72rem;
}
.ai-quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ai-quick-prompt {
  padding: 4px 7px;
  border: 1px solid color-mix(in srgb, var(--vs-border, #3c3c3c) 74%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--vs-bg-2, #252526) 72%, transparent);
  color: var(--vs-text-2, #858585);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.ai-quick-prompt:hover {
  color: var(--vs-text-1, #d4d4d4);
  background: color-mix(in srgb, var(--vs-accent, #007acc) 10%, var(--vs-bg-2, #252526));
  border-color: color-mix(in srgb, var(--vs-accent, #007acc) 36%, var(--vs-border, #3c3c3c));
}
.ai-drafts {
  flex: 0 0 auto;
  margin: 8px 10px 0;
  border: 1px solid color-mix(in srgb, var(--vs-border, #3c3c3c) 72%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--vs-bg-2, #252526) 72%, transparent);
  overflow: hidden;
}
.ai-drafts-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 30px;
  padding: 0 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--vs-border, #3c3c3c) 55%, transparent);
}
.ai-drafts-title {
  color: var(--vs-text-1, #d4d4d4);
  font-size: 0.78rem;
  font-weight: 650;
}
.ai-drafts-count {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vs-accent, #007acc) 13%, transparent);
  color: color-mix(in srgb, var(--vs-accent, #007acc) 78%, var(--vs-text-1, #d4d4d4));
  font-size: 0.7rem;
  line-height: 1.35;
  text-align: center;
}
.ai-drafts-archive-all {
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--vs-accent, #007acc) 35%, var(--vs-border, #3c3c3c));
  border-radius: 4px;
  background: transparent;
  color: var(--vs-accent, #007acc);
  font: inherit;
  font-size: 0.7rem;
  line-height: 1.35;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.ai-drafts-archive-all:hover {
  background: color-mix(in srgb, var(--vs-accent, #007acc) 12%, transparent);
  border-color: var(--vs-accent, #007acc);
}
.ai-drafts-filter {
  display: inline-flex;
  gap: 2px;
  padding: 1px;
  border: 1px solid color-mix(in srgb, var(--vs-border, #3c3c3c) 60%, transparent);
  border-radius: 4px;
}
.ai-drafts-filter-btn {
  padding: 1px 6px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--vs-text-3, #6a6a6a);
  font: inherit;
  font-size: 0.68rem;
  line-height: 1.35;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.ai-drafts-filter-btn:hover {
  color: var(--vs-text-1, #d4d4d4);
}
.ai-drafts-filter-btn.is-active {
  background: color-mix(in srgb, var(--vs-accent, #007acc) 18%, transparent);
  color: var(--vs-accent, #007acc);
}
.ai-drafts-list {
  display: flex;
  flex-direction: column;
  max-height: 164px;
  margin: 0;
  padding: 4px;
  list-style: none;
  overflow-y: auto;
}
.ai-draft-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 2px 3px 2px 6px;
  border-radius: 5px;
}
.ai-draft-item:hover {
  background: color-mix(in srgb, var(--vs-list-hover, #2a2d2e) 70%, transparent);
}
.ai-draft-open,
.ai-draft-archive {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ai-draft-open {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 2px 0;
  text-align: left;
}
.ai-draft-title,
.ai-draft-path {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-draft-title {
  color: var(--vs-text-1, #d4d4d4);
  font-size: 0.78rem;
  line-height: 1.25;
}
.ai-draft-path {
  color: var(--vs-text-3, #6a6a6a);
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.68rem;
  line-height: 1.2;
}
.ai-draft-archive {
  opacity: 0;
  padding: 3px 6px;
  border-radius: 5px;
  color: var(--vs-accent, #007acc);
  font-size: 0.72rem;
  line-height: 1.2;
}
.ai-draft-item:hover .ai-draft-archive,
.ai-draft-archive:focus-visible {
  opacity: 1;
}
.ai-draft-archive:hover {
  background: color-mix(in srgb, var(--vs-accent, #007acc) 12%, transparent);
}

/* Card-draft review surface. Layout: header → card list → action bar.
   Cards are a flex row: checkbox | fields | remove. Fields stack
   vertically inside their column. We keep the styles local to
   AiPanel.vue so they don't leak into other components. */
.ai-review {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.ai-review-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ai-border, #3a3f4b);
  font-size: 0.9em;
}
.ai-review-title { font-weight: 600; }
.ai-review-mode {
  margin-left: 4px;
  font-weight: 400;
  color: var(--ai-muted, #8a93a6);
}
.ai-review-count {
  font-size: 0.85em;
  color: var(--ai-muted, #8a93a6);
}
.ai-review-list {
  flex: 1;
  margin: 0;
  padding: 8px;
  list-style: none;
  overflow-y: auto;
}
.ai-review-card {
  display: flex;
  gap: 8px;
  padding: 8px;
  margin-bottom: 8px;
  border: 1px solid var(--ai-border, #3a3f4b);
  border-radius: 6px;
  background: var(--ai-tool-bg, rgba(255, 255, 255, 0.03));
}
.ai-review-card:last-child { margin-bottom: 0; }
.ai-review-check {
  display: flex;
  align-items: flex-start;
  padding-top: 8px;
}
.ai-review-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ai-review-title-input,
.ai-review-slug-input,
.ai-review-tags,
.ai-review-body {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--ai-border, #3a3f4b);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.18);
  color: inherit;
  font-family: inherit;
  font-size: 0.9em;
  box-sizing: border-box;
}
.ai-review-title-input { font-weight: 600; }
.ai-review-slug-input {
  font-family: var(--ai-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.8em;
  color: var(--ai-muted, #8a93a6);
}
.ai-review-body {
  resize: vertical;
  font-size: 0.85em;
  min-height: 60px;
}
.ai-review-tags { font-size: 0.8em; }
.ai-review-remove {
  align-self: flex-start;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--ai-border, #3a3f4b);
  border-radius: 4px;
  background: transparent;
  color: var(--ai-muted, #8a93a6);
  cursor: pointer;
  font-size: 1em;
  line-height: 1;
}
.ai-review-remove:hover { color: var(--ai-error, #c14545); }
.ai-review-actions {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--ai-border, #3a3f4b);
}
.ai-review-add,
.ai-review-cancel,
.ai-review-write {
  padding: 6px 10px;
  border: 1px solid var(--ai-border, #3a3f4b);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.85em;
}
.ai-review-write {
  margin-left: auto;
  background: var(--ai-accent, #7aa2f7);
  color: #0d0f14;
  border-color: var(--ai-accent, #7aa2f7);
}
.ai-review-write:disabled {
  background: var(--ai-muted, #8a93a6);
  border-color: var(--ai-muted, #8a93a6);
  cursor: not-allowed;
  opacity: 0.6;
}
.ai-review-status {
  padding: 8px 12px;
  font-size: 0.85em;
  color: var(--ai-ok, #6ec486);
  border-top: 1px solid var(--ai-border, #3a3f4b);
}
.ai-review-banner {
  padding: 8px 12px;
  background: rgba(122, 162, 247, 0.12);
  color: var(--ai-accent, #7aa2f7);
  font-size: 0.85em;
  border-bottom: 1px solid var(--ai-border, #3a3f4b);
}
.ai-review-banner-error {
  background: rgba(193, 69, 69, 0.12);
  color: var(--ai-error, #c14545);
}
</style>
