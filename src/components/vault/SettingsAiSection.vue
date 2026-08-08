<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type {
  AiCredentialStatus,
  AiKeyErrorCode,
  AiProvider,
  AiSettings,
} from '../../lib/ai-api'

const props = defineProps<{
  settings: AiSettings | null
  apiKey: string
  baseURL: string
  model: string
  loading: boolean
  saving: boolean
  recoveryCode?: AiKeyErrorCode
  credentialStatus?: AiCredentialStatus | null
}>()

const emit = defineEmits<{
  'update:apiKey': [value: string]
  'update:baseURL': [value: string]
  'update:model': [value: string]
  save: []
  'clear-key': []
  'forget-credential': [provider: AiProvider]
  'switch-provider': [provider: AiProvider]
}>()

const { t } = useI18n()

/* Per-provider placeholder defaults. The active provider's saved
   value wins when present (rendered in the parent as maskedKey /
   baseURL / model); these only fill in for an unconfigured provider. */
const activeProvider = computed<AiProvider>(() =>
  props.settings?.provider ?? props.credentialStatus?.provider ?? 'anthropic',
)
const MODEL_PLACEHOLDER = computed(() =>
  activeProvider.value === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6',
)
const API_KEY_PLACEHOLDER = computed(() =>
  activeProvider.value === 'openai' ? 'sk-...' : 'sk-ant-...',
)
const recoveryProviders = computed<AiProvider[]>(() => {
  if (props.credentialStatus) {
    return (['anthropic', 'openai'] as AiProvider[])
      .filter((provider) => props.credentialStatus?.providers[provider].stored)
  }
  return [props.settings?.provider ?? 'anthropic']
})

function onInput(field: 'apiKey' | 'baseURL' | 'model', event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (field === 'apiKey') emit('update:apiKey', value)
  else if (field === 'baseURL') emit('update:baseURL', value)
  else emit('update:model', value)
}

function onProviderChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'anthropic' || value === 'openai') {
    emit('switch-provider', value)
  }
}
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-ai-title">
    <header class="settings-section-header">
      <div>
        <h3 id="settings-ai-title">{{ t('settings.ai') }}</h3>
        <p>{{ t('settings.ai_subtitle') }}</p>
      </div>
      <div class="settings-section-actions">
        <button
          v-if="settings || recoveryCode === 'master-key-required'"
          type="button"
          class="btn"
          :disabled="saving"
          @click="emit('clear-key')"
        >{{ t('settings.clear_key') }}</button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="loading || saving"
          @click="emit('save')"
        >{{ t(saving ? 'settings.saving' : 'settings.save') }}</button>
      </div>
    </header>
    <div class="settings-section-body">
      <div v-if="recoveryCode === 'master-key-required'" class="settings-ai-recovery" role="alert">
        <strong>{{ t('settings.master_key_missing') }}</strong>
        <p>{{ t('settings.master_key_missing_detail') }}</p>
        <p>{{ t('settings.master_key_forget_warning') }}</p>
        <div class="settings-section-actions">
          <button
            v-for="provider in recoveryProviders"
            :key="provider"
            type="button"
            class="btn"
            :disabled="saving"
            @click="emit('forget-credential', provider)"
          >{{ t('settings.forget_provider_key', { provider }) }}</button>
        </div>
      </div>
      <div class="settings-field-grid">
        <!-- Provider is now a functional select — switching it
             triggers an immediate switch of the active provider
             server-side, which refreshes the masked key + model
             shown below. The UI doesn't pre-load inactive provider
             configs to keep the surface area small; the user
             switches back to see them. -->
        <label class="settings-field">
          <span>{{ t('settings.provider') }}</span>
          <select
            :value="activeProvider"
            :disabled="loading || saving"
            @change="onProviderChange"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label class="settings-field">
          <span>{{ t('settings.api_key') }}</span>
          <input
            :value="apiKey"
            type="password"
            autocomplete="off"
            :placeholder="settings?.maskedKey || API_KEY_PLACEHOLDER"
            :disabled="loading || saving"
            @input="onInput('apiKey', $event)"
          />
        </label>
        <label class="settings-field">
          <span>{{ t('settings.base_url') }}</span>
          <input
            :value="baseURL"
            type="url"
            :placeholder="activeProvider === 'openai' ? 'https://api.openai.com/v1' : t('settings.optional')"
            :disabled="loading || saving"
            @input="onInput('baseURL', $event)"
          />
          <small v-if="activeProvider === 'openai'" class="settings-field-help">
            {{ t('settings.openai_base_url_help') }}
          </small>
        </label>
        <label class="settings-field">
          <span>{{ t('settings.model') }}</span>
          <input
            :value="model"
            type="text"
            :placeholder="MODEL_PLACEHOLDER"
            :disabled="loading || saving"
            @input="onInput('model', $event)"
          />
        </label>
      </div>
    </div>
  </section>
</template>
