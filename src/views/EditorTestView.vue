<script setup lang="ts">
import { ref, watch } from 'vue'
import EditorPane from '../components/vault/EditorPane.vue'
import PreviewPane from '../components/vault/PreviewPane.vue'
import { useEditorPreviewScrollSync } from '../composables/vault/useEditorPreviewScrollSync'

const STORAGE_KEY = 'docus.e2e.editor-content'
const initial = `# 中文写作\n\n这是一个测试。\n\n[[archive/linked-note|关联笔记]]\n\n${Array.from({ length: 120 }, (_, index) => `## 第 ${index + 1} 节\n\n这是用于滚动同步测试的第 ${index + 1} 段内容。`).join('\n\n')}`
const content = ref(localStorage.getItem(STORAGE_KEY) ?? initial)
const currentPath = ref('inbox/editor-test')
const openedLink = ref('')
const saved = ref(false)
const vaultRef = ref<HTMLElement | null>(null)
const editorRef = ref<{ setScrollFraction: (fraction: number) => void } | null>(null)
const editorScrollFraction = ref(0)
let saveTimer: ReturnType<typeof setTimeout> | null = null
const editorPreviewScroll = useEditorPreviewScrollSync({
  vaultRoot: vaultRef,
  activePath: currentPath,
  setEditorScrollFraction: (_path, fraction) => editorRef.value?.setScrollFraction(fraction),
})

watch(content, (value) => {
  saved.value = false
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, value)
    saved.value = true
  }, 80)
})

function openLink(path: string) {
  openedLink.value = path
  currentPath.value = path
}
</script>

<template>
  <section ref="vaultRef" class="editor-test-view vault">
    <div class="editor-pane" :data-path="currentPath">
      <EditorPane
        ref="editorRef"
        v-model="content"
        :path="currentPath"
        :link-targets="[{ path: 'archive/linked-note', title: '关联笔记' }]"
        @open-link="openLink"
        @scroll-change="(fraction) => { editorScrollFraction = fraction; editorPreviewScroll.syncPreviewFromEditor(currentPath, fraction) }"
      />
    </div>
    <div class="preview-pane" :data-path="currentPath">
      <PreviewPane :raw="content" />
    </div>
    <output data-testid="save-state">{{ saved ? 'saved' : 'editing' }}</output>
    <output data-testid="opened-link">{{ openedLink }}</output>
    <output data-testid="editor-scroll">{{ editorScrollFraction }}</output>
  </section>
</template>

<style scoped>
.editor-test-view { position: relative; display: flex; height: calc(100vh - var(--navbar-h)); overflow: hidden; }
.editor-pane, .preview-pane { flex: 1 1 0; min-width: 0; min-height: 0; }
.editor-test-view :deep(.monaco-host) { height: 100%; }
output { position: fixed; right: 8px; bottom: 8px; z-index: 10; font: 12px var(--mono); }
[data-testid='opened-link'] { bottom: 28px; }
</style>
