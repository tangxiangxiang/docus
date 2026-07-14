<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { acquireMarkdownModel } from './monacoModels'
import { bindMarkdownProviderContext, unbindMarkdownProviderContext } from './monacoMarkdownProviders'
import { resolveWikiTarget } from '../../lib/linkResolve'
import { getPost } from '../../lib/api'
import { useEditorPreferences } from '../../composables/vault/useEditorPreferences'
import {
  indentMarkdownLine,
  filterMarkdownSlashCommands,
  MARKDOWN_CODE_LANGUAGES,
  MARKDOWN_WRAPS,
  markdownContinuation,
  markdownDecorationSpecs,
  markdownLinkFromPaste,
  markdownHeadingTargets,
  markdownWrapEdit,
  rankWikiTargets,
  wikiLinkAtColumn,
  writingDiagnostics,
} from './monacoMarkdown'

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
const preferences = useEditorPreferences()
const isLargeDocument = computed(() => props.modelValue.length >= 500_000)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'open-link': [path: string]
  'create-link': [ref: string]
  'scroll-change': [fraction: number]
  // Self-registration for the editor↔preview scroll sync. The component
  // uses its own props.path (stable for the lifetime of this instance,
  // because the parent re-keys on tab switch) instead of having the
  // parent capture `activePath` in a closure — which races when the
  // active tab changes between mount/unmount.
  'register-scroll': [registration: { path: string; setScrollFraction: (fraction: number) => void }]
  'unregister-scroll': [path: string]
}>()

const host = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let suppressChange = false
let themeObserver: MutationObserver | null = null
let decorationIds: string[] = []
let pasteHandler: ((event: ClipboardEvent) => void) | null = null
let rememberLinkCommand: string | null = null
let composing = false
let decorationTimer: ReturnType<typeof setTimeout> | null = null
const VIEW_STATE_KEY = 'docus.monaco.view-state'
const RECENT_LINKS_KEY = 'docus.monaco.recent-wiki-links'
// `ScrollType` is type-only in Monaco's ESM build; 1 is Immediate.
const IMMEDIATE_SCROLL = 1
let linkPaths: string[] = []
let targetsByPath = new Map<string, EditorLinkTarget>()
const resolvedLinkCache = new Map<string, string | null>()
const headingCache = new Map<string, Promise<ReturnType<typeof markdownHeadingTargets>>>()

function recentLinks(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_LINKS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  }
  catch { return [] }
}

function recordRecentLink(path: string) {
  const links = recentLinks().filter((item) => item !== path)
  localStorage.setItem(RECENT_LINKS_KEY, JSON.stringify([path, ...links].slice(0, 20)))
}

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker }
}
monacoGlobal.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

function activeTheme(): 'docus-light' | 'docus-dark' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'docus-light' : 'docus-dark'
}

monaco.editor.defineTheme('docus-light', {
  base: 'vs', inherit: true,
  rules: [
    { token: 'markup.heading.markdown', foreground: '0969DA', fontStyle: 'bold' },
    { token: 'string.link.markdown', foreground: '0969DA' },
    { token: 'variable', foreground: '953800' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f5f7f9',
    'editorGutter.background': '#ffffff',
  },
})
monaco.editor.defineTheme('docus-dark', {
  base: 'vs-dark', inherit: true,
  rules: [
    { token: 'markup.heading.markdown', foreground: '61AFEF', fontStyle: 'bold' },
    { token: 'string.link.markdown', foreground: '61AFEF' },
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.lineHighlightBackground': '#252526',
    'editorGutter.background': '#1e1e1e',
  },
})

function readViewState(path = props.path): monaco.editor.ICodeEditorViewState | null {
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) ?? '{}') as Record<string, monaco.editor.ICodeEditorViewState>
    return all[path] ?? null
  } catch { return null }
}

function saveViewState(path = props.path) {
  if (!editor) return
  try {
    const all = JSON.parse(localStorage.getItem(VIEW_STATE_KEY) ?? '{}') as Record<string, monaco.editor.ICodeEditorViewState>
    delete all[path]
    all[path] = editor.saveViewState()!
    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).slice(-100))))
  } catch { /* best effort */ }
}

