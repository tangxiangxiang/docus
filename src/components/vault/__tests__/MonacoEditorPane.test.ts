// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => {
  const changeListeners: Array<() => void> = []
  const blurListeners: Array<() => void> = []
  const compositionStartListeners: Array<() => void> = []
  const compositionEndListeners: Array<() => void> = []
  const scrollListeners: Array<(event: { scrollTopChanged: boolean }) => void> = []
  const mouseDownListeners: Array<(event: any) => void> = []
  const completionProviders: Array<any> = []
  const model = {
    uri: { toString: () => 'docus://vault/test' },
    value: '',
    getValue: vi.fn(() => model.value),
    setValue: vi.fn((value: string) => { model.value = value; changeListeners.forEach((fn) => fn()) }),
    getValueInRange: vi.fn(() => model.value),
    getLineContent: vi.fn(() => ''),
    getLineCount: vi.fn(() => Math.max(1, model.value.split('\n').length)),
    getLineMaxColumn: vi.fn(() => 1),
    getOffsetAt: vi.fn(() => 0),
    getPositionAt: vi.fn(() => ({ lineNumber: 1, column: 1 })),
    isDisposed: vi.fn(() => false),
    dispose: vi.fn(),
  }
  const editor = {
    saveViewState: vi.fn(() => ({ cursorState: [], viewState: {} })),
    restoreViewState: vi.fn(),
    deltaDecorations: vi.fn(() => []),
    onDidChangeModelContent: vi.fn((fn: () => void) => { changeListeners.push(fn) }),
    onDidBlurEditorWidget: vi.fn((fn: () => void) => { blurListeners.push(fn) }),
    onDidCompositionStart: vi.fn((fn: () => void) => { compositionStartListeners.push(fn) }),
    onDidCompositionEnd: vi.fn((fn: () => void) => { compositionEndListeners.push(fn) }),
    onMouseDown: vi.fn((fn: (event: any) => void) => { mouseDownListeners.push(fn) }),
    onDidScrollChange: vi.fn((fn: (event: { scrollTopChanged: boolean }) => void) => { scrollListeners.push(fn) }),
    getScrollHeight: vi.fn(() => 1000),
    getScrollTop: vi.fn(() => 250),
    getLayoutInfo: vi.fn(() => ({ height: 500 })),
    setScrollTop: vi.fn(),
    getVisibleRanges: vi.fn(() => [{ startLineNumber: 1, endLineNumber: 20 }]),
    addCommand: vi.fn(() => 'remember-link-command'),
    addAction: vi.fn(),
    getSelection: vi.fn(() => null),
    executeEdits: vi.fn(),
    setModel: vi.fn(),
    setSelection: vi.fn(),
    updateOptions: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
  }
  return {
    changeListeners,
    blurListeners,
    compositionStartListeners,
    compositionEndListeners,
    scrollListeners,
    mouseDownListeners,
    completionProviders,
    model,
    editor,
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    completionDispose: vi.fn(),
    hoverDispose: vi.fn(),
    getPost: vi.fn(),
  }
})

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  editor: {
    defineTheme: mocks.defineTheme,
    setTheme: mocks.setTheme,
    createModel: vi.fn((value: string) => { mocks.model.value = value; return mocks.model }),
    create: vi.fn(() => mocks.editor),
    setModelMarkers: vi.fn(),
  },
  languages: {
    CompletionItemKind: { Reference: 1, Keyword: 2, Snippet: 3 },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    registerCompletionItemProvider: vi.fn((_language: string, provider: any) => {
      mocks.completionProviders.push(provider)
      return { dispose: mocks.completionDispose }
    }),
    registerHoverProvider: vi.fn(() => ({ dispose: mocks.hoverDispose })),
  },
  Uri: { parse: vi.fn((value: string) => value) },
  Range: class Range {
    constructor(..._args: number[]) {}
  },
  Selection: class Selection {
    constructor(..._args: number[]) {}
  },
  KeyCode: { Enter: 3, Tab: 2, KeyB: 31, KeyI: 38, KeyK: 40, Backquote: 85 },
  KeyMod: { Shift: 1024, CtrlCmd: 2048 },
  MarkerSeverity: { Hint: 1 },
}))
vi.mock('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js', () => ({}))
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class WorkerStub {} }))
vi.mock('../../../lib/api', () => ({ getPost: mocks.getPost }))

