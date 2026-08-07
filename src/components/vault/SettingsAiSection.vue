<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import type { AiSettings } from '../../lib/ai-api'

defineProps<{
  settings: AiSettings | null
  apiKey: string
  baseURL: string
  model: string
  loading: boolean
  saving: boolean
}>()

const emit = defineEmits<{
  'update:apiKey': [value: string]
  'update:baseURL': [value: string]
  'update:model': [value: string]
  save: []
  'clear-key': []
}>()

const { t } = useI18n()

function onInput(field: 'apiKey' | 'baseURL' | 'model', event: Event) {
  const value = (event.target as HTMLInputElement).value
  if (field === 'apiKey') emit('update:apiKey', value)
  else if (field === 'baseURL') emit('update:baseURL', value)
  else emit('update:model', value)
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
      <div class="settings-field-grid">
        <!-- Provider is rendered as a disabled select with one option
             ("Anthropic"). The dropdown chrome is preserved so the
             field reads as a real form control and future providers
             can be added without changing the layout. -->
        <label class="settings-field">
          <span>{{ t('settings.provider') }}</span>
          <select disabled>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        <label class="settings-field">
          <span>{{ t('settings.api_key') }}</span>
          <input
            :value="apiKey"
            type="password"
            autocomplete="off"
            :placeholder="settings?.maskedKey || 'sk-ant-...'"
            :disabled="loading || saving"
            @input="onInput('apiKey', $event)"
          />
        </label>
        <label class="settings-field">
          <span>{{ t('settings.base_url') }}</span>
          <input
            :value="baseURL"
            type="url"
            :placeholder="t('settings.optional')"
            :disabled="loading || saving"
            @input="onInput('baseURL', $event)"
          />
        </label>
        <label class="settings-field">
          <span>{{ t('settings.model') }}</span>
          <input
            :value="model"
            type="text"
            placeholder="claude-sonnet-4-6"
            :disabled="loading || saving"
            @input="onInput('model', $event)"
          />
        </label>
      </div>
    </div>
  </section>
</template>