function rebuildLinkIndex() {
  linkPaths = (props.linkTargets ?? []).map((target) => target.path)
  targetsByPath = new Map((props.linkTargets ?? []).map((target) => [target.path, target]))
  resolvedLinkCache.clear()
}

rebuildLinkIndex()

function refreshMarkdownDecorations() {
  if (!editor || !model) return
  if (isLargeDocument.value) {
    decorationIds = editor.deltaDecorations(decorationIds, [])
    monaco.editor.setModelMarkers(model, 'docus-writing', [])
    return
  }
  monaco.editor.setModelMarkers(model, 'docus-writing', preferences.typography.value
    ? writingDiagnostics(model.getValue()).map((item) => ({
        severity: monaco.MarkerSeverity.Hint,
        message: item.message,
        startLineNumber: item.line,
        endLineNumber: item.line,
        startColumn: item.startColumn,
        endColumn: item.endColumn,
      }))
    : [])
  const visible = editor.getVisibleRanges()[0]
  const startLine = Math.max(1, (visible?.startLineNumber ?? 1) - 100)
  const endLine = Math.min(model.getLineCount(), (visible?.endLineNumber ?? Math.min(300, model.getLineCount())) + 100)
  const text = model.getValueInRange(new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)))
  const decorations: monaco.editor.IModelDeltaDecoration[] = markdownDecorationSpecs(
    text,
    (ref) => resolvedWikiPath(ref) !== null,
    startLine - 1,
  ).map((spec) => ({
    range: new monaco.Range(spec.startLineNumber, spec.startColumn, spec.endLineNumber, spec.endColumn),
    options: {
      isWholeLine: Boolean(spec.className),
      className: spec.className,
      inlineClassName: spec.inlineClassName,
    },
  }))
  decorationIds = editor.deltaDecorations(decorationIds, decorations)
}

function resolvedWikiPath(ref: string): string | null {
  if (!resolvedLinkCache.has(ref)) resolvedLinkCache.set(ref, resolveWikiTarget(ref, props.path, linkPaths))
  return resolvedLinkCache.get(ref) ?? null
}

function headingsFor(path: string) {
  let pending = headingCache.get(path)
  if (!pending) {
    pending = getPost(path).then((post) => markdownHeadingTargets(post.content)).catch(() => [])
    headingCache.set(path, pending)
  }
  return pending
}

function wikiCompletionRange(
  currentModel: monaco.editor.ITextModel,
  position: monaco.Position,
  typedLength: number,
): monaco.IRange {
  const suffix = currentModel.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: Math.min(currentModel.getLineMaxColumn(position.lineNumber), position.column + 2),
  })
  const existingClosingLength = suffix.startsWith(']]') ? 2 : 0
  return {
    startLineNumber: position.lineNumber,
    startColumn: position.column - typedLength,
    endLineNumber: position.lineNumber,
    endColumn: position.column + existingClosingLength,
  }
}

function scheduleMarkdownDecorations() {
  if (decorationTimer) clearTimeout(decorationTimer)
  decorationTimer = setTimeout(refreshMarkdownDecorations, 120)
}

