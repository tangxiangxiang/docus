<script setup lang="ts">
/* Dev-only icon grid for reviewing the icon system. Reachable at
   /__icon-preview in dev mode (gated by router/index.ts).

   Renders every exported ICON_* string from icons.ts at three display
   sizes (14 / 18 / 22) so optical readability can be judged across
   surface scales. Highlighted rows mark icons added in the AI
   vocabulary set so the reviewer can scan them quickly. */

import * as icons from '../components/vault/icons'

const entries = Object.entries(icons).sort(([a], [b]) => a.localeCompare(b))
const filled = new Set(['ICON_AI_MEMORY'])

const aiSet = new Set([
  'ICON_AI_CONTEXT',
  'ICON_AI_MEMORY',
  'ICON_AI_REASONING',
  'ICON_AI_PROMPT',
  'ICON_AI_CONVERSATION',
])

const knowledgeSet = new Set([
  'ICON_KNOWLEDGE_BACKLINK',
  'ICON_KNOWLEDGE_OUTGOING',
  'ICON_KNOWLEDGE_REFERENCE',
  'ICON_KNOWLEDGE_CITATION',
  'ICON_KNOWLEDGE_GRAPH',
  'ICON_KNOWLEDGE_COLLECTION',
  'ICON_KNOWLEDGE_MAP',
])

const statusSet = new Set([
  'ICON_STATUS_SUCCESS',
  'ICON_STATUS_WARNING',
  'ICON_STATUS_ERROR',
  'ICON_STATUS_LOADING',
  'ICON_STATUS_OFFLINE',
  'ICON_STATUS_MODIFIED',
])

const fileTypeSet = new Set([
  'ICON_FILE_IMAGE',
  'ICON_FILE_PDF',
  'ICON_FILE_VIDEO',
  'ICON_FILE_AUDIO',
  'ICON_FILE_CODE',
  'ICON_FILE_ATTACHMENT',
  'ICON_FILE_DRAFT',
])

const surfaceSet = new Set([
  'ICON_NAV_THEME_LIGHT',
  'ICON_NAV_THEME_DARK',
  'ICON_AB_GIT_HISTORY',
  'ICON_AB_SETTINGS',
])

const editorSet = new Set([
  'ICON_EDITOR_SPLIT',
  'ICON_EDITOR_ZEN',
  'ICON_EDITOR_WRAP',
  'ICON_EDITOR_LINE_NUMBER',
  'ICON_EDITOR_MINIMAP',
  'ICON_EDITOR_PIN',
  'ICON_EDITOR_FLOATING',
])

const contextMenuSet = new Set([
  'ICON_MOVE',
  'ICON_COPY',
  'ICON_DUPLICATE',
])

const utilitySet = new Set([
  'ICON_UNDO',
  'ICON_REDO',
  'ICON_CUT',
  'ICON_PASTE',
  'ICON_BOOKMARK',
  'ICON_FILTER',
])

const sizes = [14, 18, 22] as const
</script>

