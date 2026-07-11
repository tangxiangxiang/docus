// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => {
  const changeListeners: Array<() => void> = []
  const blurListeners: Array<() => void> = []
  const compositionStartListeners: Array<() => void> = []
  const compositionEndListeners: Array<() => void> = []
  const scrollListeners: Array<(event: { scrollTopChanged: boolean }) => void> = []
  const model = {
    value: '',
    getValue: vi.fn(() => model.value),
    setValue: vi.fn((value: string) => { model.value = value; changeListeners.forEach((fn) => fn()) }),
    getValueInRange: vi.fn(() => model.value),
    getLineContent: vi.fn(() => ''),
    getLineCount: vi.fn(() => Math.max(1, model.value.split('\n').length)),
    getLineMaxColumn: vi.fn(() => 1),
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
    onMouseDown: vi.fn(),
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
    model,
    editor,
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    completionDispose: vi.fn(),
    hoverDispose: vi.fn(),
  }
})

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({
  editor: {
    defineTheme: mocks.defineTheme,
    setTheme: mocks.setTheme,
    createModel: vi.fn((value: string) => { mocks.model.value = value; return mocks.model }),
    create: vi.fn(() => mocks.editor),
  },
  languages: {
    CompletionItemKind: { Reference: 1, Keyword: 2 },
    registerCompletionItemProvider: vi.fn(() => ({ dispose: mocks.completionDispose })),
    registerHoverProvider: vi.fn(() => ({ dispose: mocks.hoverDispose })),
  },
  Uri: { parse: vi.fn((value: string) => value) },
  Range: class Range {
    constructor(..._args: number[]) {}
  },
  KeyCode: { Enter: 3, Tab: 2, KeyB: 31, KeyI: 38, KeyK: 40, Backquote: 85 },
  KeyMod: { Shift: 1024, CtrlCmd: 2048 },
}))
vi.mock('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js', () => ({}))
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({ default: class WorkerStub {} }))

import EditorPane from '../EditorPane.vue'

describe('Monaco EditorPane', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.changeListeners.length = 0
    mocks.blurListeners.length = 0
    mocks.compositionStartListeners.length = 0
    mocks.compositionEndListeners.length = 0
    mocks.scrollListeners.length = 0
    vi.clearAllMocks()
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

  it('restores view state and releases Monaco resources', () => {
    localStorage.setItem('docus.monaco.view-state', JSON.stringify({ 'inbox/test': { cursorState: [], viewState: {} } }))
    const wrapper = mount(EditorPane, { props: { modelValue: 'start', path: 'inbox/test' } })
    expect(mocks.editor.restoreViewState).toHaveBeenCalled()
    wrapper.unmount()
    expect(mocks.editor.dispose).toHaveBeenCalledOnce()
    expect(mocks.model.dispose).toHaveBeenCalledOnce()
    expect(mocks.completionDispose).toHaveBeenCalledOnce()
    expect(mocks.hoverDispose).toHaveBeenCalledOnce()
  })

  it('updates the Monaco theme without recreating the editor', async () => {
    const wrapper = mount(EditorPane, { props: { modelValue: '', path: 'inbox/theme' } })
    document.documentElement.setAttribute('data-theme', 'dark')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.setTheme).toHaveBeenCalledWith('docus-dark')
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
