<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  clearAiApiKey,
  getAiCredentialStatus,
  getAiSettings,
  saveAiSettings,
  type AiCredentialStatus,
  type AiKeyErrorCode,
  type AiProvider,
  type AiSettings,
} from '../../lib/ai-api'
import { useToast } from '../../composables/useToast'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useFocusTrap } from '../../composables/useFocusTrap'
import { useConfirm } from '../../composables/useConfirm'
import { useI18n } from '../../composables/useI18n'
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
import SettingsAiSection from './SettingsAiSection.vue'
import SettingsEditorSection from './SettingsEditorSection.vue'
import SettingsMetadataSection from './SettingsMetadataSection.vue'
import { ICON_AI, ICON_EDIT, ICON_TOC } from './icons'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const toast = useToast()
const aiHistory = useAiHistory()
const trap = useFocusTrap()
const { confirm } = useConfirm()
const { t } = useI18n()
const vaultContext = useOptionalVaultContext()

const loading = ref(false)
const saving = ref(false)
const settings = ref<AiSettings | null>(null)
const aiErrorCode = ref<AiKeyErrorCode | undefined>()
const credentialStatus = ref<AiCredentialStatus | null>(null)
const apiKey = ref('')
const baseURL = ref('')
const model = ref('claude-sonnet-4-6')
const modalRef = ref<HTMLElement | null>(null)
const migrationSummary = ref<MetadataMigrationSummary | null>(null)
const cleanupPreview = ref<FrontmatterCleanupPreview | null>(null)
const previewing = ref(false)
const mutatingMetadata = ref(false)
const cleanedPaths = ref<string[]>([])

/* Left nav + right detail. Each section is its own .vue file
   (SettingsAiSection / SettingsEditorSection / SettingsMetadataSection)
   so the shell stays a routing layer — no inline form templates.
   The active pane resets to AI every time the modal opens so a
   returning user always lands somewhere predictable. */
type SectionId = 'ai' | 'editor' | 'metadata'
const SECTIONS: ReadonlyArray<{ id: SectionId; labelKey: string; icon: string }> = [
  { id: 'ai', labelKey: 'settings.ai', icon: ICON_AI },
  { id: 'editor', labelKey: 'settings.editor', icon: ICON_EDIT },
  { id: 'metadata', labelKey: 'settings.metadata', icon: ICON_TOC },
]
const active = ref<SectionId>('ai')

async function load() {
  loading.value = true
  aiErrorCode.value = undefined
  credentialStatus.value = null
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
    aiErrorCode.value = e.code
    if (e.code === 'master-key-required') {
      credentialStatus.value = await getAiCredentialStatus().catch(() => null)
    }
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
    baseURL.value = next.baseURL
    model.value = next.model
    await aiHistory.loadActive()
    toast.success(t('settings.saved'))
  } catch (e: any) {
    toast.error(t('settings.save_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    saving.value = false
  }
}

/* Provider switch — saves { provider } only (no apiKey/baseURL/model),
   which on the server side updates the active provider and returns the
   new view. We then refresh local refs from the response so the form
   fields show the new provider's saved config. The local input values
   (apiKey/baseURL/model) get overwritten by the response so the user
   sees what is now active. */
async function onSwitchProvider(provider: 'anthropic' | 'openai') {
  saving.value = true
  try {
    const next = await saveAiSettings({ provider })
    settings.value = next
    apiKey.value = ''
    baseURL.value = next.baseURL
    model.value = next.model
  } catch (e: any) {
    toast.error(t('settings.save_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    saving.value = false
  }
}

async function onClearKey(provider?: AiProvider) {
  const target = provider ?? settings.value?.provider ?? credentialStatus.value?.provider ?? 'anthropic'
  const ok = await confirm(
    t('settings.forget_key_confirm', { provider: target }),
    t('settings.forget_key_detail'),
    {
      confirmLabel: t('settings.forget_key_action'),
      cancelLabel: t('settings.cancel'),
      destructive: true,
    },
  )
  if (!ok) return
  saving.value = true
  try {
    await clearAiApiKey(target)
    apiKey.value = ''
    if (settings.value?.provider === target) {
      settings.value = {
        ...settings.value,
        configured: false,
        source: 'none',
        maskedKey: '',
      }
    }
    try {
      const next = await getAiSettings()
      settings.value = next
      baseURL.value = next.baseURL
      model.value = next.model
      aiErrorCode.value = undefined
      credentialStatus.value = null
      await aiHistory.loadActive()
    } catch (error: any) {
      aiErrorCode.value = error.code
      if (error.code === 'master-key-required') {
        credentialStatus.value = await getAiCredentialStatus().catch(() => null)
      }
    }
    toast.success(t('settings.key_cleared'))
  } catch (e: any) {
    toast.error(t('settings.clear_failed', { error: e.message ?? t('common.unknown_error') }))
  } finally {
    saving.value = false
  }
}

watch(() => props.open, (open) => {
  if (open) {
    active.value = 'ai'
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
          <button
            type="button"
            class="settings-icon-btn"
            :title="t('settings.close')"
            :aria-label="t('settings.close')"
            @click="emit('close')"
          ><span aria-hidden="true">×</span></button>
        </header>

        <div class="settings-body">
          <nav class="settings-nav" :aria-label="t('settings.title')">
            <button
              v-for="section in SECTIONS"
              :key="section.id"
              type="button"
              class="settings-nav-item"
              :class="{ active: active === section.id }"
              :aria-current="active === section.id ? 'page' : undefined"
              @click="active = section.id"
            >
              <span class="settings-nav-icon" v-html="section.icon" aria-hidden="true" />
              <span>{{ t(section.labelKey) }}</span>
            </button>
          </nav>

          <div class="settings-detail" role="region" aria-live="polite">
            <SettingsAiSection
              v-if="active === 'ai'"
              :settings="settings"
              :apiKey="apiKey"
              :baseURL="baseURL"
              :model="model"
              :recoveryCode="aiErrorCode"
              :credentialStatus="credentialStatus"
              :loading="loading"
              :saving="saving"
              @update:apiKey="apiKey = $event"
              @update:baseURL="baseURL = $event"
              @update:model="model = $event"
              @save="onSave"
              @clear-key="onClearKey()"
              @forget-credential="onClearKey"
              @switch-provider="onSwitchProvider"
            />
            <SettingsEditorSection v-else-if="active === 'editor'" />
            <SettingsMetadataSection
              v-else
              :migrationSummary="migrationSummary"
              :cleanupPreview="cleanupPreview"
              :cleanedPaths="cleanedPaths"
              :previewing="previewing"
              :mutatingMetadata="mutatingMetadata"
              @preview="previewCleanup"
              @restore="restoreOriginalFrontmatter"
              @remove="removeFrontmatter"
            />
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
