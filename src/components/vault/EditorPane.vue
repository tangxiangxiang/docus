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

/* Track the vault's current theme (set as data-theme on <html>) so the
   editor's palette matches the surrounding chrome. oneDark only loads
   in dark mode; in light mode we fall through to a small light-token
   set defined in style.css. We re-evaluate when the attribute changes
   (useTheme.toggle sets it) and rebuild the EditorView in place. */
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function makeState(doc: string): EditorState {
  const dark = currentTheme() === 'dark'
  return EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown(),
      // oneDark colors only apply when the vault is in dark mode — in
      // light mode the editor inherits a light palette via
      // `.vault .cm-host .cm-editor` rules in style.css.
      ...(dark ? [oneDark] : []),
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

/* Re-create the editor when the user toggles theme. The token set is
   baked into the state at construction time (oneDark or none), so
   swapping themes needs a full state rebuild rather than a simple
   reconfigure. Preserve the doc + cursor position. */
let themeObserver: MutationObserver | null = null
function watchTheme() {
  if (typeof window === 'undefined') return
  themeObserver = new MutationObserver(() => {
    if (!view || !host.value) return
    const sel = view.state.selection.main
    const doc = view.state.doc.toString()
    view.destroy()
    view = new EditorView({ state: makeState(doc), parent: host.value })
    if (sel.from <= view.state.doc.length) {
      view.dispatch({ selection: { anchor: sel.from, head: sel.head } })
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({ state: makeState(props.modelValue), parent: host.value })
  watchTheme()
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
  themeObserver?.disconnect()
  themeObserver = null
})

defineExpose({
  focus() {
    view?.focus()
  },
  /* CodeMirror's scroll container is `.cm-scroller` (not the host
     div). Expose it so the parent (VaultView's edit-mode scroll-sync
     composable) can attach a passive scroll listener and mirror the
     preview pane. Returns null until the view has mounted. */
  getScrollEl(): HTMLElement | null {
    return view?.scrollDOM ?? null
  },
})
</script>

<template>
  <div ref="host" class="cm-host" />
</template>
