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

  it('emits Monaco scroll position as a document fraction', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '', path: 'inbox/scroll' } })
    mocks.scrollListeners.forEach((fn) => fn({ scrollTopChanged: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('scroll-change')).toEqual([[0.5]])
    wrapper.unmount()
  })

  it('disables expensive editor features and scroll sync for large documents', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: 'x'.repeat(500_000), path: 'inbox/large' } })
    const create = (await import('monaco-editor/esm/vs/editor/editor.api.js')).editor.create as any
    expect(create.mock.calls.at(-1)?.[1]).toMatchObject({ folding: false })
    mocks.scrollListeners.forEach((fn) => fn({ scrollTopChanged: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('scroll-change')).toBeUndefined()
    wrapper.unmount()
  })

  it('drives the editor↔preview scroll sync end-to-end when wired like VaultView', async () => {
    // The composable's preview→editor branch and the EditorPane's
    // scroll-change emit are individually covered, but the wire
    // between them lives in VaultView.vue's template and was not
    // exercised by any test. Mount EditorPane inside the same
    // .editor-pane[data-path] structure VaultView uses, pair its
    // scroll-change emit with a real composable instance via a
    // parent wrapper that mirrors VaultView's @scroll-change
    // handler, fire Monaco's onDidScrollChange, and assert the
    // preview actually scrolls. This catches anyone who renames
    // the emit, removes the @scroll-change handler in VaultView,
    // or stops calling syncPreviewFromEditor on the composable.
    const { defineComponent, ref, effectScope, nextTick } = await import('vue')
    const { useEditorPreviewScrollSync } = await import('../../../composables/vault/useEditorPreviewScrollSync')

    const vaultRoot = document.createElement('div')
    vaultRoot.className = 'vault'
    const editorPaneHost = document.createElement('div')
    editorPaneHost.className = 'editor-pane'
    editorPaneHost.setAttribute('data-path', 'note')
    const previewPane = document.createElement('div')
    previewPane.className = 'preview-pane'
    previewPane.setAttribute('data-path', 'note')
    vaultRoot.appendChild(editorPaneHost)
    vaultRoot.appendChild(previewPane)
    document.body.appendChild(vaultRoot)

    // jsdom does not compute layout — stub the preview's scroll
    // metrics. previewMax = 2400 - 600 = 1800.
    Object.defineProperty(previewPane, 'scrollHeight', { configurable: true, get: () => 2400 })
    Object.defineProperty(previewPane, 'clientHeight', { configurable: true, get: () => 600 })

    const api = effectScope().run(() => useEditorPreviewScrollSync({
      vaultRoot: ref<HTMLElement | null>(vaultRoot),
      activePath: ref<string | null>('note'),
    }))!

    const Wrapper = defineComponent({
      components: { EditorPane },
      template: `<EditorPane :path="path" :model-value="modelValue" @scroll-change="onScroll" />`,
      setup() {
        return {
          path: 'note',
          modelValue: '',
          onScroll: (fraction: number) => api.syncPreviewFromEditor('note', fraction),
        }
      },
    })

    const wrapper = mount(Wrapper, { attachTo: editorPaneHost })
    await nextTick()

    // Monaco reports scrollTop = 250, layout height = 500, scroll
    // height = 1000 → max = 500, fraction = 0.5. Preview fraction 0.5
    // over previewMax = 1800 = scrollTop 900.
    mocks.scrollListeners.forEach((fn) => fn({ scrollTopChanged: true }))
    await wrapper.vm.$nextTick()
    expect(previewPane.scrollTop).toBe(900)
    wrapper.unmount()
    vaultRoot.remove()
  })

  it('registers itself on mount and unregisters on unmount using its own path', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '', path: 'folder/a' } })
    await wrapper.vm.$nextTick()
    const registrations = wrapper.emitted('register-scroll') as Array<[{ path: string; setScrollFraction: (f: number) => void }]>
    expect(registrations).toHaveLength(1)
    expect(registrations[0][0].path).toBe('folder/a')
    expect(typeof registrations[0][0].setScrollFraction).toBe('function')
    wrapper.unmount()
    // Unregister fires with the path the component was given, not whatever
    // the parent's activePath is at unmount time.
    expect(wrapper.emitted('unregister-scroll')).toEqual([['folder/a']])
  })
})
