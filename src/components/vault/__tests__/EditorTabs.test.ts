// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import EditorTabs from '../EditorTabs.vue'
import ConfirmHost from '../../ConfirmHost.vue'
import type { WorkspaceTab } from '../tabs'
import { useI18n } from '../../../composables/useI18n'
import { deriveDocumentSavePresentation } from '../../../composables/vault/editor-tabs/savePresentation'
import type { DocumentSavePresentation } from '../../../composables/vault/editor-tabs/savePresentation'
import { useConfirm } from '../../../composables/useConfirm'

function save(overrides: Partial<DocumentSavePresentation> = {}): DocumentSavePresentation {
  return {
    status: 'idle',
    dirty: false,
    inFlight: false,
    hasNewerChanges: false,
    retryable: false,
    attention: false,
    ...overrides,
  }
}

function makeTab(path: string, overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: path,
    label: path.endsWith('.md') ? path.slice(0, -3) : path,
    title: path,
    save: deriveDocumentSavePresentation(null),
    kind: 'document',
    ...overrides,
  }
}

const TABS: WorkspaceTab[] = [
  makeTab('a.md'),
  makeTab('b.md'),
  makeTab('c.md'),
  makeTab('d.md'),
]

class TestDataTransfer {
  effectAllowed = 'uninitialized'
  dropEffect = 'none'
  readonly types: string[] = []
  private data = new Map<string, string>()

  setData(type: string, value: string) {
    if (!this.types.includes(type)) this.types.push(type)
    this.data.set(type, value)
  }

  getData(type: string) {
    return this.data.get(type) ?? ''
  }
}

/** Find the tab whose basename (what .tab-title shows) equals `name`
 *  and trigger its contextmenu. The tab-title strips the .md
 *  extension, so callers pass "a" rather than "a.md". Returns the
 *  wrapper for chaining. */
async function rightClick(w: ReturnType<typeof mount>, name: string) {
  const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === name)
  if (!tab) throw new Error(`No tab with basename "${name}"`)
  await tab.trigger('contextmenu', { clientX: 100, clientY: 50 })
  await w.vm.$nextTick()
  await flushPromises()
  return w
}

function menuButtons(): HTMLButtonElement[] {
  // The menu is teleported to <body>, so query the document directly
  // (wrapper.find only sees the wrapper's root element by default).
  const menu = document.querySelector<HTMLElement>('.tab-context-menu')
  if (!menu) return []
  return [...menu.querySelectorAll<HTMLButtonElement>('button')]
}

