<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCallRecord } from '../../lib/ai-api'
import {
  ICON_CREATE_FILE,
  ICON_DELETE_FILE,
  ICON_LIST_FILES,
  ICON_PATCH_FILE,
  ICON_READ_FILE,
  ICON_RENAME_FILE,
  ICON_STATUS_ERROR,
  ICON_STATUS_LOADING,
  ICON_STATUS_SUCCESS,
  ICON_WRITE_FILE,
} from './icons'

const props = defineProps<{ call: ToolCallRecord }>()

const expanded = ref(false)
const collapsible = computed(() => ['read_file', 'list_files'].includes(props.call.name))
const COLLAPSE_THRESHOLD = 200

const TOOL_ICONS: Record<string, string> = {
  read_file: ICON_READ_FILE,
  list_files: ICON_LIST_FILES,
  create_file: ICON_CREATE_FILE,
  write_file: ICON_WRITE_FILE,
  patch_file: ICON_PATCH_FILE,
  delete_file: ICON_DELETE_FILE,
  rename_file: ICON_RENAME_FILE,
}

const icon = computed(() => TOOL_ICONS[props.call.name] ?? ICON_READ_FILE)

// Status pill glyph. The pill is icon-only on the screen; the
// aria-label carries the text meaning for screen readers.
const statusPill = computed<{ icon: string; label: string; className: string }>(() => {
  if (props.call.result.is_error) return { icon: ICON_STATUS_ERROR, label: 'error', className: 'ai-tool-pill-error' }
  if (props.call.result.content) return { icon: ICON_STATUS_SUCCESS, label: 'ok', className: 'ai-tool-pill-ok' }
  return { icon: ICON_STATUS_LOADING, label: 'pending', className: 'ai-tool-pill-pending' }
})

function stringInput(key: string): string {
  const value = props.call.input[key]
  return typeof value === 'string' ? value : ''
}

function countResultItems(content: string): number | null {
  const trimmed = content.trim()
  if (!trimmed) return null
  const lines = trimmed.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length > 1) return lines.length
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return parsed.length
    if (parsed && typeof parsed === 'object') return Object.keys(parsed).length
  } catch {
    // Plain text results use the character-count summary.
  }
  return null
}

function formatChars(content: string): string {
  const n = content.length
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k chars`
  return `${n} chars`
}

const summary = computed(() => {
  const path = stringInput('path')
  const newPath = stringInput('new_path')
  const scope = stringInput('scope')
  const target = props.call.name === 'rename_file' && newPath
    ? `${path || 'file'} -> ${newPath}`
    : path || scope || ''
  const content = props.call.result.content
  const result = props.call.result.is_error
    ? 'error'
    : !content
      ? 'pending'
      : props.call.name === 'list_files'
        ? `${countResultItems(content) ?? 0} items`
        : formatChars(content)
  return [target, result].filter(Boolean).join(' · ')
})

const visibleContent = computed(() => {
  const content = props.call.result.content
  if (!collapsible.value || expanded.value || content.length <= COLLAPSE_THRESHOLD) return content
  return content.slice(0, COLLAPSE_THRESHOLD) + '…'
})
</script>

<template>
  <div class="ai-tool-card" :class="{ 'ai-tool-error': call.result.is_error }">
    <div class="ai-tool-header">
      <span class="ai-tool-icon" v-html="icon" aria-hidden="true" />
      <span class="ai-tool-name">{{ call.name }}</span>
      <span class="ai-tool-summary">{{ summary }}</span>
      <span
        class="ai-tool-pill"
        :class="statusPill.className"
        :aria-label="statusPill.label"
        v-html="statusPill.icon"
      />
    </div>
    <pre
      v-if="call.result.content"
      class="ai-tool-result"
      :class="{ 'ai-tool-collapsed': collapsible && !expanded }"
    ><code>{{ visibleContent }}</code></pre>
    <button
      v-if="call.result.content && collapsible"
      type="button"
      class="ai-tool-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >{{ expanded ? '收起' : '展开' }}</button>
  </div>
</template>

<style scoped>
.ai-tool-card { margin-top: 7px; padding: 6px 7px; border: 1px solid color-mix(in srgb, var(--vs-border, #3a3f4b) 72%, transparent); border-radius: 5px; background: color-mix(in srgb, var(--vs-bg-2, #252526) 78%, transparent); font-size: 0.82em; }
.ai-tool-card.ai-tool-error { border-color: color-mix(in srgb, #c14545 72%, var(--vs-border, #3a3f4b)); background: color-mix(in srgb, #c14545 10%, var(--vs-bg-2, #252526)); }
.ai-tool-header { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; min-height: 18px; }
.ai-tool-icon { display: inline-flex; align-items: center; color: var(--vs-text-3, #8a93a6); }
.ai-tool-name { font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-weight: 500; color: var(--vs-text-2, #858585); }
.ai-tool-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vs-text-3, #6a6a6a); font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 0.92em; }
.ai-tool-pill { margin-left: auto; flex: 0 0 auto; padding: 2px; border-radius: 4px; line-height: 0; display: inline-flex; align-items: center; justify-content: center; }
.ai-tool-pill :deep(svg) { display: block; }
.ai-tool-pill-ok { background: color-mix(in srgb, #50aa6e 16%, transparent); color: #6ec486; }
.ai-tool-pill-error { background: color-mix(in srgb, #c14545 18%, transparent); color: #e06c75; }
.ai-tool-pill-pending { background: color-mix(in srgb, var(--vs-text-3, #8a93a6) 16%, transparent); color: var(--vs-text-3, #8a93a6); }
.ai-tool-result { margin: 0; padding: 6px 7px; max-height: 220px; overflow: auto; border: 1px solid color-mix(in srgb, var(--vs-border, #3a3f4b) 45%, transparent); border-radius: 4px; background: color-mix(in srgb, var(--vs-bg-1, #1e1e1e) 86%, black); font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 0.82em; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.ai-tool-result.ai-tool-collapsed { max-height: 64px; overflow: hidden; text-overflow: ellipsis; }
.ai-tool-result code { font-family: inherit; }
.ai-tool-toggle { margin-top: 4px; padding: 1px 5px; border: none; border-radius: 4px; background: transparent; color: var(--vs-accent, #7aa2f7); cursor: pointer; font-size: 0.82em; }
.ai-tool-toggle:hover { background: color-mix(in srgb, var(--vs-accent, #7aa2f7) 10%, transparent); }
</style>
