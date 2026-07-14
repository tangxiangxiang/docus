<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearAiApiKey, getAiSettings, saveAiSettings, type AiSettings } from '../../lib/ai-api'
import { useToast } from '../../composables/useToast'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useFocusTrap } from '../../composables/useFocusTrap'
import { useConfirm } from '../../composables/useConfirm'
import { useEditorPreferences } from '../../composables/vault/useEditorPreferences'
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
const editorPreferences = useEditorPreferences()
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
  if (!settings.value) return 'Unknown'
  if (settings.value.source === 'env') return 'Environment'
  if (settings.value.source === 'db') return 'Saved'
  return 'Not configured'
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
    toast.error('加载设置失败: ' + (e.message ?? '未知错误'))
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
    `从 ${paths.length} 篇文档中移除 Frontmatter?`,
    '原始内容已备份到 SQLite，可在此处恢复。打开且有未保存修改的文档会再次询问是否刷新。',
  )
  if (!ok) return
  mutatingMetadata.value = true
  try {
    const result = await cleanDocumentFrontmatter(paths)
    publishChanges(result)
    await reloadMetadataStatus()
    if (result.failed.length) toast.error(`${result.failed.length} 篇清理失败`)
    if (result.changed.length) toast.success(`已清理 ${result.changed.length} 篇文档`)
  } catch (e: any) {
    toast.error('清理 Frontmatter 失败: ' + (e.message ?? '未知错误'))
  } finally {
    mutatingMetadata.value = false
  }
}

async function restoreOriginalFrontmatter() {
  if (!cleanedPaths.value.length) return
  const paths = [...cleanedPaths.value]
  const ok = await confirm(
    `恢复 ${paths.length} 篇文档的原始 Frontmatter?`,
    '将使用清理前逐字节保存的备份；正文哈希不一致的文档会被跳过。',
  )
  if (!ok) return
  mutatingMetadata.value = true
  try {
    const result = await restoreDocumentFrontmatter(paths, 'original')
    publishChanges(result)
    await reloadMetadataStatus()
    if (result.failed.length) toast.error(`${result.failed.length} 篇恢复失败`)
    if (result.changed.length) toast.success(`已恢复 ${result.changed.length} 篇文档`)
  } catch (e: any) {
    toast.error('恢复 Frontmatter 失败: ' + (e.message ?? '未知错误'))
  } finally {
    mutatingMetadata.value = false
  }
}

