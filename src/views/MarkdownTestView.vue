<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PreviewPane from '../components/vault/PreviewPane.vue'
import ReadingPane from '../components/vault/ReadingPane.vue'
import type { Resolver } from '../lib/wikiLinks'

const route = useRoute()
const mode = computed(() => route.query.mode === 'reading' ? 'reading' : 'preview')
const scrollTest = computed(() => route.query.scroll === '1')
const resolveLink: Resolver = (ref) => ({ target: ref === 'missing-note' ? null : ref })
const sample = `---
title: Markdown Style Specimen
---

这是一段用于视觉回归的中文正文，包含 ==高亮==、**粗体**、*强调*、\`inline code\` 与 [外部链接](https://example.com)。

## Content hierarchy

### Lists and tasks

- 第一项
- 第二项
  - 嵌套内容
- [x] 已完成任务
- [ ] 待处理任务

> 同一份内容在 Preview 和 Reading 中应保持相同的视觉语义，只改变阅读密度和页面留白。

#### Data table

| Surface | Semantic style | Density |
| --- | --- | --- |
| Preview | Shared | Compact |
| Reading | Shared | Comfortable |

### Links and media

[[archive/example|有效 Wiki Link]] · [[missing-note|失效 Wiki Link]]

![Docus logo](/logo.svg)

---

### Code and diagrams

\`\`\`typescript
const consistent = preview.style === reading.style
\`\`\`

\`\`\`mermaid
flowchart LR
  Markdown --> Preview
  Markdown --> Reading
\`\`\`

\`\`\`markmap
# Knowledge
## Preview
## Reading
\`\`\`

Term
: Definition list content

Footnote reference.[^1]

[^1]: Shared footnote styling.
`
</script>

<template>
  <div class="vault markdown-test-view">
    <div v-if="mode === 'preview'" class="preview-pane" :class="{ 'scroll-test': scrollTest }">
      <PreviewPane :raw="sample" :resolver="resolveLink" />
    </div>
    <div v-else class="reading-slot">
      <ReadingPane :raw="sample" :resolver="resolveLink" />
    </div>
  </div>
</template>

<style scoped>
.markdown-test-view { min-height: calc(100vh - var(--navbar-h)); background: var(--vs-bg-1); }
.preview-pane, .reading-slot { width: 100%; min-height: calc(100vh - var(--navbar-h)); }
.preview-pane { max-width: 760px; margin: 0 auto; }
.markdown-test-view :deep(.preview-pane),
.markdown-test-view :deep(.reading-pane),
.markdown-test-view :deep(.article) { height: auto; overflow: visible; }
.markdown-test-view .preview-pane.scroll-test {
  height: 320px;
  min-height: 0;
  overflow: auto;
}
</style>
