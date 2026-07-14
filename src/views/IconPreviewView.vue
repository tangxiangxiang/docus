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
        same grid on a dark surface.
      </p>
      <div class="dark-strip">
        <table class="grid">
          <tbody>
            <tr
              v-for="[name, svg] in entries.filter(([n]) => aiSet.has(n))"
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

.dark-strip :deep(.row-filled) {
  background: color-mix(in srgb, #50aa6e 16%, transparent);
}
</style>
