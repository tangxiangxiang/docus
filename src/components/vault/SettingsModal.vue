<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearAiApiKey, getAiSettings, saveAiSettings, type AiSettings } from '../../lib/ai-api'
import { useToast } from '../../composables/useToast'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useFocusTrap } from '../../composables/useFocusTrap'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'
import { useEditorPreferences } from '../../composables/vault/useEditorPreferences'
import { useFileTreePreferences } from '../../composables/vault/useFileTreePreferences'
import { getFallbackVaultFileChanges } from '../../composables/vault/context/fileChanges'
import { useOptionalVaultContext } from '../../composables/vault/context/useVaultContext'
import {
  cleanDocumentFrontmatter,
  getFrontmatterCleanupPreview,
  getMetadataMigrationStatus,
  restoreDocumentFrontmatter,
  type FrontmatterCleanupPreview,
  type MetadataMigrationSummary,
} from '../../lib/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const toast = useToast()
const aiHistory = useAiHistory()
const trap = useFocusTrap()
const { confirm } = useConfirm()
const { t } = useI18n()
const editorPreferences = useEditorPreferences()
const fileTreePreferences = useFileTreePreferences()
const loading = ref(false)
const saving = ref(false)
const settings = ref<AiSettings | null>(null)
const apiKey = ref('')
const baseURL = ref('')
const model = ref('claude-sonnet-4-6')
const modalRef = ref<HTMLElement | null>(null)
const vaultContext = useOptionalVaultContext()
const migrationSummary = ref<MetadataMigrationSummary | null>(null)
const cleanupPreview = ref<FrontmatterCleanupPreview | null>(null)
const previewing = ref(false)
const mutatingMetadata = ref(false)
const cleanedPaths = ref<string[]>([])

const sourceLabel = computed(() => {
  if (!settings.value) return t('settings.source_unknown')
  if (settings.value.source === 'env') return t('settings.source_environment')
  if (settings.value.source === 'db') return t('settings.source_saved')
  return t('settings.source_none')
})

