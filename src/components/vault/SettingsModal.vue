<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clearAiApiKey, getAiSettings, saveAiSettings, type AiSettings } from '../../lib/ai-api'
import { useToast } from '../../composables/useToast'
import { useAiHistory } from '../../composables/vault/useAiHistory'
import { useFocusTrap } from '../../composables/useFocusTrap'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const toast = useToast()
const aiHistory = useAiHistory()
const trap = useFocusTrap()
const loading = ref(false)
const saving = ref(false)
const settings = ref<AiSettings | null>(null)
const apiKey = ref('')
const baseURL = ref('')
const model = ref('claude-sonnet-4-6')
const modalRef = ref<HTMLElement | null>(null)

const sourceLabel = computed(() => {
  if (!settings.value) return 'Unknown'
  if (settings.value.source === 'env') return 'Environment'
  if (settings.value.source === 'db') return 'Saved'
  return 'Not configured'
})

async function load() {
  loading.value = true
  try {
    const next = await getAiSettings()
    settings.value = next
    apiKey.value = ''
    baseURL.value = next.baseURL
    model.value = next.model || 'claude-sonnet-4-6'
  } catch (e: any) {
    toast.error('加载设置失败: ' + (e.message ?? '未知错误'))
  } finally {
    loading.value = false
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