import EditorPane from '../EditorPane.vue'
import { resetMarkdownModelsForTesting } from '../monacoModels'

describe('Monaco EditorPane', () => {
  beforeEach(() => {
    resetMarkdownModelsForTesting()
    localStorage.clear()
    mocks.changeListeners.length = 0
    mocks.blurListeners.length = 0
    mocks.compositionStartListeners.length = 0
    mocks.compositionEndListeners.length = 0
    mocks.scrollListeners.length = 0
    mocks.mouseDownListeners.length = 0
    vi.clearAllMocks()
    mocks.model.getValueInRange.mockReset()
    mocks.model.getValueInRange.mockImplementation(() => mocks.model.value)
    mocks.model.getLineContent.mockReset()
    mocks.model.getLineContent.mockImplementation(() => '')
    mocks.model.getLineMaxColumn.mockReset()
    mocks.model.getLineMaxColumn.mockImplementation(() => 1)
    mocks.model.value = ''
    mocks.editor.getSelection.mockReturnValue(null)
    mocks.model.getLineContent.mockReturnValue('')
    document.documentElement.setAttribute('data-theme', 'light')
  })

  it('emits local model changes once', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: 'start', path: 'inbox/test' } })
    mocks.model.value = 'changed'
    mocks.changeListeners.forEach((fn) => fn())
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')).toEqual([['changed']])
    wrapper.unmount()
  })

  it('applies external content without echoing it back', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: 'start', path: 'inbox/test' } })
    await wrapper.setProps({ modelValue: 'server value' })
    expect(mocks.model.setValue).toHaveBeenCalledWith('server value')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('restores view state and keeps the tab model for Undo/Redo', () => {
    localStorage.setItem('docus.monaco.view-state', JSON.stringify({ 'inbox/test': { cursorState: [], viewState: {} } }))
    const wrapper = mount(EditorPane, { props: { modelValue: 'start', path: 'inbox/test' } })
    expect(mocks.editor.restoreViewState).toHaveBeenCalled()
    wrapper.unmount()
    expect(mocks.editor.dispose).toHaveBeenCalledOnce()
    expect(mocks.model.dispose).not.toHaveBeenCalled()
    expect(mocks.completionDispose).not.toHaveBeenCalled()
    expect(mocks.hoverDispose).not.toHaveBeenCalled()
  })

  it('updates the Monaco theme without recreating the editor', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '', path: 'inbox/theme' } })
    document.documentElement.setAttribute('data-theme', 'dark')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.setTheme).toHaveBeenCalledWith('docus-dark')
    wrapper.unmount()
  })

  it('offers Markdown snippets after a slash command', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '/mer', path: 'inbox/slash' } })
    const provider = mocks.completionProviders.at(-1)
    const result = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 5 })
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]).toMatchObject({ label: 'mermaid', insertTextRules: 4 })
    wrapper.unmount()
  })

  it('offers ranked Emoji snippets from the existing Markdown provider', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: ':smi', path: 'inbox/emoji' } })
    const provider = mocks.completionProviders.at(-1)
    const result = await provider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 5 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(result.suggestions[0]).toMatchObject({
      label: '😄 :smile:',
      detail: 'Emoji',
      insertText: 'smile:',
      insertTextRules: 4,
      kind: 3,
      range: { startColumn: 2, endColumn: 5 },
    })
    expect(result.suggestions.length).toBeLessThanOrEqual(30)

    const item = result.suggestions[0]
    const start = item.range.startColumn - 1
    const end = item.range.endColumn - 1
    const sourceAfterEdit = mocks.model.value.slice(0, start) + item.insertText + mocks.model.value.slice(end)
    expect(sourceAfterEdit).toBe(':smile:')
    wrapper.unmount()
  })

  it('keeps ordinary empty colon quiet but lets /emoji explicitly invoke the same provider', async () => {
    const ordinary = mount(EditorPane, { props: { modelValue: ':', path: 'inbox/ordinary-colon' } })
    const ordinaryProvider = mocks.completionProviders.at(-1)
    const ordinaryResult = await ordinaryProvider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 2 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(ordinaryResult.suggestions).toEqual([])
    ordinary.unmount()

    const slash = mount(EditorPane, { props: { modelValue: '/emoji', path: 'inbox/emoji-slash' } })
    const provider = mocks.completionProviders.at(-1)
    const slashResult = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 6 })
    const command = slashResult.suggestions.find((item: any) => item.label === 'emoji')
    expect(command).toMatchObject({
      insertText: ':', insertTextRules: 4, kind: 3,
      command: { id: 'editor.action.triggerSuggest' },
    })

    mocks.model.value = ':'
    const explicitResult = await provider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 2 },
      { triggerKind: 0 },
    )
    expect(explicitResult.suggestions.length).toBe(30)
    expect(explicitResult.suggestions[0]).toMatchObject({ label: '👍 :+1:', insertText: '+1:' })
    slash.unmount()
  })

  it('suppresses Emoji completion in inline/fenced code, URLs, and during IME composition', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '` :smi', path: 'inbox/emoji-guards' } })
    const provider = mocks.completionProviders.at(-1)
    const result = await provider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 6 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(result.suggestions).toEqual([])

    mocks.model.value = '```text\n:smi'
    mocks.model.getValueInRange.mockReturnValue(':smi')
    mocks.model.getLineContent.mockImplementation(((lineNumber: number) => lineNumber === 1 ? '```text' : ':smi') as any)
    const fencedResult = await provider.provideCompletionItems(
      mocks.model,
      { lineNumber: 2, column: 5 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(fencedResult.suggestions).toEqual([])

    mocks.model.value = 'https://example.com/:smi'
    mocks.model.getValueInRange.mockReturnValue('https://example.com/:smi')
    const urlResult = await provider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 26 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(urlResult.suggestions).toEqual([])

    mocks.compositionStartListeners.forEach((fn) => fn())
    mocks.model.value = ':smi'
    mocks.model.getValueInRange.mockReturnValue(':smi')
    const composingResult = await provider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 5 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(composingResult.suggestions).toEqual([])
    mocks.compositionEndListeners.forEach((fn) => fn())
    wrapper.unmount()
  })

  it('keeps completion contexts isolated by model URI', async () => {
    const first = mount(EditorPane, { props: { modelValue: ':smi', path: 'inbox/first' } })
    const firstProvider = mocks.completionProviders.at(-1)
    const firstResult = await firstProvider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 5 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(firstResult.suggestions[0]).toMatchObject({ label: '😄 :smile:' })
    first.unmount()

    const second = mount(EditorPane, { props: { modelValue: '[[gui', path: 'inbox/second', linkTargets: [{ path: 'docs/guide', title: 'Guide' }] } })
    const secondProvider = mocks.completionProviders.at(-1)
    const secondResult = await secondProvider.provideCompletionItems(
      mocks.model,
      { lineNumber: 1, column: 6 },
      { triggerKind: 1, triggerCharacter: '[' },
    )
    expect(secondResult.suggestions[0]).toMatchObject({ label: 'Guide', insertText: 'docs/guide]]' })
    second.unmount()
  })

  it('does not read the full value while completing in a large document', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: 'x'.repeat(500_000) + '\n:smi', path: 'inbox/emoji-large' } })
    const provider = mocks.completionProviders.at(-1)
    mocks.model.getValue.mockClear()
    mocks.model.getValueInRange.mockReturnValue(':smi')
    mocks.model.getLineContent.mockReturnValue(':smi')
    const result = await provider.provideCompletionItems(
      mocks.model,
      { lineNumber: 2, column: 5 },
      { triggerKind: 1, triggerCharacter: ':' },
    )
    expect(result.suggestions[0]).toMatchObject({ label: '😄 :smile:' })
    expect(mocks.model.getValue).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('inserts the added Markdown slash commands through Monaco snippets', async () => {
    const expected = [
      ['footnote', '${1:Text}[^${2:1}]\n\n[^${2:1}]: ${3:Footnote content}'],
      ['highlight', '==${1:Highlighted text}=='],
      ['definition list', '${1:Term}\n: ${2:Definition}'],
    ] as const

    for (const [label, insertText] of expected) {
      const query = label === 'definition list' ? 'definition' : label
      const wrapper = mount(EditorPane, { props: { modelValue: `/${query}`, path: `inbox/${label}` } })
      const provider = mocks.completionProviders.at(-1)
      const result = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: query.length + 2 })
      expect(result.suggestions).toEqual(expect.arrayContaining([
        expect.objectContaining({ label, insertText, insertTextRules: 4, kind: 3 }),
      ]))
      wrapper.unmount()
    }
  })

  it('starts the existing Wiki Link completion after the wiki slash command', async () => {
    const wrapper = mount(EditorPane, {
      props: {
        modelValue: '/wiki',
        path: 'inbox/source',
        linkTargets: [{ path: 'docs/guide', title: 'Guide' }],
      },
    })
    const provider = mocks.completionProviders.at(-1)
    const slashResult = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 6 })
    const wikiCommand = slashResult.suggestions.find((item: any) => item.label === 'wiki link')
    expect(wikiCommand).toMatchObject({
      insertText: '[[',
      insertTextRules: 4,
      command: { id: 'editor.action.triggerSuggest' },
    })

    mocks.model.value = wikiCommand.insertText
    const wikiResult = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 3 })
    expect(wikiResult.suggestions).toContainEqual(expect.objectContaining({
      label: 'Guide', insertText: 'docs/guide]]', range: expect.objectContaining({ startColumn: 3, endColumn: 3 }),
    }))
    wrapper.unmount()
  })

  it('offers target headings after a Wiki Link hash', async () => {
    mocks.getPost.mockResolvedValue({ content: '# Intro\n\n## Setup Guide\n\n## 中文标题' })
    const wrapper = mount(EditorPane, {
      props: {
        modelValue: '[[docs/guide#set',
        path: 'inbox/source',
        linkTargets: [{ path: 'docs/guide', title: 'Guide' }],
      },
    })
    mocks.model.getValueInRange
      .mockReturnValueOnce('[[docs/guide#set')
      .mockReturnValueOnce(']]')
    mocks.model.getLineMaxColumn.mockReturnValue(20)
    const provider = mocks.completionProviders.at(-1)
    const result = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 18 })
    expect(mocks.getPost).toHaveBeenCalledWith('docs/guide')
    expect(result.suggestions).toEqual([expect.objectContaining({
      label: 'Setup Guide',
      insertText: 'setup-guide]]',
      range: expect.objectContaining({ startColumn: 15, endColumn: 20 }),
    })])
    wrapper.unmount()
  })

  it('offers direct and title-alias Wiki Link insertions in stable order', async () => {
    const wrapper = mount(EditorPane, {
      props: { modelValue: '[[gui', path: 'inbox/source', linkTargets: [{ path: 'docs/guide', title: 'Guide title' }] },
    })
    const provider = mocks.completionProviders.at(-1)
    const result = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 6 })
    expect(result.suggestions.map((item: any) => item.insertText)).toEqual([
      'docs/guide]]', 'docs/guide|Guide title]]',
    ])
    wrapper.unmount()
  })

  it('replaces an existing Wiki Link closing pair during completion', async () => {
    const wrapper = mount(EditorPane, {
      props: { modelValue: '[[]]', path: 'inbox/source', linkTargets: [{ path: 'docs/guide', title: 'Guide' }] },
    })
    mocks.model.getValueInRange
      .mockReturnValueOnce('[[')
      .mockReturnValueOnce(']]')
    mocks.model.getLineMaxColumn.mockReturnValue(5)
    const provider = mocks.completionProviders.at(-1)
    const result = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 3 })

    expect(result.suggestions[0]).toMatchObject({
      insertText: 'docs/guide]]',
      range: { startColumn: 3, endColumn: 5 },
    })
    wrapper.unmount()
  })

  it('keeps supplying a Wiki Link closing pair when none exists', async () => {
    const wrapper = mount(EditorPane, {
      props: { modelValue: '[[gui', path: 'inbox/source', linkTargets: [{ path: 'docs/guide', title: 'Guide' }] },
    })
    mocks.model.getValueInRange
      .mockReturnValueOnce('[[gui')
      .mockReturnValueOnce('')
    mocks.model.getLineMaxColumn.mockReturnValue(6)
    const provider = mocks.completionProviders.at(-1)
    const result = await provider.provideCompletionItems(mocks.model, { lineNumber: 1, column: 6 })

    expect(result.suggestions[0]).toMatchObject({
      insertText: 'docs/guide]]',
      range: { startColumn: 3, endColumn: 6 },
    })
    wrapper.unmount()
  })

  it('leaves Enter to Monaco while the suggestion widget is visible', () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '- item', path: 'inbox/source' } })
    const action = mocks.editor.addAction.mock.calls
      .map(([options]) => options)
      .find((options) => options.id === 'docus.markdown-enter')

    expect(action).toMatchObject({ keybindingContext: '!suggestWidgetVisible' })
    wrapper.unmount()
  })

  it('emits create-link when Cmd-clicking a missing Wiki Link', async () => {
    mocks.model.getLineContent.mockReturnValue('[[missing-note]]')
    const wrapper = mount(EditorPane, { props: { modelValue: '[[missing-note]]', path: 'inbox/source', linkTargets: [] } })
    mocks.mouseDownListeners.forEach((listener) => listener({
      target: { position: { lineNumber: 1, column: 4 } },
      event: { ctrlKey: false, metaKey: true },
    }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('create-link')).toEqual([['missing-note']])
    wrapper.unmount()
  })

  it('emits Chinese IME text only after composition ends', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '', path: 'inbox/chinese' } })
    mocks.compositionStartListeners.forEach((fn) => fn())
    mocks.model.value = '中文输入'
    mocks.changeListeners.forEach((fn) => fn())
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    mocks.compositionEndListeners.forEach((fn) => fn())
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')).toEqual([['中文输入']])
    wrapper.unmount()
  })

  it('resolves relative Wiki Links before marking them missing', () => {
    const wrapper = mount(EditorPane, {
      props: {
        modelValue: '[[note]] and [[missing]]',
        path: 'folder/source',
        linkTargets: [{ path: 'folder/note', title: 'Note' }],
      },
    })
    const calls = (mocks.editor.deltaDecorations as unknown as {
      mock: { calls: Array<[unknown, unknown]> }
    }).mock.calls
    const decorations = calls.at(-1)?.[1] as Array<{
      options: { inlineClassName?: string }
    }>
    expect(decorations.map((item) => item.options.inlineClassName)).toContain('monaco-md-link')
    expect(decorations.map((item) => item.options.inlineClassName)).toContain('monaco-md-link-invalid')
    wrapper.unmount()
  })

  it('disables expensive editor features for large documents', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: 'x'.repeat(500_000), path: 'inbox/large' } })
    const create = (await import('monaco-editor/esm/vs/editor/editor.api.js')).editor.create as any
    expect(create.mock.calls.at(-1)?.[1]).toMatchObject({ folding: false })
    wrapper.unmount()
  })
})
