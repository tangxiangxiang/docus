<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
let suppressNextEmit = false

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown(),
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          if (suppressNextEmit) {
            suppressNextEmit = false
            return
          }
          emit('update:modelValue', u.state.doc.toString())
        }
      }),
    ],
  })
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({ state: makeState(props.modelValue), parent: host.value })
})

watch(
  () => props.modelValue,
  (val) => {
    if (!view) return
    if (view.state.doc.toString() === val) return
    suppressNextEmit = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: val },
    })
  },
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

defineExpose({
  focus() {
    view?.focus()
  },
})
</script>

<template>
  <div ref="host" class="cm-host" />
</template>
