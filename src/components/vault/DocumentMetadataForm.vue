<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getPost, updateDocumentMetadata, type DocumentMetadata } from '../../lib/api'
import { suggestSummary } from '../../lib/ai-api'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'
import { ICON_AI } from './icons'

const props = withDefaults(defineProps<{
  path: string | null
  enabled?: boolean
  autofocus?: boolean
  showActions?: boolean
  showCancel?: boolean
}>(), {
  enabled: true,
  autofocus: false,
  showActions: true,
  showCancel: true,
})

const emit = defineEmits<{
  cancel: []
  saved: [metadata: DocumentMetadata]
}>()

const toast = useToast()
const { locale, t } = useI18n()
const titleInput = ref<HTMLInputElement | null>(null)
const loading = ref(false)
const saving = ref(false)
const title = ref('')
const summary = ref('')
const tags = ref('')
const metadata = ref<DocumentMetadata | null>(null)
const generatingSummary = ref(false)
let summaryGenerationId = 0
let summaryGenerationController: AbortController | null = null

const directory = computed(() => {
  if (!props.path) return '—'
  const index = props.path.lastIndexOf('/')
  return index < 0 ? t('metadata.root') : props.path.slice(0, index)
})

function formatDate(value?: number): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(value)
}

function join(values: string[]) {
  return values.join(', ')
}

function split(value: string): string[] {
  const seen = new Set<string>()
  return value.split(/[,\n]/).map((item) => item.trim()).filter((item) => {
    const key = item.toLocaleLowerCase()
    if (!item || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function load() {
  if (!props.path) return
  loading.value = true
  try {
    const post = await getPost(props.path)
    metadata.value = post.metadata ?? null
    title.value = metadata.value?.title ?? String(post.frontmatter.title ?? props.path.split('/').pop() ?? '')
    summary.value = metadata.value?.summary ?? String(post.frontmatter.summary ?? '')
    tags.value = join(metadata.value?.tags ?? (Array.isArray(post.frontmatter.tags) ? post.frontmatter.tags as string[] : []))
    if (props.autofocus) {
      await nextTick()
      titleInput.value?.focus()
      titleInput.value?.select()
    }
  } catch (error) {
    toast.error(t('metadata.load_failed', { error: (error as Error).message }))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!props.path || !title.value.trim() || saving.value || generatingSummary.value) return
  saving.value = true
  try {
    const saved = await updateDocumentMetadata(props.path, {
      title: title.value.trim(),
      summary: summary.value.trim(),
      tags: split(tags.value),
    })
    toast.success(t('metadata.saved'))
    emit('saved', saved)
  } catch (error) {
    toast.error(t('metadata.save_failed', { error: (error as Error).message }))
  } finally {
    saving.value = false
  }
}

async function generateSummary() {
  if (!props.path || loading.value || saving.value || generatingSummary.value) return
  const currentGeneration = ++summaryGenerationId
  const pathSnapshot = props.path
  const summarySnapshot = summary.value
  summaryGenerationController?.abort()
  const controller = new AbortController()
  summaryGenerationController = controller
  generatingSummary.value = true
  try {
    const result = await suggestSummary({
      path: pathSnapshot,
      language: locale.value,
    }, controller.signal)
    if (
      currentGeneration !== summaryGenerationId
      || controller.signal.aborted
      || props.path !== pathSnapshot
      || summary.value !== summarySnapshot
      || loading.value
      || saving.value
    ) return
    const suggestion = result.summary.trim()
    if (!suggestion) {
      toast.error(t('metadata.ai_summary_empty'))
      return
    }
    summary.value = suggestion
  } catch (cause) {
    if (controller.signal.aborted || currentGeneration !== summaryGenerationId) return
    const detail = cause instanceof Error ? cause.message : t('common.unknown_error')
    toast.error(t('metadata.ai_summary_failed', { error: detail }))
  } finally {
    if (currentGeneration === summaryGenerationId) {
      generatingSummary.value = false
      summaryGenerationController = null
    }
  }
}

function cancelSummaryGeneration() {
  summaryGenerationId += 1
  summaryGenerationController?.abort()
  summaryGenerationController = null
  generatingSummary.value = false
}

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void save()
  }
}

watch(() => [props.enabled, props.path] as const, ([enabled]) => {
  cancelSummaryGeneration()
  if (enabled) void load()
}, { immediate: true })

onBeforeUnmount(cancelSummaryGeneration)
</script>

<template>
  <form class="document-metadata-form" @submit.prevent="save" @keydown="onKeydown">
    <div v-if="path" class="document-metadata-body" :aria-busy="loading || generatingSummary">
      <label class="document-metadata-field">
        <span>{{ t('metadata.field_title') }}</span>
        <input ref="titleInput" v-model="title" maxlength="200" :disabled="loading || saving || generatingSummary || !path" required />
      </label>
      <label class="document-metadata-field">
        <span>{{ t('metadata.summary') }}</span>
        <div class="document-metadata-textarea-wrap">
          <textarea v-model="summary" maxlength="2000" rows="4" :disabled="loading || saving || generatingSummary || !path" />
          <button
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
        <input v-model="tags" placeholder="rag, notes" :disabled="loading || saving || generatingSummary || !path" />
      </label>
      <section class="document-metadata-readonly" :aria-label="t('metadata.readonly')">
        <div><span>{{ t('metadata.created_at') }}</span><output>{{ formatDate(metadata?.createdAt) }}</output></div>
        <div><span>{{ t('metadata.updated_at') }}</span><output>{{ formatDate(metadata?.updatedAt) }}</output></div>
        <div><span>{{ t('metadata.document_id') }}</span><output class="is-mono" :title="metadata?.id">{{ metadata?.id ?? '—' }}</output></div>
        <div><span>{{ t('metadata.directory') }}</span><output class="is-mono" :title="directory">{{ directory }}</output></div>
      </section>
    </div>
    <div v-else class="document-metadata-empty">
      {{ t('metadata.no_document') }}
    </div>

    <footer v-if="showActions && path" class="document-metadata-actions">
      <button v-if="showCancel" type="button" class="btn" @click="emit('cancel')">{{ t('metadata.cancel') }}</button>
      <button type="submit" class="btn btn-primary" :disabled="loading || saving || generatingSummary || !path || !title.trim()">
        {{ t(saving ? 'metadata.saving' : 'metadata.save') }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.document-metadata-body { display: grid; gap: 15px; padding: 18px; }
.document-metadata-empty { padding: 24px 18px; color: var(--text-muted); font-size: 0.78rem; font-style: italic; }
.document-metadata-field { position: relative; display: grid; gap: 6px; }
.document-metadata-field > span { color: var(--text-muted); font-size: 0.76rem; font-weight: 600; }
.document-metadata-field input, .document-metadata-field textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 4px; padding: 8px 10px; background: var(--bg-soft); color: var(--text); font: inherit; letter-spacing: 0; outline: none; }
.document-metadata-textarea-wrap { position: relative; min-width: 0; }
.document-metadata-textarea-wrap textarea { padding-right: 82px; padding-bottom: 29px; }
.document-metadata-field textarea { resize: vertical; min-height: 92px; line-height: 1.5; }
.document-metadata-field input:focus, .document-metadata-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.document-metadata-field small { position: absolute; right: 8px; bottom: 7px; color: var(--text-muted); font-size: 0.68rem; pointer-events: none; }
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
