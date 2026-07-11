<script setup lang="ts">
import { ref, watch } from 'vue'
import EditorPane from '../components/vault/EditorPane.vue'

const STORAGE_KEY = 'docus.e2e.editor-content'
const initial = '# 中文写作\n\n这是一个测试。\n\n[[zettel/linked-note|关联笔记]]'
const content = ref(localStorage.getItem(STORAGE_KEY) ?? initial)
const currentPath = ref('inbox/editor-test')
const openedLink = ref('')
const saved = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

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
  <section class="editor-test-view">
    <EditorPane
      v-model="content"
      :path="currentPath"
      :link-targets="[{ path: 'zettel/linked-note', title: '关联笔记' }]"
      @open-link="openLink"
    />
    <output data-testid="save-state">{{ saved ? 'saved' : 'editing' }}</output>
    <output data-testid="opened-link">{{ openedLink }}</output>
  </section>
</template>

<style scoped>
.editor-test-view { position: relative; height: calc(100vh - var(--navbar-h)); }
.editor-test-view :deep(.monaco-host) { height: 100%; }
output { position: fixed; right: 8px; bottom: 8px; z-index: 10; font: 12px var(--mono); }
[data-testid='opened-link'] { bottom: 28px; }
</style>
