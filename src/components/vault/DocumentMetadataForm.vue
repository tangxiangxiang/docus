<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getPost, updateDocumentMetadata, type DocumentMetadata, type PostDetail } from '../../lib/api'
import { suggestSummary } from '../../lib/ai-api'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'
import { ICON_AI } from './icons'
import type { MetadataBase, MetadataContext } from './metadataDraftStore'
import { draftsByDocumentId } from './metadataDraftStore'

const props = withDefaults(defineProps<{
  path: string | null
  enabled?: boolean
  autofocus?: boolean
  showActions?: boolean
  showCancel?: boolean
  readonly?: boolean
  context?: MetadataContext
  summarySource?: string | null
}>(), {
  enabled: true,
  autofocus: false,
  showActions: true,
  showCancel: true,
  readonly: false,
  context: 'document',
  summarySource: null,
})

const emit = defineEmits<{
  cancel: []
  saved: [metadata: DocumentMetadata]
  'dirty-change': [dirty: boolean]
}>()

const toast = useToast()
const { locale, t } = useI18n()
const titleInput = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const saving = ref(false)
const loadError = ref<string | null>(null)
const title = ref('')
const summary = ref('')
const tags = ref('')
const metadata = ref<DocumentMetadata | null>(null)
const loadedBase = ref<MetadataBase | null>(null)
const loadedIdentity = ref<{ path: string; documentId: string | null } | null>(null)
const draftRevision = ref(0)
const generatingSummary = ref(false)
const isReadonly = computed(() => props.readonly || props.context !== 'document')
let summaryGenerationId = 0
let summaryGenerationController: AbortController | null = null
let loadSequence = 0
let applyingFields = false

const directory = computed(() => {
  if (!props.path) return '—'
  const index = props.path.lastIndexOf('/')
  return index < 0 ? t('metadata.root') : props.path.slice(0, index)
})

const dirty = computed(() => {
  const base = loadedBase.value
  const identity = loadedIdentity.value
  if (isReadonly.value || !base || !identity || !props.path || identity.path !== props.path) return false
  return normalizeTitle(title.value) !== base.title
    || normalizeSummary(summary.value) !== base.summary
    || JSON.stringify(split(tags.value)) !== JSON.stringify(base.tags)
})

function formatDate(value?: number): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(value)
}

function normalizeTitle(value: string): string { return value.trim() }
function normalizeSummary(value: string): string { return value.trim() }

function join(values: string[]): string { return values.join(', ') }