<template>
  <div class="icon-preview">
    <header class="header">
      <h1>Docus Icon System — Preview</h1>
      <p class="hint">
        Dev-only. {{ entries.length }} icons exported from
        <code>src/components/vault/icons.ts</code>.
        AI vocabulary rows are highlighted; filled-glyph exceptions
        are tagged.
      </p>
    </header>

    <table class="grid">
      <thead>
        <tr>
          <th class="cell-name">Icon</th>
          <th v-for="size in sizes" :key="size" class="cell-size">{{ size }}px</th>
          <th class="cell-meta">Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="[name, svg] in entries"
          :key="name"
          :class="{
            'row-ai': aiSet.has(name),
            'row-knowledge': knowledgeSet.has(name),
            'row-status': statusSet.has(name),
            'row-file-type': fileTypeSet.has(name),
            'row-surface': surfaceSet.has(name),
            'row-editor': editorSet.has(name),
            'row-context-menu': contextMenuSet.has(name),
            'row-utility': utilitySet.has(name),
            'row-filled': filled.has(name),
          }"
        >
          <td class="cell-name">
            <code>{{ name }}</code>
          </td>
          <td v-for="size in sizes" :key="size" class="cell-size">
            <span class="icon-wrap" :style="{ width: `${size}px`, height: `${size}px` }" v-html="svg" />
          </td>
          <td class="cell-meta">
            <span v-if="filled.has(name)" class="badge badge-filled">filled</span>
            <span v-else-if="aiSet.has(name)" class="badge badge-ai">AI vocab</span>
            <span v-else-if="knowledgeSet.has(name)" class="badge badge-knowledge">knowledge</span>
            <span v-else-if="statusSet.has(name)" class="badge badge-status">status</span>
            <span v-else-if="fileTypeSet.has(name)" class="badge badge-file-type">file type</span>
            <span v-else-if="surfaceSet.has(name)" class="badge badge-surface">surface</span>
            <span v-else-if="editorSet.has(name)" class="badge badge-editor">editor</span>
            <span v-else-if="contextMenuSet.has(name)" class="badge badge-context-menu">ctx menu</span>
            <span v-else-if="utilitySet.has(name)" class="badge badge-utility">utility</span>
            <span v-else class="muted">outline</span>
          </td>
        </tr>
      </tbody>
    </table>

    <section class="dark-test">
      <h2>Dark theme check</h2>
      <p class="hint">
        Filled-glyph icons (Memory) follow currentColor, so they should
        invert cleanly between themes. The dark strip below shows the
        same grid on a dark surface for AI, knowledge, status, file
        type, surface-display, editor, context-menu, and utility
        vocabularies.
      </p>
      <div class="dark-strip">
        <table class="grid">
          <tbody>
            <tr
              v-for="[name, svg] in entries.filter(([n]) => aiSet.has(n) || knowledgeSet.has(n) || statusSet.has(n) || fileTypeSet.has(n) || surfaceSet.has(n) || editorSet.has(n) || contextMenuSet.has(n) || utilitySet.has(n))"
              :key="`dark-${name}`"
              :class="{ 'row-filled': filled.has(name) }"
            >
              <td class="cell-name"><code>{{ name }}</code></td>
              <td v-for="size in sizes" :key="size" class="cell-size">
                <span class="icon-wrap" :style="{ width: `${size}px`, height: `${size}px` }" v-html="svg" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.icon-preview {
  padding: 32px 40px;
  max-width: 1100px;
  margin: 0 auto;
  font-family: var(--ui-font, system-ui, sans-serif);
  color: var(--vs-text, #1f2328);
  background: var(--vs-bg, #ffffff);
  min-height: 100vh;
}

.header h1 {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 6px;
}

.hint {
  color: var(--vs-text-2, #6a737d);
  font-size: 13px;
  margin: 0 0 28px;
}

.hint code {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--vs-bg-2, #f5f6f8);
}

.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.grid th,
.grid td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--vs-border, #e3e6ea);
  text-align: left;
  vertical-align: middle;
}

.grid th {
  font-weight: 500;
  color: var(--vs-text-3, #6a737d);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cell-name {
  width: 220px;
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
}

.cell-size {
  width: 70px;
  text-align: center;
}

.cell-meta {
  width: 120px;
}

.icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--vs-text, #1f2328);
}

.row-ai {
  background: color-mix(in srgb, #7aa2f7 8%, transparent);
}

.row-knowledge {
  background: color-mix(in srgb, #c191ff 7%, transparent);
}

.row-status {
  background: color-mix(in srgb, #e0a458 7%, transparent);
}

.row-file-type {
  background: color-mix(in srgb, #6ec486 7%, transparent);
}

.row-surface {
  background: color-mix(in srgb, #5fb8d4 7%, transparent);
}

.row-editor {
  background: color-mix(in srgb, #d4789c 7%, transparent);
}

.row-context-menu {
  background: color-mix(in srgb, #9aa0a6 7%, transparent);
}

.row-utility {
  background: color-mix(in srgb, #f4b860 7%, transparent);
}

.row-filled {
  background: color-mix(in srgb, #50aa6e 8%, transparent);
}

.badge {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}

.badge-ai {
  background: color-mix(in srgb, #7aa2f7 18%, transparent);
  color: #4068b8;
}

.badge-knowledge {
  background: color-mix(in srgb, #c191ff 18%, transparent);
  color: #7540b8;
}

.badge-status {
  background: color-mix(in srgb, #e0a458 18%, transparent);
  color: #8a5a18;
}

.badge-file-type {
  background: color-mix(in srgb, #6ec486 18%, transparent);
  color: #2e6b46;
}

.badge-surface {
  background: color-mix(in srgb, #5fb8d4 18%, transparent);
  color: #1f5d75;
}

.badge-editor {
  background: color-mix(in srgb, #d4789c 18%, transparent);
  color: #7a2e4a;
}

.badge-context-menu {
  background: color-mix(in srgb, #9aa0a6 18%, transparent);
  color: #444950;
}

.badge-utility {
  background: color-mix(in srgb, #f4b860 18%, transparent);
  color: #7a4f0a;
}

.badge-filled {
  background: color-mix(in srgb, #50aa6e 18%, transparent);
  color: #2e6b46;
}

.muted {
  color: var(--vs-text-3, #9aa0a6);
  font-size: 12px;
}

.dark-test {
  margin-top: 48px;
  padding-top: 24px;
  border-top: 1px solid var(--vs-border, #e3e6ea);
}

.dark-test h2 {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 6px;
}

.dark-strip {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 16px 20px;
  border-radius: 6px;
  margin-top: 12px;
}

.dark-strip :deep(.grid) {
  color: #d4d4d4;
}

.dark-strip :deep(.grid td) {
  border-bottom-color: #2d2d2d;
}

.dark-strip :deep(.icon-wrap) {
  color: #d4d4d4;
}

.dark-strip :deep(.cell-name code) {
  color: #d4d4d4;
}

.dark-strip :deep(.row-ai) {
  background: color-mix(in srgb, #7aa2f7 16%, transparent);
}

.dark-strip :deep(.row-knowledge) {
  background: color-mix(in srgb, #c191ff 14%, transparent);
}

.dark-strip :deep(.row-status) {
  background: color-mix(in srgb, #e0a458 14%, transparent);
}

.dark-strip :deep(.row-file-type) {
  background: color-mix(in srgb, #6ec486 14%, transparent);
}

.dark-strip :deep(.row-surface) {
  background: color-mix(in srgb, #5fb8d4 14%, transparent);
}

.dark-strip :deep(.row-editor) {
  background: color-mix(in srgb, #d4789c 14%, transparent);
}

.dark-strip :deep(.row-context-menu) {
  background: color-mix(in srgb, #9aa0a6 14%, transparent);
}

.dark-strip :deep(.row-utility) {
  background: color-mix(in srgb, #f4b860 14%, transparent);
}

.dark-strip :deep(.row-filled) {
  background: color-mix(in srgb, #50aa6e 16%, transparent);
}
</style>