const completionProvider: monaco.languages.CompletionItemProvider = {
  triggerCharacters: ['[', '`', '/'],
  async provideCompletionItems(currentModel, position) {
    if (currentModel !== model) return { suggestions: [] }
    const before = currentModel.getValueInRange({
      startLineNumber: position.lineNumber,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })
    const slash = /^\s*\/([^\s/]*)$/.exec(before)
    if (slash) {
      return {
        suggestions: filterMarkdownSlashCommands(slash[1]).map((command) => ({
          label: command.label,
          detail: command.detail,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: command.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: {
            startLineNumber: position.lineNumber,
            startColumn: before.lastIndexOf('/') + 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
        })),
      }
    }
    const fence = /^```([A-Za-z0-9_-]*)$/.exec(before)
    if (fence) {
      return {
        suggestions: MARKDOWN_CODE_LANGUAGES.map((language) => ({
          label: language,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: language,
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column - fence[1].length,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
        })),
      }
    }
    const match = /\[\[([^\]\n]*)$/.exec(before)
    if (!match || match[1].includes('|')) return { suggestions: [] }
    const anchorMatch = /^([^#]+)#([^#]*)$/.exec(match[1])
    if (anchorMatch) {
      const targetPath = resolvedWikiPath(anchorMatch[1])
      if (!targetPath) return { suggestions: [] }
      const query = anchorMatch[2].toLocaleLowerCase()
      const headings = await headingsFor(targetPath)
      const range = wikiCompletionRange(currentModel, position, anchorMatch[2].length)
      return {
        suggestions: headings
          .filter((heading) => `${heading.title} ${heading.anchor}`.toLocaleLowerCase().includes(query))
          .map((heading) => ({
            label: heading.title,
            detail: `${'#'.repeat(heading.level)} · ${heading.anchor}`,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: `${heading.anchor}]]`,
            range,
          })),
      }
    }
    const range = wikiCompletionRange(currentModel, position, match[1].length)
    const recency = recentLinks()
    return {
      suggestions: rankWikiTargets(props.linkTargets ?? [], match[1], recency, props.path)
        .flatMap((target) => {
          const common = {
            filterText: `${target.title} ${target.path}`,
            kind: monaco.languages.CompletionItemKind.Reference,
            command: rememberLinkCommand
              ? { id: rememberLinkCommand, title: 'Remember wiki link', arguments: [target.path] }
              : undefined,
            range,
          }
          const direct = { ...common, label: target.title || target.path, detail: target.path, insertText: `${target.path}]]` }
          return target.title && target.title !== target.path
            ? [direct, { ...common, label: `${target.title} (alias)`, detail: `${target.path} · 以标题显示`, insertText: `${target.path}|${target.title}]]` }]
            : [direct]
        }),
    }
  },
}

const hoverProvider: monaco.languages.HoverProvider = {
  provideHover(currentModel, position) {
    if (currentModel !== model) return null
    const line = currentModel.getLineContent(position.lineNumber)
    const path = wikiLinkAtColumn(line, position.column - 1)
    if (!path) return null
    const resolvedPath = resolvedWikiPath(path)
    const target = resolvedPath ? targetsByPath.get(resolvedPath) : undefined
    return {
      contents: target
        ? [{ value: `**${target.title || target.path}**` }, { value: `\`${target.path}\`` }]
        : [{ value: '**Missing note**' }, { value: `\`${path}\`` }, { value: 'Cmd/Ctrl-click to create it in `inbox/`.' }],
    }
  },
}