async function previewCleanup() {
  previewing.value = true
  try {
    cleanupPreview.value = await getFrontmatterCleanupPreview()
  } catch (e: any) {
    toast.error('检查 Frontmatter 失败: ' + (e.message ?? '未知错误'))
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
    toast.success('AI 设置已保存')
  } catch (e: any) {
    toast.error('保存失败: ' + (e.message ?? '未知错误'))
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
    toast.success('已清除保存的 API Key')
  } catch (e: any) {
    toast.error('清除失败: ' + (e.message ?? '未知错误'))
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
        aria-label="Settings"
      >
        <header class="settings-header">
          <h2>Settings</h2>
          <button type="button" class="settings-icon-btn" title="Close" @click="emit('close')">×</button>
        </header>

        <div class="settings-body">
          <div class="settings-row settings-status">
            <span>AI</span>
            <strong>{{ sourceLabel }}</strong>
            <code v-if="settings?.maskedKey">{{ settings.maskedKey }}</code>
          </div>

          <label class="settings-field">
            <span>Provider</span>
            <input value="Anthropic" disabled />
          </label>

          <label class="settings-field">
            <span>API Key</span>
            <input
              v-model="apiKey"
              type="password"
              autocomplete="off"
              :placeholder="settings?.maskedKey ? `Saved: ${settings.maskedKey}` : 'sk-ant-...'"
              :disabled="loading || saving || settings?.envOverride"
            />
          </label>

          <label class="settings-field">
            <span>Base URL</span>
            <input
              v-model="baseURL"
              type="url"
              placeholder="Optional"
              :disabled="loading || saving || settings?.envOverride"
            />
          </label>

          <label class="settings-field">
            <span>Model</span>
            <input
              v-model="model"
              type="text"
              placeholder="claude-sonnet-4-6"
              :disabled="loading || saving || settings?.envOverride"
            />
          </label>

          <p v-if="settings?.envOverride" class="settings-note">
            当前由环境变量配置。保存到数据库的设置会保留，但不会覆盖环境变量。
          </p>

          <section class="settings-metadata" aria-labelledby="settings-editor-title">
            <div class="settings-section-heading">
              <div><h3 id="settings-editor-title">Editor</h3><p>Device-local Monaco preferences</p></div>
            </div>
            <div class="settings-editor-grid">
              <label class="settings-field"><span>Font size</span><input v-model.number="editorPreferences.fontSize.value" type="number" min="11" max="24" /></label>
              <label class="settings-field"><span>Line height</span><input v-model.number="editorPreferences.lineHeight.value" type="number" min="16" max="40" /></label>
              <label class="settings-field"><span>Tab width</span><select v-model.number="editorPreferences.tabSize.value"><option :value="2">2 spaces</option><option :value="4">4 spaces</option></select></label>
              <label class="settings-field"><span>Wrap column</span><input v-model.number="editorPreferences.wrapColumn.value" type="number" min="60" max="160" /></label>
              <label class="settings-field"><span>Font family</span><input v-model="editorPreferences.fontFamily.value" type="text" placeholder="System monospace" maxlength="120" /></label>
              <label class="settings-field"><span>Writing diagnostics</span><input v-model="editorPreferences.typography.value" type="checkbox" /></label>
              <button type="button" class="btn" @click="editorPreferences.reset">Reset editor defaults</button>
            </div>
          </section>

          <section class="settings-metadata" aria-labelledby="settings-metadata-title">
            <div class="settings-section-heading">
              <div>
                <h3 id="settings-metadata-title">Document metadata</h3>
                <p>SQLite migration and Frontmatter safety check</p>
              </div>
              <button type="button" class="btn" :disabled="previewing" @click="previewCleanup">
                {{ previewing ? 'Checking...' : 'Check cleanup' }}
              </button>
            </div>
            <div v-if="migrationSummary" class="settings-metadata-stats">
              <span><strong>{{ migrationSummary.verified }}</strong> verified</span>
              <span><strong>{{ migrationSummary.cleaned }}</strong> cleaned</span>
              <span :class="{ danger: migrationSummary.failed > 0 }"><strong>{{ migrationSummary.failed }}</strong> failed</span>
            </div>
            <div v-if="cleanupPreview" class="settings-cleanup-result" aria-live="polite">
              <span><strong>{{ cleanupPreview.candidates.length }}</strong> ready</span>
              <span><strong>{{ cleanupPreview.blocked.length }}</strong> blocked</span>
              <span><strong>{{ cleanupPreview.candidates.filter(item => item.customFields.length).length }}</strong> with custom fields</span>
            </div>
            <div v-if="cleanupPreview" class="settings-metadata-actions">
              <button
                v-if="cleanedPaths.length"
                type="button"
                class="btn"
                :disabled="mutatingMetadata"
                @click="restoreOriginalFrontmatter"
              >Restore original ({{ cleanedPaths.length }})</button>
              <button
                v-if="cleanupPreview.candidates.length"
                type="button"
                class="btn btn-danger"
                :disabled="mutatingMetadata || cleanupPreview.blocked.length > 0"
                @click="removeFrontmatter"
              >Remove Frontmatter ({{ cleanupPreview.candidates.length }})</button>
            </div>
          </section>
        </div>

        <footer class="settings-actions">
          <button
            type="button"
            class="btn"
            :disabled="saving || settings?.envOverride"
            @click="onClearKey"
          >Clear key</button>
          <button type="button" class="btn" @click="emit('close')">Cancel</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="loading || saving || settings?.envOverride"
            @click="onSave"
          >{{ saving ? 'Saving...' : 'Save' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
