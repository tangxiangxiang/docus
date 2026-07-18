// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defineComponent,
  h,
  nextTick,
  ref,
  type Ref,
} from 'vue'
import { useWorkspaceTabTooltip } from '../useWorkspaceTabTooltip'

interface TooltipHarness {
  activeId: Ref<string | null>
  tabIds: Ref<readonly string[]>
  suppressed: Ref<boolean>
  tooltipTabId: Readonly<Ref<string | null>>
  tooltipStyle: Readonly<Ref<Readonly<Record<string, string>>>>
  show: (tabId: string, anchor: HTMLElement) => void
}

const mountedWrappers = new Set<{ unmount: () => void }>()
const originalInnerWidth = window.innerWidth

function rect(
  left: number,
  width: number,
  bottom = 36,
): DOMRect {
  return {
    left,
    right: left + width,
    top: 0,
    bottom,
    width,
    height: bottom,
    x: left,
    y: 0,
    toJSON: () => '',
  }
}

function setup(): { api: TooltipHarness, unmount: () => void } {
  let api!: TooltipHarness
  const Comp = defineComponent({
    setup() {
      const activeId = ref<string | null>('a')
      const tabIds = ref<readonly string[]>(['a', 'b'])
      const suppressed = ref(false)
      const tooltip = useWorkspaceTabTooltip({
        activeId,
        tabIds,
        isSuppressed: () => suppressed.value,
      })
      api = {
        activeId,
        tabIds,
        suppressed,
        tooltipTabId: tooltip.tooltipTabId,
        tooltipStyle: tooltip.tooltipStyle,
        show: tooltip.show,
      }
      return () => h('div')
    },
  })
  const wrapper = mount(Comp)
  mountedWrappers.add(wrapper)

  return {
    api,
    unmount: () => {
      if (!mountedWrappers.delete(wrapper)) return
      wrapper.unmount()
    },
  }
}

function anchor(left = 20): HTMLElement {
  const element = document.createElement('button')
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(left, 80))
  return element
}

afterEach(() => {
  for (const wrapper of mountedWrappers) wrapper.unmount()
  mountedWrappers.clear()
  document.querySelectorAll('[id^="tab-tooltip-"]').forEach((element) => element.remove())
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: originalInnerWidth,
  })
  vi.restoreAllMocks()
})

describe('useWorkspaceTabTooltip', () => {
  it('ignores a stale post-render clamp after another tooltip opens', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
    const { api } = setup()
    const firstTooltip = document.createElement('div')
    firstTooltip.id = 'tab-tooltip-a'
    const firstRect = vi.spyOn(firstTooltip, 'getBoundingClientRect')
      .mockReturnValue(rect(0, 280))
    document.body.appendChild(firstTooltip)
    const secondTooltip = document.createElement('div')
    secondTooltip.id = 'tab-tooltip-b'
    const secondRect = vi.spyOn(secondTooltip, 'getBoundingClientRect')
      .mockReturnValue(rect(0, 100))
    document.body.appendChild(secondTooltip)

    api.show('a', anchor(10))
    api.show('b', anchor(40))
    await nextTick()

    expect(api.tooltipTabId.value).toBe('b')
    expect(firstRect).not.toHaveBeenCalled()
    expect(secondRect).toHaveBeenCalledOnce()
  })

  it('hides when activeId changes', async () => {
    const { api } = setup()
    api.show('b', anchor())

    api.activeId.value = 'b'
    await nextTick()

    expect(api.tooltipTabId.value).toBeNull()
  })

  it('hides when the owning tab disappears', async () => {
    const { api } = setup()
    api.show('b', anchor())

    api.tabIds.value = ['a']
    await nextTick()

    expect(api.tooltipTabId.value).toBeNull()
  })

  it('does not show while suppressed', () => {
    const { api } = setup()
    api.suppressed.value = true

    api.show('b', anchor())

    expect(api.tooltipTabId.value).toBeNull()
    expect(api.tooltipStyle.value).toEqual({})
  })

  it('invalidates queued work on unmount', async () => {
    const { api, unmount } = setup()
    const tooltip = document.createElement('div')
    tooltip.id = 'tab-tooltip-b'
    const tooltipRect = vi.spyOn(tooltip, 'getBoundingClientRect')
      .mockReturnValue(rect(0, 100))
    document.body.appendChild(tooltip)

    api.show('b', anchor())
    unmount()
    await nextTick()

    expect(api.tooltipTabId.value).toBeNull()
    expect(tooltipRect).not.toHaveBeenCalled()
  })
})
