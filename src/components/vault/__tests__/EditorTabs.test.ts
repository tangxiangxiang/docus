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
    const tabB = TABS.find((t) => t.id === 'b.md')!
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

describe('EditorTabs — round-3 regression (label vs title split)', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-context-menu').forEach((el) => el.remove())
    document.querySelectorAll('.tab-tooltip').forEach((el) => el.remove())
  })

  // 1. label=test-document-1, title=测试文档, path=inbox/test-document-1
  //    tab strip = test-document-1
  //    tooltip 文档标题 = 测试文档
  //    tooltip 路径 = inbox/test-document-1
  it('scenario 1 — Chinese title becomes documentTitle only; strip shows the basename', async () => {
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: '测试文档',
    })
    const w = mount(EditorTabs, {
      props: { tabs: [tab], activePath: tab.id },
      attachTo: document.body,
    })
    // Strip is the basename regardless of the metadata title.
    expect(w.find('.tab-title').text()).toBe('test-document-1')
    await w.find('.tab').trigger('mouseenter')
    await flushPromises()
    const tooltip = document.querySelector('.tab-tooltip')!
    expect(tooltip.querySelector('.tab-tooltip-title')!.textContent).toBe('test-document-1')
    expect(tooltip.querySelector('.tab-tooltip-document-title')!.textContent).toContain('测试文档')
    expect(tooltip.querySelector('.tab-tooltip-document-title')!.textContent).toContain('文档标题：')
    expect(tooltip.querySelector('.tab-tooltip-path')!.textContent).toContain('inbox/test-document-1')
    expect(tooltip.querySelector('.tab-tooltip-path')!.textContent).toContain('路径：')
    // aria-label includes the documentTitle via the "file" connector.
    expect(w.find('.tab').attributes('aria-label')).toContain('测试文档')
    expect(w.find('.tab').attributes('aria-label')).toContain('test-document-1')
    w.unmount()
  })

  // 2. label=test-document-1, title=inbox/test-document-1, path=inbox/test-document-1
  //    tab strip = test-document-1
  //    no documentTitle line
  //    path appears once
  it('scenario 2 — title equals path; documentTitle line is suppressed', async () => {
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
    expect(tooltip.querySelector('.tab-tooltip-document-title')).toBeNull()
    expect(tooltip.querySelector('.tab-tooltip-path')).not.toBeNull()
    // The full path appears at most once in the tooltip (in the
    // "路径：" line). It MUST NOT be the title.
    const occurrences = (tooltip.textContent ?? '').split('inbox/test-document-1').length - 1
    expect(occurrences).toBe(1)
    w.unmount()
  })

  // 3. label=test-document-1, title=test-document-1
  //    no duplicate documentTitle line
  it('scenario 3 — title equals displayTitle; documentTitle line is suppressed', async () => {
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
    expect(document.querySelector('.tab-tooltip-document-title')).toBeNull()
    w.unmount()
  })

  // 4. title 为空
  //    tab strip 仍显示 test-document-1
  //    no documentTitle line
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
    expect(document.querySelector('.tab-tooltip-document-title')).toBeNull()
    w.unmount()
  })

  // 5. multiple tabs each with a different metadata title.
  it('scenario 5 — strip uniformly uses basenames across mixed-language titles', async () => {
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
    expect(stripTitles).toEqual(['a', 'b', 'c'])
    // Metadata titles appear ONLY in the tooltip, never in the strip.
    expect(stripTitles).not.toContain('中文标题')
    expect(stripTitles).not.toContain('English Title')
    // Hover each tab in turn; documentTitle line only appears for the
    // tabs that actually have a title.
    const tabA = w.findAll('.tab')[0]!
    await tabA.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-document-title')!.textContent)
      .toContain('中文标题')
    const tabB = w.findAll('.tab')[1]!
    await tabB.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-document-title')!.textContent)
      .toContain('English Title')
    const tabC = w.findAll('.tab')[2]!
    await tabC.trigger('mouseenter')
    await flushPromises()
    expect(document.querySelector('.tab-tooltip-document-title')).toBeNull()
    w.unmount()
  })

  // 6. History / Diff keep their existing label-based semantics.
  it('scenario 6 — history/diff still use label and never expose documentTitle', async () => {
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
    expect(tooltip.querySelector('.tab-tooltip-document-title')).toBeNull()
    expect(tooltip.querySelector('.tab-tooltip-path')).toBeNull()
    expect(tooltip.querySelector('.tab-tooltip-status')).toBeNull()
    w.unmount()
  })

  // English locale sanity check — separator is "file" + comma + space.
  it('English aria-label uses the file-connector when documentTitle is present', () => {
    useI18n().setLocale('en')
    const tab = makeTab('inbox/test-document-1', {
      label: 'test-document-1',
      title: 'Test Document',
    })
    const w = mount(EditorTabs, { props: { tabs: [tab], activePath: tab.id } })
    const aria = w.find('.tab').attributes('aria-label')!
    expect(aria).toBe('Test Document, file test-document-1, Saved')
    w.unmount()
  })
})
