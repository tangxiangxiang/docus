<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, Transaction } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { insertNewlineContinueMarkup, markdown } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import { autocompletion, completionStatus, startCompletion, type CompletionContext, type Completion } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'

export interface EditorLinkTarget {
  path: string
  title: string
}

const props = defineProps<{
  modelValue: string
  path: string
  focusWidth?: boolean
  linkTargets?: EditorLinkTarget[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
let suppressNextEmit = false
const themeCompartment = new Compartment()
const STORAGE_KEY = 'docus.editor.view-state'
type StoredViewState = { anchor: number; head: number; scrollTop: number }
let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null

function readViewStates(): Record<string, StoredViewState> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, StoredViewState>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

function restoreViewState(state: EditorState): EditorState {
  const stored = readViewStates()[props.path]
  if (!stored) return state
  const anchor = Math.min(stored.anchor, state.doc.length)
  const head = Math.min(stored.head, state.doc.length)
  return state.update({ selection: EditorSelection.single(anchor, head) }).state
}

function saveViewState() {
  if (!view || typeof localStorage === 'undefined') return
  try {
    const states = readViewStates()
    const selection = view.state.selection.main
    delete states[props.path]
    states[props.path] = {
      anchor: selection.anchor,
      head: selection.head,
      scrollTop: view.scrollDOM.scrollTop,
    }
    // Bound persistence so renamed/deleted notes cannot grow this forever.
    const entries = Object.entries(states).slice(-100)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* persistence is best-effort */ }
}

function scheduleViewStateSave() {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
  scrollSaveTimer = setTimeout(saveViewState, 120)
}

/* Track the vault's current theme (set as data-theme on <html>) so the
   editor's palette matches the surrounding chrome. oneDark only loads
   in dark mode; in light mode we fall through to a small light-token
   set defined in style.css. A Compartment swaps that extension without
   replacing the EditorView or losing its interaction state. */
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function themeExtension() {
  return currentTheme() === 'dark' ? oneDark : []
}

function markdownLineDecorations(state: EditorState) {
  const builder = new RangeSetBuilder<Decoration>()
  let inFrontmatter = state.doc.lines > 1 && state.doc.line(1).text.trim() === '---'
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number)
    const trimmed = line.text.trimStart()
    const classes: string[] = []
    if (inFrontmatter) classes.push('cm-md-frontmatter')
    const heading = /^(#{1,6})\s/.exec(trimmed)
    if (heading) classes.push('cm-md-heading', `cm-md-h${heading[1].length}`)
    if (/^>\s?/.test(trimmed)) classes.push('cm-md-quote')
    if (/^(?:[-+*]|\d+\.)\s/.test(trimmed)) classes.push('cm-md-list')
    if (classes.length) builder.add(line.from, line.from, Decoration.line({ attributes: { class: classes.join(' ') } }))
    if (number > 1 && inFrontmatter && trimmed.trim() === '---') inFrontmatter = false
  }
  return builder.finish()
}

const markdownStructurePlugin = ViewPlugin.fromClass(class {
  decorations
  constructor(view: EditorView) {
    this.decorations = markdownLineDecorations(view.state)
  }
  update(update: { docChanged: boolean; state: EditorState }) {
    if (update.docChanged) this.decorations = markdownLineDecorations(update.state)
  }
}, { decorations: (value) => value.decorations })

function wikiLinkCompletion(context: CompletionContext) {
  const line = context.state.doc.lineAt(context.pos)
  const before = context.state.doc.sliceString(line.from, context.pos)
  const match = /\[\[([^\]\n]*)$/.exec(before)
  if (!match || match[1].includes('|') || match[1].includes('#')) return null
  const options: Completion[] = (props.linkTargets ?? [])
    .filter((target) => target.path !== props.path)
    .map((target) => ({
      label: `${target.title} ${target.path}`,
      displayLabel: target.title || target.path,
      detail: target.title && target.title !== target.path ? target.path : undefined,
      type: 'text',
      apply: `${target.path}]]`,
    }))
  return {
    from: context.pos - match[1].length,
    options,
    validFor: /^[^\]\n]*$/,
  }
}

function pasteMarkdownLink(event: ClipboardEvent, editor: EditorView): boolean {
  const selection = editor.state.selection.main
  if (selection.empty) return false
  const pasted = event.clipboardData?.getData('text/plain').trim() ?? ''
  if (!/^https?:\/\/\S+$/i.test(pasted)) return false
  const label = editor.state.doc.sliceString(selection.from, selection.to).replace(/]/g, '\\]')
  const url = pasted.replace(/\)/g, '\\)')
  const replacement = `[${label}](${url})`
  event.preventDefault()
  editor.dispatch({
    changes: { from: selection.from, to: selection.to, insert: replacement },
    selection: { anchor: selection.from + replacement.length },
  })
  return true
}

function makeState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      history(),
      search({ top: true }),
      autocompletion({ override: [wikiLinkCompletion], activateOnTyping: true }),
      keymap.of([
        { key: 'Enter', run: insertNewlineContinueMarkup },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      markdown(),
      markdownStructurePlugin,
      EditorView.domEventHandlers({ paste: pasteMarkdownLink }),
      // oneDark colors only apply when the vault is in dark mode — in
      // light mode the editor inherits a light palette via
      // `.vault .cm-host .cm-editor` rules in style.css.
      themeCompartment.of(themeExtension()),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const head = u.state.selection.main.head
          const typed = u.transactions.some((transaction) => transaction.isUserEvent('input.type'))
          if (typed && u.state.doc.sliceString(Math.max(0, head - 2), head) === '[[') {
            queueMicrotask(() => startCompletion(u.view))
          }
          if (suppressNextEmit) {
            suppressNextEmit = false
            return
          }
          emit('update:modelValue', u.state.doc.toString())
        }
        if (u.selectionSet) scheduleViewStateSave()
      }),
    ],
  })
  return restoreViewState(state)
}

/* Reconfigure only the theme compartment. The EditorView, history,
   selection, search panel, and scroll position all remain intact. */
let themeObserver: MutationObserver | null = null
function watchTheme() {
  if (typeof window === 'undefined') return
  themeObserver = new MutationObserver(() => {
    if (!view) return
    view.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) })
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({ state: makeState(props.modelValue), parent: host.value })
  const stored = readViewStates()[props.path]
  if (stored) requestAnimationFrame(() => {
    if (view) view.scrollDOM.scrollTop = stored.scrollTop
  })
  view.scrollDOM.addEventListener('scroll', scheduleViewStateSave, { passive: true })
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
  saveViewState()
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer)
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
  setSelection(anchor: number, head = anchor) {
    if (!view) return
    const max = view.state.doc.length
    view.dispatch({ selection: { anchor: Math.min(anchor, max), head: Math.min(head, max) } })
  },
  insertText(text: string) {
    if (!view) return
    view.focus()
    const selection = view.state.selection.main
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
      annotations: Transaction.userEvent.of('input.type'),
    })
  },
  getCompletionStatus() {
    return view ? completionStatus(view.state) : null
  },
})
</script>

<template>
  <div ref="host" class="cm-host" :class="{ 'focus-width': focusWidth }" />
</template>