onMounted(() => {
  if (!host.value) return
  model = acquireMarkdownModel(props.path, props.modelValue)
  bindMarkdownProviderContext(model, { completion: completionProvider, hover: hoverProvider })
  editor = monaco.editor.create(host.value, {
    model,
    theme: activeTheme(),
    automaticLayout: true,
    wordWrap: props.focusWidth ? 'wordWrapColumn' : 'on',
    wordWrapColumn: preferences.wrapColumn.value,
    minimap: { enabled: false },
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: !isLargeDocument.value,
    fontFamily: preferences.fontFamily.value.trim() || 'var(--mono)',
    fontSize: preferences.fontSize.value,
    lineHeight: preferences.lineHeight.value,
    tabSize: preferences.tabSize.value,
    insertSpaces: true,
    detectIndentation: false,
    padding: { top: 10, bottom: 48 },
    renderLineHighlight: 'line',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
      verticalSliderSize: 6,
      horizontalSliderSize: 6,
      useShadows: false,
    },
    stickyScroll: { enabled: false },
    bracketPairColorization: { enabled: false },
    // Full-width Chinese punctuation such as `）` is ordinary prose in
    // this Markdown vault. Keep Monaco's invisible-character checks, but
    // do not flag every CJK lookalike as a source-code security warning.
    unicodeHighlight: { ambiguousCharacters: false },
    quickSuggestions: { other: true, comments: false, strings: false },
    suggestOnTriggerCharacters: true,
  })
  rememberLinkCommand = editor.addCommand(0, (_context, path: string) => recordRecentLink(path))
  const saved = readViewState()
  if (saved) editor.restoreViewState(saved)
  refreshMarkdownDecorations()
  editor.onDidChangeModelContent(() => {
    scheduleMarkdownDecorations()
    if (suppressChange || composing || !model) return
    emit('update:modelValue', model.getValue())
  })
  for (const [id, label, keybinding, wrap] of [
    ['docus.markdown-bold', 'Toggle bold', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, MARKDOWN_WRAPS.bold],
    ['docus.markdown-italic', 'Toggle italic', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, MARKDOWN_WRAPS.italic],
    ['docus.markdown-code', 'Toggle inline code', monaco.KeyMod.CtrlCmd | monaco.KeyCode.Backquote, MARKDOWN_WRAPS.code],
    ['docus.markdown-link', 'Insert Markdown link', monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, MARKDOWN_WRAPS.link],
  ] as const) {
    editor.addAction({
      id,
      label,
      keybindings: [keybinding],
      run(instance) {
        if (!model) return
        const selection = instance.getSelection()
        if (!selection) return
        const selected = model.getValueInRange(selection)
        const edit = markdownWrapEdit(selected, wrap)
        instance.executeEdits(id, [{ range: selection, text: edit.text }])
        const start = model.getPositionAt(model.getOffsetAt(selection.getStartPosition()) + edit.selectionOffset)
        const end = model.getPositionAt(model.getOffsetAt(start) + edit.selectionLength)
        instance.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column))
      },
    })
  }
  editor.onDidCompositionStart(() => { composing = true })
  editor.onDidCompositionEnd(() => {
    composing = false
    if (!suppressChange && model) emit('update:modelValue', model.getValue())
  })
  editor.onDidScrollChange((event) => {
    if (!editor || !event.scrollTopChanged) return
    if (isLargeDocument.value) return
    const max = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height)
    emit('scroll-change', max > 0 ? editor.getScrollTop() / max : 0)
    scheduleMarkdownDecorations()
  })
  editor.addAction({
    id: 'docus.markdown-enter',
    label: 'Continue Markdown list',
    keybindings: [monaco.KeyCode.Enter],
    keybindingContext: '!suggestWidgetVisible',
    run(instance) {
      if (!model) return
      const selection = instance.getSelection()
      if (!selection) return
      const position = selection.getPosition()
      const before = model.getValueInRange(new monaco.Range(position.lineNumber, 1, position.lineNumber, position.column))
      const continuation = markdownContinuation(before)
      if (continuation.removeMarkerFrom !== undefined && selection.isEmpty()) {
        instance.executeEdits('markdown-enter', [{
          range: new monaco.Range(position.lineNumber, continuation.removeMarkerFrom + 1, position.lineNumber, position.column),
          text: `\n${' '.repeat(continuation.removeMarkerFrom)}`,
        }])
      } else {
        instance.executeEdits('markdown-enter', [{ range: selection, text: continuation.insert }])
      }
    },
  })
  for (const [id, label, keybinding, outdent] of [
    ['docus.markdown-indent', 'Indent Markdown line', monaco.KeyCode.Tab, false],
    ['docus.markdown-outdent', 'Outdent Markdown line', monaco.KeyMod.Shift | monaco.KeyCode.Tab, true],
  ] as const) {
    editor.addAction({
      id,
      label,
      keybindings: [keybinding],
      run(instance) {
        if (!model) return
        const selection = instance.getSelection()
        if (!selection) return
        const isMultiLine = selection.startLineNumber !== selection.endLineNumber
        const currentLine = model.getLineContent(selection.startLineNumber)
        const isList = /^\s*(?:[-+*]|\d+\.|- \[[ xX]\])\s/.test(currentLine)
        if (!isMultiLine && !isList) {
          instance.executeEdits(id, [{ range: selection, text: '\t' }])
          return
        }
        const endLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
          ? selection.endLineNumber - 1
          : selection.endLineNumber
        const edits: monaco.editor.IIdentifiedSingleEditOperation[] = []
        let firstDelta = 0
        let lastDelta = 0
        for (let lineNumber = selection.startLineNumber; lineNumber <= endLine; lineNumber += 1) {
          const line = model.getLineContent(lineNumber)
          const next = indentMarkdownLine(line, outdent)
          if (next !== line) {
            const delta = next.length - line.length
            if (lineNumber === selection.startLineNumber) firstDelta = delta
            if (lineNumber === endLine) lastDelta = delta
            edits.push({ range: new monaco.Range(lineNumber, 1, lineNumber, line.length + 1), text: next })
          }
        }
        instance.executeEdits(id, edits)
        instance.setSelection(new monaco.Selection(
          selection.startLineNumber,
          Math.max(1, selection.startColumn + firstDelta),
          selection.endLineNumber,
          Math.max(1, selection.endColumn + lastDelta),
        ))
      },
    })
  }
  editor.onMouseDown((event) => {
    const position = event.target.position
    if (!model || !position || (!event.event.ctrlKey && !event.event.metaKey)) return
    const ref = wikiLinkAtColumn(model.getLineContent(position.lineNumber), position.column - 1)
    if (!ref) return
    const path = resolvedWikiPath(ref)
    if (!path) {
      emit('create-link', ref)
      return
    }
    recordRecentLink(path)
    emit('open-link', path)
  })
  pasteHandler = (event) => {
    if (!editor || !model) return
    const selection = editor.getSelection()
    if (!selection || selection.isEmpty()) return
    const label = model.getValueInRange(selection)
    const replacement = markdownLinkFromPaste(label, event.clipboardData?.getData('text/plain') ?? '')
    if (!replacement) return
    event.preventDefault()
    event.stopImmediatePropagation()
    editor.executeEdits('markdown-link-paste', [{ range: selection, text: replacement }])
  }
  host.value.addEventListener('paste', pasteHandler, true)
  editor.onDidBlurEditorWidget(() => saveViewState())
  themeObserver = new MutationObserver(() => monaco.editor.setTheme(activeTheme()))
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

