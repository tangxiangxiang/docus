// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import VCalendarCompatibilityProbe from './VCalendarCompatibilityProbe.vue'

function installBrowserApiShims(): void {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia
  }

  if (!window.ResizeObserver) {
    window.ResizeObserver = class ResizeObserver {
      observe(): void { /* jsdom has no layout engine */ }
      unobserve(): void { /* jsdom has no layout engine */ }
      disconnect(): void { /* jsdom has no layout engine */ }
    }
  }

  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
    window.cancelAnimationFrame = (handle: number) => window.clearTimeout(handle)
  }
}

function probe(wrapper: VueWrapper) {
  const targetDay = () => wrapper.findAll('.vc-day').find((day) => day.find('[data-date="2026-08-24"]').exists())!
  return {
    root: () => wrapper.get('[data-testid="vcalendar-probe"]'),
    page: () => wrapper.get('[data-testid="vcalendar-probe"]').attributes('data-page'),
    targetDay: () => targetDay().get('[data-date="2026-08-24"]'),
    indicator: () => targetDay().findAll('.vc-dot'),
  }
}

describe('VCalendar exact-stack compatibility probe', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  let consoleWarn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    installBrowserApiShims()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    const output = [...consoleError.mock.calls, ...consoleWarn.mock.calls]
      .flat()
      .map(String)
      .join('\n')
    expect(output).not.toMatch(/dayIndex|Unhandled|TypeError|undefined.*render/i)
    consoleError.mockRestore()
    consoleWarn.mockRestore()
  })

  it('mounts a fixed monthly view with a dot and custom day content', async () => {
    const wrapper = mount(VCalendarCompatibilityProbe)
    await flushPromises()

    expect(wrapper.find('.vc-monthly').exists()).toBe(true)
    expect(wrapper.findAll('[data-date^="2026-08-"]').length).toBeGreaterThanOrEqual(28)
    expect(probe(wrapper).indicator().length).toBe(1)
    expect(wrapper.get('[data-testid="custom-marker"]').text()).toContain('mood-probe')
    wrapper.unmount()
  })

  it('navigates previous and next month through the real component instance', async () => {
    const wrapper = mount(VCalendarCompatibilityProbe)
    await flushPromises()

    await wrapper.get('[data-testid="next-page"]').trigger('click')
    await flushPromises()
    expect(probe(wrapper).page()).toBe('2026-09')

    await wrapper.get('[data-testid="prev-page"]').trigger('click')
    await flushPromises()
    expect(probe(wrapper).page()).toBe('2026-08')

    for (let i = 0; i < 12; i += 1) {
      await wrapper.get('[data-testid="next-page"]').trigger('click')
    }
    await flushPromises()
    expect(probe(wrapper).page()).toBe('2027-08')

    for (let i = 0; i < 12; i += 1) {
      await wrapper.get('[data-testid="prev-page"]').trigger('click')
    }
    await flushPromises()
    expect(probe(wrapper).page()).toBe('2026-08')
    wrapper.unmount()
  })

  it('updates attributes reactively without remounting the Calendar', async () => {
    const wrapper = mount(VCalendarCompatibilityProbe)
    await flushPromises()
    const calendar = wrapper.find('.vc-container').element

    expect(probe(wrapper).indicator().length).toBe(1)
    await wrapper.get('[data-testid="toggle-indicator"]').trigger('click')
    await flushPromises()
    expect(probe(wrapper).indicator().length).toBe(0)
    expect(wrapper.find('.vc-container').element).toBe(calendar)

    await wrapper.get('[data-testid="toggle-indicator"]').trigger('click')
    await flushPromises()
    expect(probe(wrapper).indicator().length).toBe(1)
    wrapper.unmount()
  })

  it('emits a local DiaryDate and customData on day click', async () => {
    const wrapper = mount(VCalendarCompatibilityProbe)
    await flushPromises()

    await probe(wrapper).targetDay().trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="selected-date"]').text()).toBe('2026-08-24')
    expect(wrapper.get('[data-testid="clicked-custom-data"]').text()).toBe('2026-08-24')
    wrapper.unmount()
  })

  it('supports locale, first-day-of-week, masks, light/dark, and remount', async () => {
    const wrapper = mount(VCalendarCompatibilityProbe)
    await flushPromises()
    expect(probe(wrapper).root().attributes('data-locale')).toBe('en-US')
    expect(probe(wrapper).root().attributes('data-first-day-of-week')).toBe('1')
    expect(probe(wrapper).root().attributes('data-theme')).toBe('light')

    await wrapper.get('[data-testid="toggle-locale"]').trigger('click')
    await wrapper.get('[data-testid="toggle-week-start"]').trigger('click')
    await wrapper.get('[data-testid="toggle-theme"]').trigger('click')
    await flushPromises()
    expect(probe(wrapper).root().attributes('data-locale')).toBe('zh-CN')
    expect(probe(wrapper).root().attributes('data-first-day-of-week')).toBe('7')
    expect(probe(wrapper).root().attributes('data-theme')).toBe('dark')

    await wrapper.get('[data-testid="toggle-calendar"]').trigger('click')
    expect(wrapper.find('.vc-container').exists()).toBe(false)
    await wrapper.get('[data-testid="toggle-calendar"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.vc-container').exists()).toBe(true)
    wrapper.unmount()
  })
})
