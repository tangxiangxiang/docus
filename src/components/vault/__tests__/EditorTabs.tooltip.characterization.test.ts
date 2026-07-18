// @vitest-environment jsdom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { deriveDocumentSavePresentation } from '../../../composables/vault/editor-tabs/savePresentation'
import { useI18n } from '../../../composables/useI18n'
import EditorTabs from '../EditorTabs.vue'
import type { WorkspaceTab } from '../tabs'

function makeTab(id: string): WorkspaceTab {
  return {
    id,
    label: id.endsWith('.md') ? id.slice(0, -3) : id,
    title: id,
    save: deriveDocumentSavePresentation(null),
    kind: 'document',
    documentPath: id,
  }
}

const TABS = [makeTab('a.md'), makeTab('b.md')]
const originalInnerWidth = window.innerWidth

enableAutoUnmount(afterEach)

class TestDataTransfer {
  effectAllowed = 'uninitialized'
  dropEffect = 'none'
  readonly types: string[] = []
  private readonly data = new Map<string, string>()

  setData(type: string, value: string): void {
    if (!this.types.includes(type)) this.types.push(type)
    this.data.set(type, value)
  }

  getData(type: string): string {
    return this.data.get(type) ?? ''
  }
}

function tooltip(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.tab-tooltip')
}

describe('EditorTabs tooltip behavior characterization', () => {
  beforeEach(() => {
    useI18n().setLocale('zh')
    document.querySelectorAll('.tab-tooltip, .tab-context-menu').forEach((el) => el.remove())
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth,
    })
    vi.restoreAllMocks()
  })

  it('shows from hover or focus and hides from mouseleave or blur', async () => {
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const row = wrapper.find<HTMLElement>('[data-tab-id="b.md"]')

    await row.trigger('mouseenter')
    await flushPromises()
    expect(tooltip()?.id).toBe('tab-tooltip-b_md')

    await row.trigger('mouseleave')
    expect(tooltip()).toBeNull()

    row.element.focus()
    await row.trigger('focusin')
    await flushPromises()
    expect(tooltip()?.id).toBe('tab-tooltip-b_md')

    await row.trigger('focusout')
    expect(tooltip()).toBeNull()
  })

  it('hides on Escape', async () => {
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const row = wrapper.find('[data-tab-id="b.md"]')
    await row.trigger('mouseenter')
    await flushPromises()

    await row.trigger('keydown', { key: 'Escape' })

    expect(tooltip()).toBeNull()
  })

  it('hides when the active tab changes', async () => {
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await wrapper.find('[data-tab-id="b.md"]').trigger('mouseenter')
    await flushPromises()

    await wrapper.setProps({ activePath: 'b.md' })

    expect(tooltip()).toBeNull()
  })

  it('hides when its tab is removed and does not revive when the id returns', async () => {
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    await wrapper.find('[data-tab-id="b.md"]').trigger('mouseenter')
    await flushPromises()

    await wrapper.setProps({ tabs: [TABS[0]!] })
    expect(tooltip()).toBeNull()

    await wrapper.setProps({ tabs: [...TABS] })
    expect(tooltip()).toBeNull()
  })

  it('suppresses tooltip display for the duration of a drag', async () => {
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const row = wrapper.find<HTMLElement>('[data-tab-id="b.md"]')
    const dataTransfer = new TestDataTransfer()
    row.element.dispatchEvent(Object.assign(new Event('dragstart', {
      bubbles: true,
      cancelable: true,
    }), { dataTransfer }))
    await nextTick()

    await row.trigger('mouseenter')

    expect(tooltip()).toBeNull()
    row.element.dispatchEvent(new Event('dragend', { bubbles: true }))
  })

  it('uses the rendered tooltip rect for the second viewport clamp', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('tab-tooltip')) {
        const left = Number.parseInt(this.style.left || '0', 10)
        return {
          left,
          right: left + 400,
          top: 44,
          bottom: 100,
          width: 400,
          height: 56,
          x: left,
          y: 44,
          toJSON: () => '',
        }
      }
      return {
        left: 470,
        right: 495,
        top: 0,
        bottom: 36,
        width: 25,
        height: 36,
        x: 470,
        y: 0,
        toJSON: () => '',
      }
    })
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })

    await wrapper.find('[data-tab-id="b.md"]').trigger('mouseenter')
    await flushPromises()
    await flushPromises()

    expect(Number.parseInt(tooltip()!.style.left, 10)).toBe(92)
    expect(Number.parseInt(tooltip()!.style.left, 10) + tooltip()!.getBoundingClientRect().width)
      .toBeLessThanOrEqual(492)
  })

  it('does not apply a queued post-render update after unmount', async () => {
    const tooltipRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    const wrapper = mount(EditorTabs, {
      props: { tabs: TABS, activePath: 'a.md' },
      attachTo: document.body,
    })
    const row = wrapper.find<HTMLElement>('[data-tab-id="b.md"]').element

    row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    wrapper.unmount()
    await nextTick()
    await flushPromises()

    expect(tooltip()).toBeNull()
    expect(tooltipRect.mock.instances.some(
      (element) => (element as HTMLElement).classList.contains('tab-tooltip'),
    ))
      .toBe(false)
  })
})