describe('EditorTabs context menu', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    // The menu is teleported to <body>, so it survives w.unmount() and
    // would leak into the next case's document.querySelector. Wipe any
    // leftover menu before each case.
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
  })

  it('does not show the menu until a tab is right-clicked', () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    expect(document.querySelector('.tab-context-menu')).toBeNull()
    w.unmount()
  })

  it('opens the menu on right-click and renders the complete ordered menu', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'a')
    const items = menuButtons().map((b) => b.textContent)
    expect(items).toEqual(['关闭', '关闭其它', '关闭左侧', '关闭右侧', '关闭所有', '复制路径', '在文件树中显示'])
    expect(document.querySelector('.tab-context-menu')?.getAttribute('role')).toBe('menu')
    expect(menuButtons().every((button) => button.getAttribute('role') === 'menuitem')).toBe(true)
    expect(document.querySelector('[role="separator"]')).not.toBeNull()
    w.unmount()
  })

  it('"关闭" emits close with the right-clicked tab path', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'b')
    const btns = menuButtons()
    btns[0].click()  // 关闭
    await flushPromises()
    expect(w.emitted('close')).toEqual([['b.md']])
    expect(w.emitted('close-many')).toBeUndefined()
    w.unmount()
  })

  it.each([
    ['Document', makeTab('b.md')],
    ['History', makeTab('history:b', { kind: 'history', label: 'B History' })],
    ['Diff', makeTab('diff:b', { kind: 'diff', label: 'B Diff' })],
  ])('focuses the active tab after the parent successfully removes a non-active %s tab', async (_name, closingTab) => {
    const Harness = defineComponent({
      components: { EditorTabs },
      setup() {
        const tabs = ref([makeTab('a.md'), closingTab])
        const editorTabs = ref<InstanceType<typeof EditorTabs> | null>(null)
        async function close(id: string) {
          tabs.value = tabs.value.filter((tab) => tab.id !== id)
          await nextTick()
          editorTabs.value?.focusTab('a.md')
        }
        return { tabs, editorTabs, close }
      },
      template: '<EditorTabs ref="editorTabs" :tabs="tabs" active-path="a.md" @close="close" />',
    })
    const w = mount(Harness, { attachTo: document.body })
    const source = w.find(`[data-tab-id="${closingTab.id}"]`)
    const sourceElement = source.element as HTMLElement
    sourceElement.focus()
    await source.trigger('keydown', { key: 'ContextMenu' })
    menuButtons().find((button) => button.textContent === '关闭')!.click()
    await flushPromises()
    await nextTick()

    expect(w.find(`[data-tab-id="${closingTab.id}"]`).exists()).toBe(false)
    expect(w.find('[data-tab-id="a.md"]').attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(w.find('[data-tab-id="a.md"]').element)
    expect(document.activeElement).not.toBe(document.body)
    w.unmount()
  })

  it('"关闭其它" emits close-many with every path except the right-clicked one', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'b')
    menuButtons().find((b) => b.textContent === '关闭其它')!.click()
    await flushPromises()
    expect(w.emitted('close-many')).toEqual([[['a.md', 'c.md', 'd.md']]])
    w.unmount()
  })

  it('"关闭右侧" emits close-many with paths to the right of the right-clicked tab', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'b')
    menuButtons().find((b) => b.textContent === '关闭右侧')!.click()
    await flushPromises()
    // Right-clicked on b.md (index 1) → to-the-right is c.md, d.md.
    expect(w.emitted('close-many')).toEqual([[['c.md', 'd.md']]])
    w.unmount()
  })

  it('"关闭左侧" uses visual order including History and Diff tabs', async () => {
    const tabs = [
      makeTab('a.md'),
      makeTab('history:a', { kind: 'history' }),
      makeTab('b.md'),
      makeTab('diff:b', { kind: 'diff' }),
      makeTab('c.md'),
    ]
    const w = mount(EditorTabs, { props: { tabs, activePath: 'a.md' }, attachTo: document.body })
    await rightClick(w, 'b')
    menuButtons().find((b) => b.textContent === '关闭左侧')!.click()
    await flushPromises()
    expect(w.emitted('close-many')).toEqual([[['a.md', 'history:a']]])
    w.unmount()
  })

  it('"关闭右侧" on the rightmost tab disables the item', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'd')
    const btn = menuButtons().find((b) => b.textContent === '关闭右侧')!
    expect(btn.disabled).toBe(true)
    w.unmount()
  })

  it('"关闭所有" emits close-many with every tab path', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'b')
    menuButtons().find((b) => b.textContent === '关闭所有')!.click()
    await flushPromises()
    expect(w.emitted('close-many')).toEqual([[['a.md', 'b.md', 'c.md', 'd.md']]])
    w.unmount()
  })

  it('keeps Close All available when only one tab is open', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: [makeTab('only.md')], activePath: 'only.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'only')
    const btns = menuButtons()
    expect(btns[0].disabled).toBe(false) // 关闭
    expect(btns[1].disabled).toBe(true)  // 关闭其它
    expect(btns[2].disabled).toBe(true)  // 关闭左侧
    expect(btns[3].disabled).toBe(true)  // 关闭右侧
    expect(btns[4].disabled).toBe(false) // 关闭所有
    btns[4].click()
    await flushPromises()
    expect(w.emitted('close-many')).toEqual([[['only.md']]])
    w.unmount()
  })

  it('closes an open menu when tab order changes', async () => {
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' }, attachTo: document.body })
    await rightClick(w, 'b')
    await w.setProps({ tabs: [TABS[1]!, TABS[0]!, TABS[2]!, TABS[3]!] })
    expect(document.querySelector('.tab-context-menu')).toBeNull()
    expect(w.emitted('close-many')).toBeUndefined()
    w.unmount()
  })

  it('copies and reveals the explicit documentPath without selecting the tab', async () => {
    const history = makeTab('history:internal', { kind: 'history', documentPath: 'inbox/a' })
    const w = mount(EditorTabs, { props: { tabs: [makeTab('a.md'), history], activePath: 'a.md' }, attachTo: document.body })
    await rightClick(w, 'history:internal')
    menuButtons().find((b) => b.textContent === '复制路径')!.click()
    await flushPromises()
    expect(w.emitted('copy-path')).toEqual([['inbox/a']])
    expect(w.emitted('select')).toBeUndefined()
    await rightClick(w, 'history:internal')
    menuButtons().find((b) => b.textContent === '在文件树中显示')!.click()
    await flushPromises()
    expect(w.emitted('reveal-in-tree')).toEqual([['inbox/a']])
    w.unmount()
  })

  it('supports keyboard opening, roving focus, activation, and Escape focus restore', async () => {
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' }, attachTo: document.body })
    const source = w.findAll<HTMLElement>('.tab')[1]!
    source.element.focus()
    await source.trigger('keydown', { key: 'F10', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('关闭')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement?.textContent).toBe('在文件树中显示')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(w.emitted('close')).toEqual([['b.md']])
    expect(document.activeElement).toBe(source.element)

    await source.trigger('keydown', { key: 'ContextMenu' })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.activeElement).toBe(source.element)
    w.unmount()
  })

  it('restores the source tab before a dirty-close confirmation captures focus', async () => {
    const Harness = defineComponent({
      components: { EditorTabs, ConfirmHost },
      setup() {
        const { confirm } = useConfirm()
        return {
          tabs: [makeTab('dirty.md', { save: save({ status: 'dirty', dirty: true }) })],
          onClose: () => confirm('Discard changes?'),
        }
      },
      template: `
        <EditorTabs :tabs="tabs" active-path="dirty.md" @close="onClose" />
        <ConfirmHost />
      `,
    })
    const w = mount(Harness, { attachTo: document.body })
    const source = w.get<HTMLElement>('.tab')
    source.element.focus()
    await source.trigger('keydown', { key: 'F10', shiftKey: true })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(document.querySelector('.tab-context-menu')).toBeNull()
    expect(document.querySelector('.confirm-host')).not.toBeNull()
    document.querySelector<HTMLButtonElement>('.confirm-actions .btn')!.click()
    await flushPromises()
    expect(document.activeElement).toBe(source.element)
    w.unmount()
  })

  it('keeps an overflowed menu open while the menu itself scrolls', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'a')
    const menu = document.querySelector<HTMLElement>('.tab-context-menu')!
    menu.dispatchEvent(new Event('scroll'))
    expect(document.querySelector('.tab-context-menu')).toBe(menu)
    w.unmount()
  })

  it('does not register queued menu listeners after unmount', async () => {
    const documentAdd = vi.spyOn(document, 'addEventListener')
    const windowAdd = vi.spyOn(window, 'addEventListener')
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    documentAdd.mockClear()
    windowAdd.mockClear()
    w.get<HTMLElement>('.tab').element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      clientX: 100,
      clientY: 50,
    }))
    w.unmount()
    await flushPromises()

    expect(documentAdd.mock.calls.some(([type]) => type === 'pointerdown' || type === 'keydown')).toBe(false)
    expect(windowAdd.mock.calls.some(([type]) => type === 'resize' || type === 'scroll')).toBe(false)
    documentAdd.mockRestore()
    windowAdd.mockRestore()
  })

  it('clamps the rendered menu rect to an 8px viewport margin', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('tab-context-menu')) {
        return { x: 0, y: 0, left: 0, top: 0, right: 202, bottom: 302, width: 202, height: 302, toJSON() {} }
      }
      return originalRect.call(this)
    }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' }, attachTo: document.body })
    const tab = w.find('.tab')
    await tab.trigger('contextmenu', { clientX: 490, clientY: 390 })
    await flushPromises()
    const menu = document.querySelector<HTMLElement>('.tab-context-menu')!
    expect(parseInt(menu.style.left, 10)).toBe(290)
    expect(parseInt(menu.style.top, 10)).toBe(90)
    w.unmount()
    HTMLElement.prototype.getBoundingClientRect = originalRect
  })

  it('dismisses the menu after a menu item is clicked', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'a')
    expect(document.querySelector('.tab-context-menu')).not.toBeNull()
    menuButtons()[0].click()  // 关闭
    await w.vm.$nextTick()
    await flushPromises()
    expect(document.querySelector('.tab-context-menu')).toBeNull()
    w.unmount()
  })
})

