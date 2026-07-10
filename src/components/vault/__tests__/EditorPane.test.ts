// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { EditorView } from '@codemirror/view'
import EditorPane from '../EditorPane.vue'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('EditorPane', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.setAttribute('data-theme', 'light')
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.removeAttribute('data-theme')
  })

  it('reconfigures the theme without destroying the editor view', async () => {
    const destroy = vi.spyOn(EditorView.prototype, 'destroy')
    const wrapper = mount(EditorPane, {
      props: { modelValue: '# Note', path: 'inbox/note', focusWidth: true },
      attachTo: document.body,
    })

    document.documentElement.setAttribute('data-theme', 'dark')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(destroy).not.toHaveBeenCalled()

    wrapper.unmount()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('opens CodeMirror search with Mod-f', async () => {
    const wrapper = mount(EditorPane, {
      props: { modelValue: 'search me', path: 'inbox/search' },
      attachTo: document.body,
    })
    await wrapper.find('.cm-content').trigger('keydown', { key: 'f', ctrlKey: true })
    expect(wrapper.find('.cm-panel.cm-search').exists()).toBe(true)
    wrapper.unmount()
  })

  it('continues Markdown list markup on Enter', async () => {
    const wrapper = mount(EditorPane, {
      props: { modelValue: '- first', path: 'inbox/list' },
      attachTo: document.body,
    })
    const content = wrapper.find('.cm-content')
    ;(wrapper.vm as unknown as { setSelection: (anchor: number) => void }).setSelection(7)
    await content.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['- first\n- '])
    wrapper.unmount()
  })

  it('restores the selection for each document path', async () => {
    const first = mount(EditorPane, {
      props: { modelValue: 'abcd', path: 'inbox/position' },
      attachTo: document.body,
    })
    ;(first.vm as unknown as { setSelection: (anchor: number) => void }).setSelection(2)
    first.unmount()

    const restored = mount(EditorPane, {
      props: { modelValue: 'abcd', path: 'inbox/position' },
      attachTo: document.body,
    })
    await restored.find('.cm-content').trigger('keydown', { key: 'Enter' })
    expect(restored.emitted('update:modelValue')?.at(-1)).toEqual(['ab\ncd'])
    restored.unmount()
  })

  it('turns a pasted URL into a Markdown link when text is selected', async () => {
    const wrapper = mount(EditorPane, {
      props: { modelValue: 'OpenAI', path: 'inbox/link' },
      attachTo: document.body,
    })
    ;(wrapper.vm as unknown as { setSelection: (anchor: number, head: number) => void }).setSelection(0, 6)
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: (type: string) => type === 'text/plain' ? 'https://openai.com' : '' },
    })
    wrapper.find('.cm-content').element.dispatchEvent(paste)
    await wrapper.vm.$nextTick()
    expect(paste.defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['[OpenAI](https://openai.com)'])
    wrapper.unmount()
  })

  it('offers vault notes after [[ and inserts the stable English path', async () => {
    const wrapper = mount(EditorPane, {
      props: {
        modelValue: '',
        path: 'inbox/current',
        linkTargets: [
          { path: 'inbox/current', title: '当前笔记' },
          { path: 'literature/ahrens', title: '卡片笔记写作法' },
        ],
      },
      attachTo: document.body,
    })
    ;(wrapper.vm as unknown as { insertText: (text: string) => void }).insertText('[[')
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect((wrapper.vm as unknown as { getCompletionStatus: () => string | null }).getCompletionStatus()).toBe('active')

    await wrapper.find('.cm-content').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['[[literature/ahrens]]'])
    wrapper.unmount()
  })

  it('applies and toggles the focused-width class', async () => {
    const wrapper = mount(EditorPane, {
      props: { modelValue: '', path: 'inbox/width', focusWidth: true },
    })
    expect(wrapper.classes()).toContain('focus-width')
    await wrapper.setProps({ focusWidth: false })
    expect(wrapper.classes()).not.toContain('focus-width')
  })
})