watch(() => props.modelValue, (value) => {
  if (!model || model.getValue() === value) return
  suppressChange = true
  model.setValue(value)
  suppressChange = false
})

watch(() => props.path, (nextPath, previousPath) => {
  if (!editor) return
  saveViewState(previousPath)
  emit('unregister-scroll', previousPath)
  if (model) unbindMarkdownProviderContext(model)
  model = acquireMarkdownModel(nextPath, props.modelValue)
  bindMarkdownProviderContext(model, { completion: completionProvider, hover: hoverProvider })
  editor.setModel(model)
  const state = readViewState(nextPath)
  if (state) editor.restoreViewState(state)
  rebuildLinkIndex()
  refreshMarkdownDecorations()
  emit('register-scroll', { path: nextPath, setScrollFraction })
})

watch(() => props.focusWidth, (focused) => {
  editor?.updateOptions({ wordWrap: focused ? 'wordWrapColumn' : 'on', wordWrapColumn: preferences.wrapColumn.value })
})

watch(
  [preferences.fontSize, preferences.lineHeight, preferences.tabSize, preferences.wrapColumn, preferences.fontFamily],
  ([fontSize, lineHeight, tabSize, wrapColumn, fontFamily]) => editor?.updateOptions({
    fontSize, lineHeight, tabSize, wordWrapColumn: wrapColumn, fontFamily: fontFamily.trim() || 'var(--mono)',
  }),
)

watch(isLargeDocument, (large) => {
  editor?.updateOptions({ folding: !large, smoothScrolling: !large })
  refreshMarkdownDecorations()
})
watch(preferences.typography, refreshMarkdownDecorations)

watch(() => props.linkTargets, () => {
  rebuildLinkIndex()
  scheduleMarkdownDecorations()
})

onBeforeUnmount(() => {
  emit('unregister-scroll', props.path)
  saveViewState()
  themeObserver?.disconnect()
  if (decorationTimer) clearTimeout(decorationTimer)
  if (pasteHandler && host.value) host.value.removeEventListener('paste', pasteHandler, true)
  editor?.dispose()
  if (model) unbindMarkdownProviderContext(model)
  editor = null
  model = null
})

function setScrollFraction(fraction: number) {
  if (!editor) return
  const max = Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height)
  editor.setScrollTop(Math.max(0, Math.min(1, fraction)) * max, IMMEDIATE_SCROLL)
}

emit('register-scroll', { path: props.path, setScrollFraction })

defineExpose({
  focus: () => editor?.focus(),
  getScrollEl: () => host.value?.querySelector<HTMLElement>('.monaco-scrollable-element.editor-scrollable') ?? null,
  setScrollFraction,
})
</script>

<template>
  <div ref="host" class="monaco-host" :class="{ 'focus-width': focusWidth }" />
</template>