describe('EditorTabs workspace reordering', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
  })

  async function drag(
    wrapper: ReturnType<typeof mount>,
    sourceIndex: number,
    targetIndex: number,
    side: 'before' | 'after',
  ) {
    const transfer = new TestDataTransfer() as unknown as DataTransfer
    const source = wrapper.findAll('.tab')[sourceIndex]
    const target = wrapper.findAll('.tab')[targetIndex]
    vi.spyOn(target.element, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 200,
      top: 0,
      bottom: 36,
      width: 100,
      height: 36,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    await source.trigger('dragstart', { dataTransfer: transfer })
    await target.trigger('dragover', {
      dataTransfer: transfer,
      clientX: side === 'before' ? 120 : 180,
    })
    await target.trigger('drop', {
      dataTransfer: transfer,
      clientX: side === 'before' ? 120 : 180,
    })
    return { source, target, transfer }
  }

  it.each([
    [1, 0, 'before', ['b.md', 'a.md', 'c.md', 'd.md']],
    [1, 2, 'after', ['a.md', 'c.md', 'b.md', 'd.md']],
    [3, 0, 'before', ['d.md', 'a.md', 'b.md', 'c.md']],
    [0, 3, 'after', ['b.md', 'c.md', 'd.md', 'a.md']],
  ] as const)('emits a complete pointer order for drag %i → %i %s', async (
    source,
    target,
    side,
    orderedIds,
  ) => {
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' } })
    await drag(w, source, target, side)
    expect(w.emitted('reorder')).toEqual([[{
      orderedIds,
      movedId: TABS[source].id,
      input: 'pointer',
    }]])
    expect(w.emitted('select')).toBeUndefined()
    expect(w.emitted('close')).toBeUndefined()
    expect(w.findAll('.dragging')).toHaveLength(0)
    expect(w.findAll('.drop-before, .drop-after')).toHaveLength(0)
    w.unmount()
  })

  it('does not emit for the same position, blank, external, or stale drops', async () => {
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' } })
    await drag(w, 1, 2, 'before')
    expect(w.emitted('reorder')).toBeUndefined()

    const external = new TestDataTransfer() as unknown as DataTransfer
    external.setData('text/plain', 'b.md')
    await w.findAll('.tab')[1].trigger('dragover', { dataTransfer: external, clientX: 100 })
    await w.findAll('.tab')[1].trigger('drop', { dataTransfer: external, clientX: 100 })
    expect(w.emitted('reorder')).toBeUndefined()

    const stale = new TestDataTransfer() as unknown as DataTransfer
    await w.findAll('.tab')[1].trigger('dragstart', { dataTransfer: stale })
    await w.setProps({ tabs: TABS.filter((tab) => tab.id !== 'd.md') })
    await w.findAll('.tab')[0].trigger('drop', { dataTransfer: stale })
    expect(w.emitted('reorder')).toBeUndefined()
    w.unmount()
  })

  it('shows drag/drop classes, closes tooltip and menu, and suppresses the synthetic click', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await w.findAll('.tab')[1].trigger('mouseenter')
    await rightClick(w, 'b')
    expect(document.querySelector('.tab-context-menu')).not.toBeNull()
    const transfer = new TestDataTransfer() as unknown as DataTransfer
    await w.findAll('.tab')[1].trigger('dragstart', { dataTransfer: transfer })
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    expect(document.querySelector('.tab-context-menu')).toBeNull()
    expect(w.findAll('.tab')[1].classes()).toContain('dragging')
    vi.spyOn(w.findAll('.tab')[0].element, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 100, top: 0, bottom: 36, width: 100, height: 36, x: 0, y: 0,
      toJSON: () => ({}),
    })
    await w.findAll('.tab')[0].trigger('dragover', { dataTransfer: transfer, clientX: 10 })
    expect(w.findAll('.tab')[0].classes()).toContain('drop-before')
    await w.findAll('.tab')[0].trigger('drop', { dataTransfer: transfer, clientX: 10 })
    await w.findAll('.tab')[1].trigger('click')
    expect(w.emitted('select')).toBeUndefined()
    w.unmount()
  })

  it.each([
    ['ArrowLeft', 'b.md', ['b.md', 'a.md', 'c.md', 'd.md'], 1],
    ['ArrowRight', 'b.md', ['a.md', 'c.md', 'b.md', 'd.md'], 3],
  ] as const)('supports Alt+Shift+%s and announces the move', async (
    key,
    movedId,
    orderedIds,
    position,
  ) => {
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' } })
    const row = w.find(`[data-tab-id="${movedId}"]`)
    await row.trigger('keydown', { key, altKey: true, shiftKey: true })
    await nextTick()
    expect(w.emitted('reorder')).toEqual([[{ orderedIds, movedId, input: 'keyboard' }]])
    expect(w.emitted('select')).toBeUndefined()
    expect(w.find('[aria-live="polite"]').text()).toContain(`第 ${position} 个`)
    w.unmount()
  })

  it('does nothing at keyboard boundaries and supports History/Diff IDs', async () => {
    const tabs = [
      makeTab('history:a', { kind: 'history', title: 'History A' }),
      makeTab('diff:b', { kind: 'diff', title: 'Diff B' }),
    ]
    const w = mount(EditorTabs, { props: { tabs, activePath: tabs[0].id } })
    await w.findAll('.tab')[0].trigger('keydown', {
      key: 'ArrowLeft', altKey: true, shiftKey: true,
    })
    expect(w.emitted('reorder')).toBeUndefined()
    await w.findAll('.tab')[1].trigger('keydown', {
      key: 'ArrowLeft', altKey: true, shiftKey: true,
    })
    expect(w.emitted('reorder')?.[0]).toEqual([{
      orderedIds: ['diff:b', 'history:a'],
      movedId: 'diff:b',
      input: 'keyboard',
    }])
    w.unmount()
  })

  it('auto-scrolls the real tab strip at both edges with one RAF loop and stops on dragend', async () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrame = 1
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrame++
      callbacks.set(id, callback)
      return id
    })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      callbacks.delete(id)
    })
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' } })
    const strip = w.find('.tabs').element as HTMLElement
    strip.scrollLeft = 40
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 300, top: 0, bottom: 36, width: 300, height: 36, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const target = w.findAll('.tab')[2]
    vi.spyOn(target.element, 'getBoundingClientRect').mockReturnValue({
      left: 200, right: 300, top: 0, bottom: 36, width: 100, height: 36, x: 200, y: 0,
      toJSON: () => ({}),
    })
    const transfer = new TestDataTransfer() as unknown as DataTransfer
    await w.findAll('.tab')[1].trigger('dragstart', { dataTransfer: transfer })
    await target.trigger('dragover', { dataTransfer: transfer, clientX: 295 })
    await target.trigger('dragover', { dataTransfer: transfer, clientX: 295 })
    expect(request).toHaveBeenCalledTimes(1)
    const rightFrame = [...callbacks.values()][0]
    callbacks.clear()
    rightFrame(0)
    expect(strip.scrollLeft).toBe(48)

    await target.trigger('dragover', { dataTransfer: transfer, clientX: 2 })
    const leftFrame = [...callbacks.values()].at(-1)!
    callbacks.clear()
    leftFrame(0)
    expect(strip.scrollLeft).toBe(40)

    await w.findAll('.tab')[1].trigger('dragend', { dataTransfer: transfer })
    expect(cancel).toHaveBeenCalled()
    w.unmount()
    request.mockRestore()
    cancel.mockRestore()
  })

  it('prevents the close button from becoming a drag source', async () => {
    const w = mount(EditorTabs, { props: { tabs: TABS, activePath: 'a.md' } })
    const event = new Event('dragstart', { bubbles: true, cancelable: true })
    const transfer = new TestDataTransfer()
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    w.find('.tab-close').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(transfer.types).toEqual([])
    expect(w.findAll('.dragging')).toHaveLength(0)
    w.unmount()
  })
})

