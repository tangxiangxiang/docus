// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import EditorTabs from '../EditorTabs.vue'
import type { WorkspaceTab } from '../tabs'
import { useI18n } from '../../../composables/useI18n'
import { deriveDocumentSavePresentation } from '../../../composables/vault/editor-tabs/savePresentation'
import type { DocumentSavePresentation } from '../../../composables/vault/editor-tabs/savePresentation'

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

  it('opens the menu on right-click and renders all four items', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'a')
    const items = menuButtons().map((b) => b.textContent)
    expect(items).toEqual(['关闭', '关闭其它', '关闭右侧', '关闭所有'])
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
    expect(w.emitted('close')).toEqual([['b.md']])
    expect(w.emitted('close-many')).toBeUndefined()
    w.unmount()
  })

  it('"关闭其它" emits close-many with every path except the right-clicked one', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'b')
    menuButtons().find((b) => b.textContent === '关闭其它')!.click()
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
    // Right-clicked on b.md (index 1) → to-the-right is c.md, d.md.
    expect(w.emitted('close-many')).toEqual([[['c.md', 'd.md']]])
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
    expect(w.emitted('close-many')).toEqual([[['a.md', 'b.md', 'c.md', 'd.md']]])
    w.unmount()
  })

  it('disables the three multi-close items when only one tab is open', async () => {
    const w = mount(EditorTabs, {
      props: { tabs: [makeTab('only.md')], activePath: 'only.md' },
      attachTo: document.body,
    })
    await rightClick(w, 'only')
    const btns = menuButtons()
    expect(btns[0].disabled).toBe(false) // 关闭
    expect(btns[1].disabled).toBe(true)  // 关闭其它
    expect(btns[2].disabled).toBe(true)  // 关闭右侧
    expect(btns[3].disabled).toBe(true)  // 关闭所有
    w.unmount()
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
    expect(w.get('.tab-dot').classes()).not.toContain('dirty')
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
    expect(wrapper.get('.tab-dot').classes()).not.toContain('dirty')
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
    expect(rendered[0]!.get('.tab-dot').classes()).toEqual(expect.arrayContaining(['dirty', 'in-flight']))
    expect(rendered[0]!.attributes('aria-label')).toContain('Saving…')
    expect(rendered[1]!.attributes('data-save-status')).toBe('saving-dirty')
    expect(rendered[1]!.get('.tab-dot').classes()).toEqual(expect.arrayContaining(['dirty', 'in-flight', 'newer-changes']))
    expect(rendered[1]!.attributes('aria-label')).toContain('newer changes pending')
  })

  it('preserves dirty markers for error, offline, and external documents', () => {
    const tabs = (['error', 'offline', 'external'] as const).map((status) => makeTab(`${status}.md`, {
      save: save({ status, dirty: true, retryable: status !== 'external', attention: true }),
    }))
    const wrapper = mount(EditorTabs, { props: { tabs, activePath: tabs[0]!.id } })

    for (const rendered of wrapper.findAll('.tab')) {
      expect(rendered.get('.tab-dot').classes()).toContain('dirty')
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
    expect(rendered[3]!.get('.tab-dot').classes()).not.toContain('dirty')
    expect(rendered[4]!.get('.tab-dot').classes()).not.toContain('dirty')
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
    expect(tooltip!.querySelector('.tab-tooltip-path')!.textContent).toBe('b.md')
    expect(tooltip!.querySelector('.tab-tooltip-status')!.textContent).toBe('已保存')
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
    expect(rendered[0]!.attributes('aria-label')).toBe('a 已保存')
    expect(rendered[1]!.attributes('aria-label')).toBe('b 已保存')
    expect(rendered[2]!.attributes('aria-label')).toBe('c 未保存')
    expect(rendered[3]!.attributes('aria-label')).toBe('d 保存中…')
    expect(rendered[4]!.attributes('aria-label')).toBe('e 保存中…仍有较新修改')
    expect(rendered[5]!.attributes('aria-label')).toBe('f 保存失败')
    expect(rendered[6]!.attributes('aria-label')).toBe('g 离线，等待保存')
    expect(rendered[7]!.attributes('aria-label')).toBe('h 检测到外部文件变化')
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
