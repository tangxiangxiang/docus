<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCallRecord } from '../../lib/ai-api'

const props = defineProps<{ call: ToolCallRecord }>()

const expanded = ref(false)
const collapsible = computed(() => ['read_file', 'list_files'].includes(props.call.name))
const COLLAPSE_THRESHOLD = 200

const TOOL_ICONS: Record<string, string> = {
  read_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h10l2 2v8H2z"/><path d="M2 3v10h12"/></svg>',
  list_files: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/></svg>',
  create_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h7l3 3v9H3z"/><path d="M8 7v4M6 9h4"/></svg>',
  write_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3z"/></svg>',
  patch_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="2"/><circle cx="10" cy="10" r="2"/><path d="M7 8l2 0M7 8l-1 4M9 8l1-4"/></svg>',
  delete_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M5 4V2h6v2M5 4l1 10h4l1-10"/></svg>',
  rename_file: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12V8l8-8 4 4-8 8z"/><path d="M6 6l4 4"/></svg>',
}

const icon = computed(() => TOOL_ICONS[props.call.name] ?? TOOL_ICONS.read_file)

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
      <span v-if="call.result.is_error" class="ai-tool-pill ai-tool-pill-error">error</span>
      <span v-else-if="call.result.content" class="ai-tool-pill ai-tool-pill-ok">ok</span>
      <span v-else class="ai-tool-pill ai-tool-pill-pending">…</span>
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
.ai-tool-pill { margin-left: auto; flex: 0 0 auto; padding: 0 5px; border-radius: 4px; font-size: 0.72em; line-height: 1.45; text-transform: lowercase; letter-spacing: 0; }
.ai-tool-pill-ok { background: color-mix(in srgb, #50aa6e 16%, transparent); color: #6ec486; }
.ai-tool-pill-error { background: color-mix(in srgb, #c14545 18%, transparent); color: #e06c75; }
.ai-tool-pill-pending { background: color-mix(in srgb, var(--vs-text-3, #8a93a6) 16%, transparent); color: var(--vs-text-3, #8a93a6); }
.ai-tool-result { margin: 0; padding: 6px 7px; max-height: 220px; overflow: auto; border: 1px solid color-mix(in srgb, var(--vs-border, #3a3f4b) 45%, transparent); border-radius: 4px; background: color-mix(in srgb, var(--vs-bg-1, #1e1e1e) 86%, black); font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 0.82em; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.ai-tool-result.ai-tool-collapsed { max-height: 64px; overflow: hidden; text-overflow: ellipsis; }
.ai-tool-result code { font-family: inherit; }
.ai-tool-toggle { margin-top: 4px; padding: 1px 5px; border: none; border-radius: 4px; background: transparent; color: var(--vs-accent, #7aa2f7); cursor: pointer; font-size: 0.82em; }
.ai-tool-toggle:hover { background: color-mix(in srgb, var(--vs-accent, #7aa2f7) 10%, transparent); }
</style>