describe('EditorTabs (existing behavior)', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
  })

  it('emits select on click and close on × / middle-click', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('click')
    expect(w.emitted('select')).toEqual([['b.md']])
    await tab.find('.tab-close').trigger('click')
    expect(w.emitted('close')).toEqual([['b.md']])
    await tab.trigger('auxclick', { button: 1 })
    expect(w.emitted('close')?.[1]).toEqual(['b.md'])
    w.unmount()
  })

  it('renders a read-only history presentation tab without a dirty marker', () => {
    const historyTab = makeTab('history:inbox/redis', {
      label: 'Redis Notes (History)',
      title: 'Redis Notes',
      kind: 'history',
    })
    const w = mount(EditorTabs, {
      props: { tabs: [historyTab], activePath: historyTab.id },
    })

    expect(w.get('.tab').classes()).toContain('history')
    expect(w.get('.tab-title').text()).toBe('Redis Notes (History)')
    expect(w.find('.tab-dirty-indicator').exists()).toBe(false)
    expect(w.find('.tab-status-indicator').exists()).toBe(false)
  })

  it('renders a dedicated comparison presentation tab', () => {
    const diffTab = makeTab('diff:inbox/redis', {
      label: 'Redis Notes (Diff)',
      title: 'Redis Notes',
      kind: 'diff',
    })
    const wrapper = mount(EditorTabs, {
      props: { tabs: [diffTab], activePath: diffTab.id },
    })

    expect(wrapper.get('.tab').classes()).toContain('diff')
    expect(wrapper.get('.tab-title').text()).toBe('Redis Notes (Diff)')
    expect(wrapper.find('.tab-dirty-indicator').exists()).toBe(false)
    expect(wrapper.find('.tab-status-indicator').exists()).toBe(false)
  })

  it('keeps dirty and in-flight semantics visible while saving', () => {
    useI18n().setLocale('en')
    const saving = makeTab('saving.md', {
      save: save({ status: 'saving', dirty: true, inFlight: true }),
    })
    const savingDirty = makeTab('newer.md', {
      save: save({
        status: 'saving-dirty',
        dirty: true,
        inFlight: true,
        hasNewerChanges: true,
      }),
    })
    const wrapper = mount(EditorTabs, {
      props: { tabs: [saving, savingDirty], activePath: saving.id },
    })
    const rendered = wrapper.findAll('.tab')

    expect(rendered[0]!.attributes('data-save-status')).toBe('saving')
    expect(rendered[0]!.find('.tab-dirty-indicator').exists()).toBe(true)
    expect(rendered[0]!.find('.tab-status-indicator[data-kind="saving"]').exists()).toBe(true)
    expect(rendered[0]!.attributes('aria-label')).toContain('Saving…')
    expect(rendered[1]!.attributes('data-save-status')).toBe('saving-dirty')
    expect(rendered[1]!.find('.tab-dirty-indicator[data-newer-changes="true"]').exists()).toBe(true)
    expect(rendered[1]!.find('.tab-status-indicator[data-kind="saving"]').exists()).toBe(true)
    expect(rendered[1]!.attributes('aria-label')).toContain('newer changes pending')
  })

  it('preserves dirty markers for error, offline, and external documents', () => {
    const tabs = (['error', 'offline', 'external'] as const).map((status) => makeTab(`${status}.md`, {
      save: save({ status, dirty: true, retryable: status !== 'external', attention: true }),
    }))
    const wrapper = mount(EditorTabs, { props: { tabs, activePath: tabs[0]!.id } })

    for (let i = 0; i < tabs.length; i++) {
      const rendered = wrapper.findAll('.tab')[i]!
      // The dirty buffer marker MUST stay visible next to the status
      // indicator — this is the regression that motivated the split
      // (the old single `.tab-dot` let the status color overwrite the
      // dirty fill, making `external + dirty` indistinguishable from
      // `external + clean`).
      expect(rendered.find('.tab-dirty-indicator').exists()).toBe(true)
      expect(rendered.find(`.tab-status-indicator[data-kind="${tabs[i]!.save.status}"]`).exists()).toBe(true)
      expect(rendered.classes()).toContain('save-attention')
    }
  })

  it('keeps per-document presentation independent and excludes read-only tabs', () => {
    useI18n().setLocale('en')
    const tabs = [
      makeTab('a.md', { save: save({ status: 'saving', dirty: true, inFlight: true }) }),
      makeTab('b.md', { save: save({ status: 'dirty', dirty: true }) }),
      makeTab('c.md', { save: save({ status: 'error', dirty: true, retryable: true, attention: true }) }),
      makeTab('history:a', { kind: 'history', save: save() }),
      makeTab('diff:a', { kind: 'diff', save: save() }),
    ]
    const wrapper = mount(EditorTabs, { props: { tabs, activePath: 'a.md' } })
    const rendered = wrapper.findAll('.tab')

    expect(rendered.slice(0, 3).map((item) => item.attributes('data-save-status')))
      .toEqual(['saving', 'dirty', 'error'])
    expect(rendered[3]!.attributes('data-save-status')).toBeUndefined()
    expect(rendered[4]!.attributes('data-save-status')).toBeUndefined()
    expect(rendered[3]!.attributes('aria-label')).not.toContain('Idle')
    expect(rendered[4]!.attributes('aria-label')).not.toContain('Idle')
    expect(rendered[3]!.find('.tab-dirty-indicator').exists()).toBe(false)
    expect(rendered[4]!.find('.tab-dirty-indicator').exists()).toBe(false)
  })

  it('uses roving tabindex and can restore focus to a workspace tab', () => {
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'b.md' },
      attachTo: document.body,
    })
    const tabElements = wrapper.findAll<HTMLElement>('[role="tab"]')
    expect(tabElements.map((tab) => tab.attributes('tabindex'))).toEqual(['-1', '0', '-1', '-1'])

    wrapper.vm.focusTab('b.md')
    expect(document.activeElement).toBe(tabElements[1]!.element)
    wrapper.unmount()
  })
})