function split(value: string): string[] {
  const seen = new Set<string>()
  return value.split(/[,\n]/).map((item) => item.trim()).filter((item) => {
    const key = item.toLocaleLowerCase()
    if (!item || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function fieldsFromPost(post: PostDetail, path: string): { metadata: DocumentMetadata | null; base: MetadataBase } {
  const serverMetadata = post.metadata ?? null
  const fallbackTitle = String(post.frontmatter.title ?? path.split('/').pop() ?? '')
  const fallbackSummary = String(post.frontmatter.summary ?? '')
  const fallbackTags = Array.isArray(post.frontmatter.tags) ? post.frontmatter.tags as string[] : []
  return {
    metadata: serverMetadata,
    base: {
      title: normalizeTitle(serverMetadata?.title ?? fallbackTitle),
      summary: normalizeSummary(serverMetadata?.summary ?? fallbackSummary),
      tags: split(join(serverMetadata?.tags ?? fallbackTags)),
      updatedAt: serverMetadata?.updatedAt ?? post.mtime ?? 0,
    },
  }
}

function setFields(next: { title: string; summary: string; tags: string[] }): void {
  applyingFields = true
  title.value = next.title
  summary.value = next.summary
  tags.value = join(next.tags)
  applyingFields = false
}

function applyLoadedPost(path: string, post: PostDetail): void {
  const loaded = fieldsFromPost(post, path)
  metadata.value = loaded.metadata
  loadedBase.value = loaded.base
  loadedIdentity.value = { path, documentId: loaded.metadata?.id ?? null }
  const draft = loaded.metadata?.id ? draftsByDocumentId.get(loaded.metadata.id) : undefined
  if (!isReadonly.value && draft?.dirty) {
    draft.path = path
    draftsByDocumentId.set(draft.documentId, draft)
    setFields({ title: draft.title, summary: draft.summary, tags: split(draft.tagsText) })
  } else {
    setFields(loaded.base)
  }
  draftRevision.value = draft?.revision ?? 0
}

function clearVisibleFields(): void {
  metadata.value = null
  loadedBase.value = null
  loadedIdentity.value = null
  setFields({ title: '', summary: '', tags: [] })
  draftRevision.value = 0
}

function clearCurrentView(): void {
  loadSequence++
  loading.value = false
  loadError.value = null
  clearVisibleFields()
}

async function load(): Promise<void> {
  const requestedPath = props.path
  if (!requestedPath) {
    clearCurrentView()
    return
  }

  const sequence = ++loadSequence
  loading.value = true
  loadError.value = null
  clearVisibleFields()

  try {
    const post = await getPost(requestedPath)
    if (sequence !== loadSequence || props.path !== requestedPath) return
    applyLoadedPost(requestedPath, post)
    if (props.autofocus) {
      await nextTick()
      if (sequence === loadSequence && props.path === requestedPath) {
        titleInput.value?.focus()
        titleInput.value?.select()
      }
    }
  } catch (cause) {
    if (sequence !== loadSequence || props.path !== requestedPath) return
    loadError.value = normalizeError(cause)
    clearVisibleFields()
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function syncDraft(): void {
  const identity = loadedIdentity.value
  const base = loadedBase.value
  if (applyingFields || loading.value || isReadonly.value || !identity?.documentId || !base || identity.path !== props.path) return
  const nextRevision = draftRevision.value + 1
  draftRevision.value = nextRevision
  if (!dirty.value) {
    draftsByDocumentId.delete(identity.documentId)
    return
  }
  draftsByDocumentId.set(identity.documentId, {
    documentId: identity.documentId,
    path: identity.path,
    title: title.value,
    summary: summary.value,
    tagsText: tags.value,
    base,
    dirty: true,
    revision: nextRevision,
  })
}

function snapshotCurrentFields() {
  return {
    title: normalizeTitle(title.value),
    summary: normalizeSummary(summary.value),
    tags: split(tags.value),
  }
}

async function save(): Promise<void> {
  const identity = loadedIdentity.value
  if (
    !props.path || !identity?.documentId || identity.path !== props.path
    || !dirty.value || !title.value.trim() || saving.value || generatingSummary.value || isReadonly.value
  ) return
  const savingPath = identity.path
  const savingDocumentId = identity.documentId
  const savingRevision = draftRevision.value
  const payload = snapshotCurrentFields()
  saving.value = true
  try {
    const saved = await updateDocumentMetadata(savingPath, payload)
    const savedMatchesRequest = saved.id === savingDocumentId && saved.path === savingPath
    const currentDraft = draftsByDocumentId.get(savingDocumentId)
    if (savedMatchesRequest && currentDraft?.revision === savingRevision) {
      const savedBase: MetadataBase = {
        title: normalizeTitle(saved.title),
        summary: normalizeSummary(saved.summary),
        tags: split(join(saved.tags)),
        updatedAt: saved.updatedAt,
      }
      draftsByDocumentId.delete(savingDocumentId)
      if (loadedIdentity.value?.documentId === savingDocumentId && props.path === savingPath) {
        metadata.value = saved
        loadedBase.value = savedBase
        setFields(savedBase)
        draftRevision.value = savingRevision
        emit('saved', saved)
      }
    }
    if (savedMatchesRequest) toast.success(t('metadata.saved'))
  } catch (cause) {
    toast.error(t('metadata.save_failed', { error: normalizeError(cause) }))
  } finally {
    saving.value = false
  }
}

async function generateSummary(): Promise<void> {
  const identity = loadedIdentity.value
  if (
    !props.path || !identity?.documentId || loading.value || saving.value
    || generatingSummary.value || isReadonly.value || !loadedBase.value
  ) return
  const currentGeneration = ++summaryGenerationId
  const pathSnapshot = props.path
  const documentIdSnapshot = identity.documentId
  const contentSnapshot = props.summarySource
  const summaryFieldSnapshot = summary.value
  summaryGenerationController?.abort()
  const controller = new AbortController()
  summaryGenerationController = controller
  generatingSummary.value = true
  try {
    const request: { path: string; language: 'zh' | 'en'; content?: string } = {
      path: pathSnapshot,
      language: locale.value,
    }
    if (contentSnapshot !== null) request.content = contentSnapshot
    const result = await suggestSummary(request, controller.signal)
    if (
      currentGeneration !== summaryGenerationId || controller.signal.aborted
      || props.path !== pathSnapshot || loadedIdentity.value?.documentId !== documentIdSnapshot
      || summary.value !== summaryFieldSnapshot || loading.value || saving.value || isReadonly.value
    ) return
    const suggestion = result.summary.trim()
    if (!suggestion) {
      toast.error(t('metadata.ai_summary_empty'))
      return
    }
    summary.value = suggestion
  } catch (cause) {
    if (controller.signal.aborted || currentGeneration !== summaryGenerationId) return
    toast.error(t('metadata.ai_summary_failed', { error: normalizeError(cause) }))
  } finally {
    if (currentGeneration === summaryGenerationId) {
      generatingSummary.value = false
      summaryGenerationController = null
    }
  }
}

function reset(): void {
  const identity = loadedIdentity.value
  const base = loadedBase.value
  if (isReadonly.value || !identity?.documentId || !base) return
  draftsByDocumentId.delete(identity.documentId)
  setFields(base)
  draftRevision.value++
}

function cancelSummaryGeneration(): void {
  summaryGenerationId++
  summaryGenerationController?.abort()
  summaryGenerationController = null
  generatingSummary.value = false
}

function retry(): void { void load() }

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    if (isReadonly.value) return
    event.preventDefault()
    void save()
  }
}

watch([title, summary, tags], syncDraft, { flush: 'sync' })
watch(dirty, (value) => emit('dirty-change', value), { immediate: true })
watch(
  () => [props.enabled, props.path] as const,
  ([enabled]) => {
    cancelSummaryGeneration()
    if (!enabled) return
    if (props.path && loadedIdentity.value?.path === props.path && !loadError.value) return
    void load()
  },
  { immediate: true },
)
watch(() => [props.context, props.readonly] as const, () => {
  if (props.enabled) void load()
})

onBeforeUnmount(cancelSummaryGeneration)
</script>

<template>
  <form class="document-metadata-form" @submit.prevent="save" @keydown="onKeydown">
    <div v-if="path" class="document-metadata-body" :aria-busy="loading || generatingSummary">
      <div v-if="loading" class="document-metadata-status" role="status">{{ t('metadata.loading') }}</div>
      <div v-else-if="loadError" class="document-metadata-error" role="alert">
        <span>{{ t('metadata.load_failed', { error: loadError }) }}</span>
        <button type="button" class="btn" @click="retry">{{ t('metadata.retry') }}</button>
      </div>
      <template v-else>
        <p v-if="isReadonly" class="document-metadata-readonly-hint">
          {{ t(`metadata.readonly_${context}`) }}
        </p>
        <label class="document-metadata-field">
          <span>{{ t('metadata.field_title') }}</span>
          <input ref="titleInput" v-model="title" maxlength="200" :disabled="loading || saving || isReadonly || !path" required />
        </label>
        <label class="document-metadata-field">
          <span>{{ t('metadata.summary') }}</span>
          <div class="document-metadata-textarea-wrap">
            <textarea v-model="summary" maxlength="2000" rows="4" :disabled="loading || saving || isReadonly || !path" />
            <button
              v-if="!isReadonly"
              type="button"
              class="metadata-generate-summary"
              :disabled="loading || saving || generatingSummary || !path"
              :aria-label="t(generatingSummary ? 'metadata.ai_generating_summary' : 'metadata.ai_generate_summary')"
              :title="t(generatingSummary ? 'metadata.ai_generating_summary' : 'metadata.ai_generate_summary')"
              @click="generateSummary"
            >
              <span v-html="ICON_AI" aria-hidden="true" />
              <span>{{ t(generatingSummary ? 'metadata.ai_generating_summary' : 'metadata.ai_generate_summary') }}</span>
            </button>
            <small>{{ summary.length }} / 2000</small>
          </div>
        </label>
        <label class="document-metadata-field">
          <span>{{ t('metadata.tags') }}</span>
          <input v-model="tags" placeholder="rag, notes" :disabled="loading || saving || isReadonly || !path" />
        </label>
        <section class="document-metadata-readonly" :aria-label="t('metadata.readonly')">
          <div><span>{{ t('metadata.created_at') }}</span><output>{{ formatDate(metadata?.createdAt) }}</output></div>
          <div><span>{{ t('metadata.updated_at') }}</span><output>{{ formatDate(metadata?.updatedAt) }}</output></div>
          <div><span>{{ t('metadata.document_id') }}</span><output class="is-mono" :title="metadata?.id">{{ metadata?.id ?? '—' }}</output></div>
          <div><span>{{ t('metadata.directory') }}</span><output class="is-mono" :title="directory">{{ directory }}</output></div>
        </section>
      </template>
    </div>
    <div v-else class="document-metadata-empty">{{ t('metadata.no_document') }}</div>

    <footer v-if="showActions && path && !isReadonly && !loadError" class="document-metadata-actions">
      <button v-if="showCancel" type="button" class="btn" @click="emit('cancel')">{{ t('metadata.cancel') }}</button>
      <button type="button" class="btn" :disabled="loading || saving || generatingSummary || !dirty" @click="reset">{{ t('metadata.reset') }}</button>
      <button type="submit" class="btn btn-primary" :disabled="loading || saving || generatingSummary || !dirty || !title.trim()">
        {{ t(saving ? 'metadata.saving' : 'metadata.save') }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.document-metadata-body { display: grid; gap: 15px; padding: 18px; }
.document-metadata-empty { padding: 24px 18px; color: var(--text-muted); font-size: 0.78rem; font-style: italic; }
.document-metadata-status { color: var(--text-muted); font-size: 0.78rem; }
.document-metadata-error { display: grid; gap: 9px; color: var(--danger, #d14); font-size: 0.78rem; }
.document-metadata-error .btn { justify-self: start; }
.document-metadata-readonly-hint { margin: 0; color: var(--text-muted); font-size: 0.76rem; line-height: 1.5; }
.document-metadata-field { position: relative; display: grid; gap: 6px; }
.document-metadata-field > span { color: var(--text-muted); font-size: 0.76rem; font-weight: 600; }
.document-metadata-field input, .document-metadata-field textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px; background: var(--bg-soft); color: var(--text); font: inherit; letter-spacing: 0; outline: none; }
.document-metadata-textarea-wrap { position: relative; min-width: 0; }
.document-metadata-textarea-wrap textarea { padding-right: 82px; padding-bottom: 29px; }
.document-metadata-field textarea { resize: vertical; min-height: 92px; line-height: 1.5; }
.document-metadata-field input:focus, .document-metadata-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.metadata-generate-summary { position: absolute; top: 5px; right: 5px; display: inline-flex; align-items: center; gap: 3px; min-height: 24px; max-width: calc(100% - 10px); padding: 0 5px; border: 0; border-radius: 4px; background: color-mix(in srgb, var(--bg) 72%, transparent); color: var(--text-muted); font: inherit; font-size: 0.66rem; cursor: pointer; }
.metadata-generate-summary > span:first-child { display: inline-flex; flex: 0 0 14px; }
.metadata-generate-summary > span:first-child :deep(svg) { display: block; width: 14px; height: 14px; }
.metadata-generate-summary:hover:not(:disabled) { background: var(--code-bg); color: var(--accent); }
.metadata-generate-summary:focus-visible { outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent); outline-offset: 1px; }
.metadata-generate-summary:disabled { cursor: default; opacity: 0.5; }
.document-metadata-readonly { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 3px; border-top: 1px solid var(--border); }
.document-metadata-readonly > div { min-width: 0; display: grid; gap: 4px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.document-metadata-readonly > div:nth-child(odd) { padding-right: 16px; }
.document-metadata-readonly > div:nth-child(even) { padding-left: 16px; border-left: 1px solid var(--border); }
.document-metadata-readonly span { color: var(--text-muted); font-size: 0.7rem; }
.document-metadata-readonly output { min-width: 0; overflow: hidden; color: var(--text); font-size: 0.78rem; text-overflow: ellipsis; white-space: nowrap; }
.document-metadata-readonly output.is-mono { font-family: var(--mono); font-size: 0.72rem; }
.document-metadata-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border); background: var(--bg-soft); }
</style>