async function load() {
  loading.value = true
  try {
    const [next, migration] = await Promise.all([
      getAiSettings(),
      getMetadataMigrationStatus().catch(() => null),
    ])
    settings.value = next
    apiKey.value = ''
    baseURL.value = next.baseURL
    model.value = next.model || 'claude-sonnet-4-6'
    migrationSummary.value = migration?.summary ?? null
    cleanedPaths.value = migration?.cleanedPaths ?? []
  } catch (e: any) {
    toast.error(t('settings.load_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    loading.value = false
  }
}

async function reloadMetadataStatus() {
  const migration = await getMetadataMigrationStatus()
  migrationSummary.value = migration.summary
  cleanedPaths.value = migration.cleanedPaths
  cleanupPreview.value = await getFrontmatterCleanupPreview()
}

function publishChanges(result: { changed: Array<{ path: string; newRaw: string; newMtime: number }> }) {
  const publishChange = vaultContext?.fileChanges.publish ?? getFallbackVaultFileChanges().publish
  for (const change of result.changed) publishChange({ ...change, kind: 'write' })
}

async function removeFrontmatter() {
  const paths = cleanupPreview.value?.candidates.map((item) => item.path) ?? []
  if (!paths.length) return
  const ok = await confirm(
    t('settings.remove_confirm', { count: paths.length }),
    t('settings.remove_detail'),
  )
  if (!ok) return
  mutatingMetadata.value = true
  try {
    const result = await cleanDocumentFrontmatter(paths)
    publishChanges(result)
    await reloadMetadataStatus()
    if (result.failed.length) toast.error(t('settings.operation_failed_count', { count: result.failed.length }))
    if (result.changed.length) toast.success(t('settings.cleaned_count', { count: result.changed.length }))
  } catch (e: any) {
    toast.error(t('settings.remove_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    mutatingMetadata.value = false
  }
}

async function restoreOriginalFrontmatter() {
  if (!cleanedPaths.value.length) return
  const paths = [...cleanedPaths.value]
  const ok = await confirm(
    t('settings.restore_confirm', { count: paths.length }),
    t('settings.restore_detail'),
  )
  if (!ok) return
  mutatingMetadata.value = true
  try {
    const result = await restoreDocumentFrontmatter(paths, 'original')
    publishChanges(result)
    await reloadMetadataStatus()
    if (result.failed.length) toast.error(t('settings.operation_failed_count', { count: result.failed.length }))
    if (result.changed.length) toast.success(t('settings.restored_count', { count: result.changed.length }))
  } catch (e: any) {
    toast.error(t('settings.restore_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    mutatingMetadata.value = false
  }
}

async function previewCleanup() {
  previewing.value = true
  try {
    cleanupPreview.value = await getFrontmatterCleanupPreview()
  } catch (e: any) {
    toast.error(t('settings.cleanup_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    previewing.value = false
  }
}

async function onSave() {
  saving.value = true
  try {
    const next = await saveAiSettings({
      ...(apiKey.value.trim() ? { apiKey: apiKey.value } : {}),
      baseURL: baseURL.value,
      model: model.value,
    })
    settings.value = next
    apiKey.value = ''
    await aiHistory.loadActive()
    toast.success(t('settings.saved'))
  } catch (e: any) {
    toast.error(t('settings.save_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    saving.value = false
  }
}

async function onClearKey() {
  saving.value = true
  try {
    settings.value = await clearAiApiKey()
    apiKey.value = ''
    await aiHistory.loadActive()
    toast.success(t('settings.key_cleared'))
  } catch (e: any) {
    toast.error(t('settings.clear_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    saving.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) {
    trap.activate()
    void load()
    void nextTick(() => {
      const first = modalRef.value?.querySelector<HTMLInputElement>('input:not([disabled])')
      first?.focus()
    })
  } else {
    void trap.deactivate()
  }
})

onMounted(() => {
  if (props.open) {
    trap.activate()
    void load()
  }
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'Tab') {
    trap.onTab(() => modalRef.value, e)
  }
}

onBeforeUnmount(() => {
  void trap.deactivate()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="settings-backdrop"
      role="presentation"
      @click.self="emit('close')"
      @keydown="onKeydown"
      tabindex="-1"
    >
      <section
        ref="modalRef"
        class="settings-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="t('settings.title')"
      >
        <header class="settings-header">
          <h2>{{ t('settings.title') }}</h2>
          <button type="button" class="settings-icon-btn" :title="t('settings.close')" :aria-label="t('settings.close')" @click="emit('close')">×</button>
        </header>

        <div class="settings-body">
          <div class="settings-row settings-status">
            <span>{{ t('settings.ai') }}</span>
            <strong>{{ sourceLabel }}</strong>
            <code v-if="settings?.maskedKey">{{ settings.maskedKey }}</code>
          </div>

          <label class="settings-field">
            <span>{{ t('settings.provider') }}</span>
            <input value="Anthropic" disabled />
          </label>

          <label class="settings-field">
            <span>{{ t('settings.api_key') }}</span>
            <input
              v-model="apiKey"
              type="password"
              autocomplete="off"
              :placeholder="settings?.maskedKey ? t('settings.saved_key', { key: settings.maskedKey }) : 'sk-ant-...'"
              :disabled="loading || saving || settings?.envOverride"
            />
          </label>

          <label class="settings-field">
            <span>{{ t('settings.base_url') }}</span>
            <input
              v-model="baseURL"
              type="url"
              :placeholder="t('settings.optional')"
              :disabled="loading || saving || settings?.envOverride"
            />
          </label>

          <label class="settings-field">
            <span>{{ t('settings.model') }}</span>
            <input
              v-model="model"
              type="text"
              placeholder="claude-sonnet-4-6"
              :disabled="loading || saving || settings?.envOverride"
            />
          </label>

          <p v-if="settings?.envOverride" class="settings-note">
            {{ t('settings.env_override') }}
          </p>

          <section class="settings-metadata" aria-labelledby="settings-editor-title">
            <div class="settings-section-heading">
              <div><h3 id="settings-editor-title">{{ t('settings.editor') }}</h3><p>{{ t('settings.editor_subtitle') }}</p></div>
            </div>
            <div class="settings-editor-grid">
              <label class="settings-field"><span>{{ t('settings.font_size') }}</span><input v-model.number="editorPreferences.fontSize.value" type="number" min="11" max="24" /></label>
              <label class="settings-field"><span>{{ t('settings.line_height') }}</span><input v-model.number="editorPreferences.lineHeight.value" type="number" min="16" max="40" /></label>
              <label class="settings-field"><span>{{ t('settings.tab_width') }}</span><select v-model.number="editorPreferences.tabSize.value"><option :value="2">{{ t('settings.spaces', { count: 2 }) }}</option><option :value="4">{{ t('settings.spaces', { count: 4 }) }}</option></select></label>
              <label class="settings-field"><span>{{ t('settings.wrap_column') }}</span><input v-model.number="editorPreferences.wrapColumn.value" type="number" min="60" max="160" /></label>
              <label class="settings-field"><span>{{ t('settings.font_family') }}</span><input v-model="editorPreferences.fontFamily.value" type="text" :placeholder="t('settings.system_monospace')" maxlength="120" /></label>
              <label class="settings-field"><span>{{ t('settings.writing_diagnostics') }}</span><input v-model="editorPreferences.typography.value" type="checkbox" /></label>
              <label class="settings-field"><span>{{ t('settings.compact_tree') }}</span><input v-model="fileTreePreferences.compactFileTree.value" type="checkbox" /></label>
              <button type="button" class="btn" @click="editorPreferences.reset">{{ t('settings.reset_editor') }}</button>
            </div>
          </section>

          <section class="settings-metadata" aria-labelledby="settings-metadata-title">
            <div class="settings-section-heading">
              <div>
                <h3 id="settings-metadata-title">{{ t('settings.metadata') }}</h3>
                <p>{{ t('settings.metadata_subtitle') }}</p>
              </div>
              <button type="button" class="btn" :disabled="previewing" @click="previewCleanup">
                {{ t(previewing ? 'settings.checking' : 'settings.check_cleanup') }}
              </button>
            </div>
            <div v-if="migrationSummary" class="settings-metadata-stats">
              <span><strong>{{ migrationSummary.verified }}</strong> {{ t('settings.verified') }}</span>
              <span><strong>{{ migrationSummary.cleaned }}</strong> {{ t('settings.cleaned') }}</span>
              <span :class="{ danger: migrationSummary.failed > 0 }"><strong>{{ migrationSummary.failed }}</strong> {{ t('settings.failed') }}</span>
            </div>
            <div v-if="cleanupPreview" class="settings-cleanup-result" aria-live="polite">
              <span><strong>{{ cleanupPreview.candidates.length }}</strong> {{ t('settings.ready') }}</span>
              <span><strong>{{ cleanupPreview.blocked.length }}</strong> {{ t('settings.blocked') }}</span>
              <span><strong>{{ cleanupPreview.candidates.filter(item => item.customFields.length).length }}</strong> {{ t('settings.custom_fields') }}</span>
            </div>
            <div v-if="cleanupPreview" class="settings-metadata-actions">
              <button
                v-if="cleanedPaths.length"
                type="button"
                class="btn"
                :disabled="mutatingMetadata"
                @click="restoreOriginalFrontmatter"
              >{{ t('settings.restore_original', { count: cleanedPaths.length }) }}</button>
              <button
                v-if="cleanupPreview.candidates.length"
                type="button"
                class="btn btn-danger"
                :disabled="mutatingMetadata || cleanupPreview.blocked.length > 0"
                @click="removeFrontmatter"
              >{{ t('settings.remove_frontmatter', { count: cleanupPreview.candidates.length }) }}</button>
            </div>
          </section>
        </div>

        <footer class="settings-actions">
          <button
            type="button"
            class="btn"
            :disabled="saving || settings?.envOverride"
            @click="onClearKey"
          >{{ t('settings.clear_key') }}</button>
          <button type="button" class="btn" @click="emit('close')">{{ t('settings.cancel') }}</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="loading || saving || settings?.envOverride"
            @click="onSave"
          >{{ t(saving ? 'settings.saving' : 'settings.save') }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