describe('EditorTabs tooltip lifecycle', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
    document.querySelectorAll('.tab-tooltip').forEach((el) => el.remove())
  })

  it('does not render the tooltip until the user hovers or focuses a tab', () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    w.unmount()
  })

  it('shows the tooltip on hover with title, full path, status, and operation hint', async () => {
    useI18n().setLocale('zh')
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')
    expect(tooltip).not.toBeNull()
    expect(tooltip!.querySelector('.tab-tooltip-title')!.textContent).toBe('b')
    expect(tooltip!.querySelector('.tab-tooltip-path')!.textContent).toContain('b.md')
    expect(tooltip!.querySelector('.tab-tooltip-path')!.textContent).toContain('路径：')
    expect(tooltip!.querySelector('.tab-tooltip-status')!.textContent).toContain('已保存')
    expect(tooltip!.querySelector('.tab-tooltip-status')!.textContent).toContain('状态：')
    expect(tooltip!.querySelector('.tab-tooltip-hint')!.textContent).toBe('中键关闭 · 右键打开菜单')
    w.unmount()
  })

  it('hides the tooltip on mouseleave', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).not.toBeNull()
    await tab.trigger('mouseleave')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    w.unmount()
  })

  it('shows the tooltip on focus and hides on blur', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')! as unknown as { element: HTMLElement, trigger: (event: string) => Promise<void> }
    await tab.element.focus()
    await tab.trigger('focusin')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).not.toBeNull()
    await tab.trigger('focusout')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    w.unmount()
  })

  it('hides the tooltip when Escape is pressed while it is open', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).not.toBeNull()
    await tab.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    w.unmount()
  })

  it('hides the tooltip when the active tab switches to a different one', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).not.toBeNull()
    await w.setProps({ activePath: 'c.md' })
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    w.unmount()
  })

  it('hides the tooltip when the tab is closed', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).not.toBeNull()
    // Parent removes the tab by changing props.
    await w.setProps({ tabs: TABS.filter((t) => t.id !== 'b.md'), activePath: 'a.md' })
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    w.unmount()
  })

  it('hides the tooltip when contextmenu is opened and renders the menu', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).not.toBeNull()
    await tab.trigger('contextmenu', { clientX: 100, clientY: 50 })
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    expect(document.querySelector('.tab-context-menu')).not.toBeNull()
    w.unmount()
  })

  it('shows only one tooltip at a time across the tab strip', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tabs = w.findAll('.tab')
    await tabs[0]!.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelectorAll('.tab-tooltip').length).toBe(1)
    await tabs[1]!.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelectorAll('.tab-tooltip').length).toBe(1)
    expect(document.querySelector('.tab-tooltip-title')!.textContent).toBe('b')
    w.unmount()
  })

  it('does not repeat the path in the tooltip when the title equals the path basename', async () => {
    useI18n().setLocale('zh')
    const w = mount(EditorTabs, {
      props: {
        tabs: [makeTab('inbox/test-document-1.md', { title: 'test-document-1' })],
        activePath: 'inbox/test-document-1.md',
      },
      attachTo: document.body,
    })
    const tab = w.find('.tab')
    await tab.trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    const title = tooltip.querySelector('.tab-tooltip-title')!.textContent
    const path = tooltip.querySelector('.tab-tooltip-path')
    // When the title already shows the basename and the path matches
    // the title, the path line is suppressed so we never show the
    // same string twice.
    if (path) {
      expect(path.textContent).not.toBe(title)
      expect(title).not.toBe(path.textContent)
    }
    w.unmount()
  })

  it('keeps the tooltip within the viewport for a long path', async () => {
    const longPath = 'inbox/very-long-path-that-clearly-exceeds-the-viewport-width/document.md'
    const longTab = makeTab(longPath, { title: '' })
    const w = mount(EditorTabs, {
      props: { tabs: [longTab], activePath: longPath },
      attachTo: document.body,
    })
    const tab = w.find('.tab')
    await tab.trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector<HTMLElement>('.tab-tooltip')!
    const left = parseInt(tooltip.style.left || '0', 10)
    const width = parseInt(tooltip.style.maxWidth || '0', 10)
    expect(left + width).toBeLessThanOrEqual(window.innerWidth)
    expect(left).toBeGreaterThanOrEqual(0)
    w.unmount()
  })
})

describe('EditorTabs mouse behaviors', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
    document.querySelectorAll('.tab-tooltip').forEach((el) => el.remove())
  })

  it('left-click selects the tab and emits select', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('click')
    expect(w.emitted('select')).toEqual([['b.md']])
    expect(w.emitted('close')).toBeUndefined()
    w.unmount()
  })

  it('middle-click emits close once', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.trigger('auxclick', { button: 1 })
    expect(w.emitted('close')).toEqual([['b.md']])
    w.unmount()
  })

  it('right-click does not close the tab and opens the existing menu', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'b')
    expect(w.emitted('close')).toBeUndefined()
    expect(document.querySelector('.tab-context-menu')).not.toBeNull()
    w.unmount()
  })

  it('close button still calls the existing close function', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await tab.find('.tab-close').trigger('click')
    expect(w.emitted('close')).toEqual([['b.md']])
    w.unmount()
  })
})

