<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { getPost, updateDocumentMetadata, type DocumentMetadata } from '../../lib/api'
import { useToast } from '../../composables/useToast'
import { useI18n } from '../../composables/useI18n'

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
  if (!props.path || !title.value.trim() || saving.value) return
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

function onKeydown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void save()
  }
}

watch(() => [props.enabled, props.path] as const, ([enabled]) => {
  if (enabled) void load()
}, { immediate: true })
</script>

<template>
  <form class="document-metadata-form" @submit.prevent="save" @keydown="onKeydown">
    <div v-if="path" class="document-metadata-body" :aria-busy="loading">
      <label class="document-metadata-field">
        <span>{{ t('metadata.field_title') }}</span>
        <input ref="titleInput" v-model="title" maxlength="200" :disabled="loading || saving || !path" required />
      </label>
      <label class="document-metadata-field">
        <span>{{ t('metadata.summary') }}</span>
        <textarea v-model="summary" maxlength="2000" rows="4" :disabled="loading || saving || !path" />
        <small>{{ summary.length }} / 2000</small>
      </label>
      <label class="document-metadata-field">
        <span>{{ t('metadata.tags') }}</span>
        <input v-model="tags" placeholder="rag, notes" :disabled="loading || saving || !path" />
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
      <button type="submit" class="btn btn-primary" :disabled="loading || saving || !path || !title.trim()">
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
.document-metadata-field textarea { resize: vertical; min-height: 92px; line-height: 1.5; }
.document-metadata-field input:focus, .document-metadata-field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.document-metadata-field small { position: absolute; right: 8px; bottom: 7px; color: var(--text-muted); font-size: 0.68rem; pointer-events: none; }
.document-metadata-readonly { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 3px; border-top: 1px solid var(--border); }
.document-metadata-readonly > div { min-width: 0; display: grid; gap: 4px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.document-metadata-readonly > div:nth-child(odd) { padding-right: 16px; }
.document-metadata-readonly > div:nth-child(even) { padding-left: 16px; border-left: 1px solid var(--border); }
.document-metadata-readonly span { color: var(--text-muted); font-size: 0.7rem; }
.document-metadata-readonly output { min-width: 0; overflow: hidden; color: var(--text); font-size: 0.78rem; text-overflow: ellipsis; white-space: nowrap; }
.document-metadata-readonly output.is-mono { font-family: var(--mono); font-size: 0.72rem; }
.document-metadata-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border); background: var(--bg-soft); }
</style>
