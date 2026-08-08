<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { useEditorPreferences } from '../../composables/vault/useEditorPreferences'
import { useFileTreePreferences } from '../../composables/vault/useFileTreePreferences'

/* Editor preferences live in module-level useStorage() refs and
   auto-persist on change, so this section is fully self-contained —
   no props, no emits. The parent just renders it. */

const { t } = useI18n()
const editorPreferences = useEditorPreferences()
const fileTreePreferences = useFileTreePreferences()
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-editor-title">
    <header class="settings-section-header">
      <div>
        <h3 id="settings-editor-title">{{ t('settings.editor') }}</h3>
        <p>{{ t('settings.editor_subtitle') }}</p>
      </div>
      <div class="settings-section-actions">
        <button type="button" class="btn" @click="editorPreferences.reset">{{ t('settings.reset_editor') }}</button>
      </div>
    </header>
    <div class="settings-section-body">
      <div class="settings-card" aria-labelledby="settings-editor-configuration-title">
        <h4 id="settings-editor-configuration-title" class="settings-card-title">
          {{ t('settings.editor_configuration') }}
        </h4>
        <div class="settings-field-grid">
          <label class="settings-field">
            <span class="settings-field-label">{{ t('settings.font_size') }}</span>
            <input v-model.number="editorPreferences.fontSize.value" type="number" min="11" max="24" />
          </label>
          <label class="settings-field">
            <span class="settings-field-label">{{ t('settings.line_height') }}</span>
            <input v-model.number="editorPreferences.lineHeight.value" type="number" min="16" max="40" />
          </label>
          <label class="settings-field">
            <span class="settings-field-label">{{ t('settings.tab_width') }}</span>
            <select v-model.number="editorPreferences.tabSize.value">
              <option :value="2">{{ t('settings.spaces', { count: 2 }) }}</option>
              <option :value="4">{{ t('settings.spaces', { count: 4 }) }}</option>
            </select>
          </label>
          <label class="settings-field">
            <span class="settings-field-label">{{ t('settings.wrap_column') }}</span>
            <input v-model.number="editorPreferences.wrapColumn.value" type="number" min="60" max="160" />
          </label>
          <label class="settings-field">
            <span class="settings-field-label">{{ t('settings.font_family') }}</span>
            <input v-model="editorPreferences.fontFamily.value" type="text" :placeholder="t('settings.system_monospace')" maxlength="120" />
          </label>
          <label class="settings-field settings-field-checkbox">
            <input v-model="editorPreferences.typography.value" type="checkbox" />
            <span class="settings-field-label">{{ t('settings.writing_diagnostics') }}</span>
          </label>
          <label class="settings-field settings-field-checkbox">
            <input v-model="fileTreePreferences.compactFileTree.value" type="checkbox" />
            <span class="settings-field-label">{{ t('settings.compact_tree') }}</span>
          </label>
        </div>
      </div>
    </div>
  </section>
</template>