describe('EditorTabs ARIA', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
    document.querySelectorAll('.tab-tooltip').forEach((el) => el.remove())
  })

  it('uses user-readable aria-label for each status', async () => {
    useI18n().setLocale('zh')
    const tabs: WorkspaceTab[] = [
      makeTab('a.md', { save: save({ status: 'idle' }) }),
      makeTab('b.md', { save: save({ status: 'saved' }) }),
      makeTab('c.md', { save: save({ status: 'dirty', dirty: true }) }),
      makeTab('d.md', { save: save({ status: 'saving', dirty: true, inFlight: true }) }),
      makeTab('e.md', { save: save({ status: 'saving-dirty', dirty: true, inFlight: true, hasNewerChanges: true }) }),
      makeTab('f.md', { save: save({ status: 'error', dirty: true, retryable: true, attention: true }) }),
      makeTab('g.md', { save: save({ status: 'offline', dirty: true, retryable: true, attention: true }) }),
      makeTab('h.md', { save: save({ status: 'external', dirty: true, attention: true }) }),
    ]
    const w = mount(EditorTabs, { props: { tabs, activePath: 'a.md' } })
    const rendered = w.findAll('.tab')
    // New format (round-3): "<displayTitle>，<statusText>" — no
    // documentTitle (these fixtures use title=path so the documentTitle
    // line is suppressed).
    expect(rendered[0]!.attributes('aria-label')).toBe('a，已保存')
    expect(rendered[1]!.attributes('aria-label')).toBe('b，已保存')
    expect(rendered[2]!.attributes('aria-label')).toBe('c，未保存')
    expect(rendered[3]!.attributes('aria-label')).toBe('d，保存中…')
    expect(rendered[4]!.attributes('aria-label')).toBe('e，保存中…仍有较新修改')
    expect(rendered[5]!.attributes('aria-label')).toBe('f，保存失败')
    expect(rendered[6]!.attributes('aria-label')).toBe('g，离线，等待保存')
    expect(rendered[7]!.attributes('aria-label')).toBe('h，检测到外部文件变化')
    w.unmount()
  })

  it('aria-describedby is only present while the tooltip is visible', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const tab = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    expect(tab.attributes('aria-describedby')).toBeUndefined()
    await tab.trigger('mouseenter')
    await flushPromises()
    expect(tab.attributes('aria-describedby')).toBe('tab-tooltip-b_md')
    await tab.trigger('mouseleave')
    await flushPromises()
    expect(tab.attributes('aria-describedby')).toBeUndefined()
    w.unmount()
  })

  it('history and diff tabs do not include save status in their aria-label', () => {
    const tabs = [
      makeTab('history:a', {
        kind: 'history',
        label: 'Redis (History)',
        title: 'Redis (History)',
        save: save(),
      }),
      makeTab('diff:a', {
        kind: 'diff',
        label: 'Redis (Diff)',
        title: 'Redis (Diff)',
        save: save(),
      }),
    ]
    const w = mount(EditorTabs, {
      props: { tabs, activePath: tabs[0]!.id },
    })
    const rendered = w.findAll('.tab')
    expect(rendered[0]!.attributes('aria-label')).toBe('Redis (History)')
    expect(rendered[1]!.attributes('aria-label')).toBe('Redis (Diff)')
    // Save-status words must NOT appear in the history/diff aria-label.
    expect(rendered[0]!.attributes('aria-label')).not.toContain('已保存')
    expect(rendered[1]!.attributes('aria-label')).not.toContain('已保存')
  })

  it('history and diff tabs do not display a save status in the tooltip', async () => {
    useI18n().setLocale('zh')
    const tabs = [
      makeTab('history:a', {
        kind: 'history',
        label: 'Redis (History)',
        title: 'Redis (History)',
      }),
    ]
    const w = mount(EditorTabs, {
      props: { tabs, activePath: tabs[0]!.id },
      attachTo: document.body,
    })
    const tab = w.find('.tab')
    await tab.trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    expect(tooltip.querySelector('.tab-tooltip-title')!.textContent).toBe('Redis (History)')
    expect(tooltip.querySelector('.tab-tooltip-status')).toBeNull()
    w.unmount()
  })
})

describe('EditorTabs — round-2 regression tests', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
    document.querySelectorAll('.tab-tooltip').forEach((el) => el.remove())
  })

  // --- P1: path appears only once even when the upstream mapping
  // produces a title that happens to include the path. The EditorTabs
  // contract is that `title` is the pure document title and `id` is
  // the full path — the presentation module derives displayTitle and
  // fullPath independently and the tooltip suppresses the path line
  // when it would just duplicate the title. ----------------
  it('renders a real VaultView-shaped document WorkspaceTab without repeating the path', async () => {
    useI18n().setLocale('zh')
    // Mirror the VaultView mapping exactly: id = full path, title =
    // pure title (or path fallback), label = basename.
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: 'inbox/test-document-1', // title fallback to path
    })
    const w = mount(EditorTabs, {
      props: { tabs: [tab], activePath: tab.id },
      attachTo: document.body,
    })
    await w.find('.tab').trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    const title = tooltip.querySelector('.tab-tooltip-title')!.textContent!
    const pathEl = tooltip.querySelector('.tab-tooltip-path')
    // The tab strip itself must show only the basename.
    expect(w.find('.tab-title').text()).toBe('test-document-1')
    // The tooltip title is the basename; the full path appears at
    // most once, never as the title.
    expect(title).toBe('test-document-1')
    if (pathEl) {
      // The full path is shown at most once and never as the title.
      const occurrences = (tooltip.textContent ?? '').split('inbox/test-document-1').length - 1
      expect(occurrences).toBe(1)
    }
    w.unmount()
  })

  it('renders a Chinese title alongside the path without duplicating either', async () => {
    useI18n().setLocale('zh')
    const tab = makeTab('inbox/test-document-1', {
      label: '测试列表',
      title: '测试列表',
    })
    const w = mount(EditorTabs, {
      props: { tabs: [tab], activePath: tab.id },
      attachTo: document.body,
    })
    expect(w.find('.tab-title').text()).toBe('测试列表')
    await w.find('.tab').trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    expect(tooltip.querySelector('.tab-tooltip-title')!.textContent).toBe('测试列表')
    expect(tooltip.querySelector('.tab-tooltip-path')!.textContent).toContain('inbox/test-document-1')
    w.unmount()
  })

  // --- P1: dirty + error/offline/external indicators both visible.
  it('shows the dirty marker AND the status indicator together for error/offline/external', () => {
    const tabs = (['error', 'offline', 'external'] as const).map((status) =>
      makeTab(`${status}-combined.md`, {
        save: save({ status, dirty: true, retryable: status !== 'external', attention: true }),
      }),
    )
    const w = mount(EditorTabs, { props: { tabs, activePath: tabs[0]!.id } })
    for (const t of tabs) {
      const row = w.findAll('.tab').find((r) => r.attributes('data-tab-id') === t.id)!
      expect(row.find('.tab-dirty-indicator').exists()).toBe(true)
      expect(row.find(`.tab-status-indicator[data-kind="${t.save.status}"]`).exists()).toBe(true)
      // The two are siblings — independent DOM elements, not nested.
      const dirty = row.find('.tab-dirty-indicator').element
      const status = row.find(`.tab-status-indicator[data-kind="${t.save.status}"]`).element
      expect(dirty).not.toBe(status)
    }
    w.unmount()
  })

  // --- P2: tooltip id cleanup when the parent removes the tab.
  it('does not auto-revive a tooltip when the same id reappears later', async () => {
    const initial = TABS
    const w = mount(EditorTabs, {
      props: { tabs: initial, activePath: 'a.md' },
      attachTo: document.body,
    })
    const rowB = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await rowB.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')!.getAttribute('id')).toBe('tab-tooltip-b_md')
    // Parent removes b.md; activePath stays a.md so no other lifecycle
    // path closes the tooltip.
    await w.setProps({ tabs: TABS.filter((t) => t.id !== 'b.md'), activePath: 'a.md' })
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    // Re-add b.md without any hover/focus — tooltip must stay closed.
    await w.setProps({ tabs: [...TABS], activePath: 'a.md' })
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).toBeNull()
    // Hovering b.md again opens it normally.
    const rowBAfter = w.findAll('.tab').find((t) => t.find('.tab-title').text() === 'b')!
    await rowBAfter.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip')).not.toBeNull()
    w.unmount()
  })

  // --- P2: close button has no native title attribute (so we don't
  // get two tooltips on hover). The aria-label covers accessibility.
  it('does not set a native title attribute on the close button', () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
    })
    const closeButtons = w.findAll('.tab-close')
    for (const btn of closeButtons) {
      expect(btn.attributes('title')).toBeUndefined()
      expect(btn.attributes('aria-label')).toBeTruthy()
    }
    w.unmount()
  })

  it('does not set a native title attribute on the tab row itself', () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
    })
    for (const row of w.findAll('.tab')) {
      expect(row.attributes('title')).toBeUndefined()
    }
    w.unmount()
  })

  // --- P2: tooltip viewport clamp uses actual rendered width.
  it('keeps the tooltip fully inside the viewport for an oversize path', async () => {
    const longPath = 'inbox/very-long-path-that-definitely-exceeds-the-viewport-width/document.md'
    const w = mount(EditorTabs, {
      props: {
        tabs: [makeTab(longPath, { title: '' })],
        activePath: longPath,
      },
      attachTo: document.body,
    })
    const row = w.find('.tab')
    await row.trigger('mouseenter')
    // Allow the post-render clamp (nextTick + getBoundingClientRect) to run.
    await flushPromises()
    await flushPromises()
    const tooltip = document.querySelector<HTMLElement>('.tab-tooltip')!
    const rect = tooltip.getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 0.5)
    w.unmount()
  })

  it('keeps the tooltip inside the viewport when anchored at the right edge', async () => {
    const shortPath = 'a.md'
    const w = mount(EditorTabs, {
      props: {
        tabs: [makeTab(shortPath, { title: '' })],
        activePath: shortPath,
      },
      attachTo: document.body,
    })
    // Force the anchor near the right edge of the viewport.
    const row = w.find<HTMLElement>('.tab').element
    row.getBoundingClientRect = () => ({
      left: window.innerWidth - 20,
      right: window.innerWidth - 1,
      top: 0,
      bottom: 36,
      width: 19,
      height: 36,
      x: window.innerWidth - 20,
      y: 0,
      toJSON: () => '',
    })
    await row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    await flushPromises()
    await flushPromises()
    const tooltip = document.querySelector<HTMLElement>('.tab-tooltip')!
    const rect = tooltip.getBoundingClientRect()
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 0.5)
    expect(rect.left).toBeGreaterThanOrEqual(0)
    w.unmount()
  })

  // --- history/diff keep the original title semantics; the change to
  // VaultView must not strip the document title from their aria-label.
  it('history and diff tabs continue to surface their document title', () => {
    useI18n().setLocale('zh')
    const tabs = [
      makeTab('history:redis', { kind: 'history', label: 'Redis (历史)', title: 'Redis' }),
      makeTab('diff:redis', { kind: 'diff', label: 'Redis (差异)', title: 'Redis' }),
    ]
    const w = mount(EditorTabs, { props: { tabs, activePath: tabs[0]!.id } })
    const rendered = w.findAll('.tab')
    expect(rendered[0]!.attributes('aria-label')).toBe('Redis (历史)')
    expect(rendered[1]!.attributes('aria-label')).toBe('Redis (差异)')
    expect(rendered[0]!.find('.tab-dirty-indicator').exists()).toBe(false)
    expect(rendered[0]!.find('.tab-status-indicator').exists()).toBe(false)
  })
})

describe('EditorTabs — round-4 regression (title is primary; basename fallback)', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
    document.querySelectorAll('.tab-tooltip').forEach((el) => el.remove())
  })

  // 1. tab.title='测试文档', path='inbox/test-document-1'
  //    tab strip = 测试文档   (metadata title wins)
  //    tooltip 文件名 = test-document-1   (the basename is the secondary line)
  //    tooltip 路径 = inbox/test-document-1
  it('scenario 1 — Chinese title takes the strip; filename goes to the tooltip', async () => {
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: '测试文档',
    })
    const w = mount(EditorTabs, {
      props: { tabs: [tab], activePath: tab.id },
      attachTo: document.body,
    })
    // Strip shows the metadata title.
    expect(w.find('.tab-title').text()).toBe('测试文档')
    await w.find('.tab').trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    expect(tooltip.querySelector('.tab-tooltip-title')!.textContent).toBe('测试文档')
    expect(tooltip.querySelector('.tab-tooltip-filename')!.textContent).toContain('test-document-1')
    expect(tooltip.querySelector('.tab-tooltip-filename')!.textContent).toContain('文件名：')
    expect(tooltip.querySelector('.tab-tooltip-path')!.textContent).toContain('inbox/test-document-1')
    expect(tooltip.querySelector('.tab-tooltip-path')!.textContent).toContain('路径：')
    // aria-label includes the title and the filename separately.
    expect(w.find('.tab').attributes('aria-label')).toContain('测试文档')
    expect(w.find('.tab').attributes('aria-label')).toContain('test-document-1')
    w.unmount()
  })

  // 2. tab.title equals the full path → useless as a display title.
  //    Strip falls back to the basename; the basename is the title,
  //    so the tooltip filename line is suppressed.
  it('scenario 2 — title equals the path; strip falls back to basename', async () => {
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: 'inbox/test-document-1',
    })
    const w = mount(EditorTabs, {
      props: { tabs: [tab], activePath: tab.id },
      attachTo: document.body,
    })
    expect(w.find('.tab-title').text()).toBe('test-document-1')
    await w.find('.tab').trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    expect(tooltip.querySelector('.tab-tooltip-filename')).toBeNull()
    expect(tooltip.querySelector('.tab-tooltip-path')).not.toBeNull()
    // The full path appears at most once in the tooltip (in the
    // "路径：" line). It MUST NOT be the title.
    const occurrences = (tooltip.textContent ?? '').split('inbox/test-document-1').length - 1
    expect(occurrences).toBe(1)
    w.unmount()
  })

  // 3. tab.title equals the basename → useless as a display title.
  //    Strip falls back to the basename; tooltip filename line
  //    suppressed (it would duplicate).
  it('scenario 3 — title equals the basename; tooltip filename line suppressed', async () => {
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: 'test-document-1',
    })
    const w = mount(EditorTabs, {
      props: { tabs: [tab], activePath: tab.id },
      attachTo: document.body,
    })
    expect(w.find('.tab-title').text()).toBe('test-document-1')
    await w.find('.tab').trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-filename')).toBeNull()
    w.unmount()
  })

  // 4. Empty title — strip still shows the basename; tooltip filename
  //    line suppressed because the strip already carries it.
  it('scenario 4 — empty title; strip still shows the basename', async () => {
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: '',
    })
    const w = mount(EditorTabs, {
      props: { tabs: [tab], activePath: tab.id },
      attachTo: document.body,
    })
    expect(w.find('.tab-title').text()).toBe('test-document-1')
    await w.find('.tab').trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-filename')).toBeNull()
    w.unmount()
  })

  // 5. Each tab carries its own metadata title verbatim. Strip
  //    languages come from the metadata, with fallback to basename
  //    only when the title is missing.
  it('scenario 5 — strip honors each document’s own title verbatim', async () => {
    useI18n().setLocale('zh')
    const tabs = [
      makeTab('inbox/a.md', { label: 'a', title: '中文标题' }),
      makeTab('inbox/b.md', { label: 'b', title: 'English Title' }),
      makeTab('inbox/c.md', { label: 'c', title: '' }),
    ]
    const w = mount(EditorTabs, {
      props: { tabs, activePath: tabs[0]!.id },
      attachTo: document.body,
    })
    const stripTitles = w.findAll('.tab-title').map((el) => el.text())
    // Strip: tab a and b use their metadata titles; c falls back to
    // the basename.
    expect(stripTitles).toEqual(['中文标题', 'English Title', 'c'])
    // Hover each tab in turn; the tooltip filename line is only
    // shown when the strip is NOT already the basename.
    const tabA = w.findAll('.tab')[0]!
    await tabA.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-filename')!.textContent).toContain('a')
    const tabB = w.findAll('.tab')[1]!
    await tabB.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-filename')!.textContent).toContain('b')
    const tabC = w.findAll('.tab')[2]!
    await tabC.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-filename')).toBeNull()
    w.unmount()
  })

  // 6. History / Diff keep their existing label-based semantics.
  it('scenario 6 — history/diff still use label and never expose filename/path/status', async () => {
    useI18n().setLocale('zh')
    const tabs = [
      makeTab('history:redis', { kind: 'history', label: 'Redis (历史)', title: 'Redis' }),
      makeTab('diff:redis', { kind: 'diff', label: 'Redis (差异)', title: 'Redis' }),
    ]
    const w = mount(EditorTabs, {
      props: { tabs, activePath: tabs[0]!.id },
      attachTo: document.body,
    })
    expect(w.findAll('.tab-title').map((el) => el.text())).toEqual(['Redis (历史)', 'Redis (差异)'])
    await w.findAll('.tab')[0]!.trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    expect(tooltip.querySelector('.tab-tooltip-title')!.textContent).toBe('Redis (历史)')
    expect(tooltip.querySelector('.tab-tooltip-filename')).toBeNull()
    expect(tooltip.querySelector('.tab-tooltip-path')).toBeNull()
    expect(tooltip.querySelector('.tab-tooltip-status')).toBeNull()
    w.unmount()
  })

  // English locale sanity check — separator is comma + space.
  it('English aria-label uses the title + file connectors when title is meaningful', () => {
    useI18n().setLocale('en')
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: 'Test Document',
    })
    const w = mount(EditorTabs, { props: { tabs: [tab], activePath: tab.id } })
    const aria = w.find('.tab').attributes('aria-label')!
    expect(aria).toBe('title Test Document, file test-document-1, Saved')
    w.unmount()
  })

  // The original round-3 must-have: tabs with mixed-language titles
  // do NOT collapse to basenames when the metadata title is present.
  it('mixed-language tabs each show their own metadata title', () => {
    const tabs = [
      makeTab('inbox/a.md', { title: '中文标题' }),
      makeTab('inbox/b.md', { title: 'English Title' }),
      makeTab('inbox/c.md', { title: '' }),
    ]
    const w = mount(EditorTabs, {
      props: { tabs, activePath: tabs[0]!.id },
    })
    const titles = w.findAll('.tab-title').map((el) => el.text())
    expect(titles).toEqual(['中文标题', 'English Title', 'c'])
    w.unmount()
  })

  // Two documents with the same title but different paths both keep
  // the title in the strip and rely on the path line for identity.
  it('same-title different-path tabs both keep the title; paths disambiguate', () => {
    const tabs = [
      makeTab('a/notes.md', { title: 'Notes' }),
      makeTab('b/notes.md', { title: 'Notes' }),
    ]
    const w = mount(EditorTabs, {
      props: { tabs, activePath: tabs[0]!.id },
    })
    expect(w.findAll('.tab-title').map((el) => el.text())).toEqual(['Notes', 'Notes'])
    w.unmount()
  })
})
