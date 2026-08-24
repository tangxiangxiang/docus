// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import DiaryCalendar from '../DiaryCalendar.vue'
import {
  diaryCalendarAttributes,
  diaryDateFromCalendarDay,
  diaryDateFromLocalDate,
  localCalendarDateForDiaryDate,
  type DiaryCalendarDay,
} from '../diaryCalendarAdapter'
import { parseDiaryDate, type DiaryDate } from '../../../../shared/diaryProtocol'
import { useI18n } from '../../../composables/useI18n'
import { useTheme } from '../../../composables/useTheme'

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

function date(value: string): DiaryDate {
  return parseDiaryDate(value)!
}

function day(value: string, hasDiary = true): DiaryCalendarDay {
  return { date: date(value), hasDiary }
}

function mountCalendar(
  days: readonly DiaryCalendarDay[] = [day('2026-08-24')],
  extraProps: Record<string, unknown> = {},
): VueWrapper {
  return mount(DiaryCalendar, {
    props: {
      days,
      initialMonth: { year: 2026, month: 8 },
      ...extraProps,
    },
  })
}

function dayCell(wrapper: VueWrapper, value: string): DOMWrapper<Element> {
  return wrapper.findAll('.vc-day').find((cell) => cell.find(`[data-date="${value}"]`).exists())!
}

describe('DiaryCalendar presentation adapter', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  let consoleWarn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    installBrowserApiShims()
    useI18n().setLocale('en')
    useTheme().set('light')
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
    useI18n().setLocale('zh')
    useTheme().set('light')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('converts local Calendar fields to validated DiaryDate without UTC conversion', () => {
    expect(diaryDateFromCalendarDay({ year: 2026, month: 8, day: 24 })).toBe('2026-08-24')
    expect(diaryDateFromCalendarDay({ year: 2026, month: 2, day: 31 })).toBeNull()
    expect(diaryDateFromCalendarDay({ year: 2026, month: 0, day: 24 })).toBeNull()

    const localDate = new Date(2026, 7, 24, 23, 59, 59)
    expect(diaryDateFromLocalDate(localDate)).toBe('2026-08-24')
  })

  it('preserves every supported Diary year through the local Date bridge', () => {
    const values = [
      '0000-02-29',
      '0001-01-01',
      '0099-12-31',
      '0100-01-01',
      '2026-08-24',
      '0099-02-28',
      '0099-03-01',
      '0100-02-28',
      '0400-02-29',
    ] as const

    for (const value of values) {
      const diaryDate = parseDiaryDate(value)!
      const localDate = localCalendarDateForDiaryDate(diaryDate)

      expect(localDate.getHours()).toBe(12)
      expect(diaryDateFromLocalDate(localDate)).toBe(diaryDate)
    }
  })

  it('normalizes duplicate projection dates to one deterministic dot attribute', () => {
    const attributes = diaryCalendarAttributes([
      day('2026-08-24', false),
      day('2026-08-24', true),
      day('2026-08-24', true),
      day('2026-08-25', false),
    ])

    expect(attributes).toHaveLength(1)
    expect(attributes[0]).toMatchObject({
      key: 'diary-2026-08-24',
      dates: ['2026-08-24'],
      dot: true,
    })
    expect(attributes[0].customData).toEqual(day('2026-08-24', true))
  })

  it('renders a fixed monthly Calendar and emits the initial library-independent month', async () => {
    const wrapper = mountCalendar()
    await flushPromises()

    expect(wrapper.find('.vc-monthly').exists()).toBe(true)
    expect(wrapper.get('.vc-title').text()).toContain('August 2026')
    expect(wrapper.get('[data-testid="diary-calendar"]').attributes('data-month')).toBe('2026-08')
    expect(wrapper.emitted('month-change')).toEqual([[{ year: 2026, month: 8 }]])
  })

  it('maps hasDiary to one dot and leaves empty dates as ordinary cells', async () => {
    const wrapper = mountCalendar([
      day('2026-08-24', true),
      day('2026-08-25', false),
    ])
    await flushPromises()

    expect(dayCell(wrapper, '2026-08-24').findAll('.vc-dot')).toHaveLength(1)
    expect(dayCell(wrapper, '2026-08-25').findAll('.vc-dot')).toHaveLength(0)
    expect(dayCell(wrapper, '2026-08-25').get('[data-diary-day-content]').attributes('aria-disabled')).toBe('false')
  })

  it('renders a complete calendar with zero markers for an empty projection', async () => {
    const wrapper = mountCalendar([])
    await flushPromises()

    expect(wrapper.find('.vc-monthly').exists()).toBe(true)
    expect(wrapper.findAll('.vc-dot')).toHaveLength(0)
    expect(wrapper.findAll('[data-date^="2026-08-"]').length).toBeGreaterThanOrEqual(28)
  })

  it('updates dots reactively without remounting the Calendar', async () => {
    const wrapper = mountCalendar([day('2026-08-24', false)])
    await flushPromises()
    const container = wrapper.get('.vc-container').element

    expect(dayCell(wrapper, '2026-08-24').findAll('.vc-dot')).toHaveLength(0)
    await wrapper.setProps({ days: [day('2026-08-24', true)] })
    await flushPromises()
    expect(dayCell(wrapper, '2026-08-24').findAll('.vc-dot')).toHaveLength(1)
    expect(wrapper.get('.vc-container').element).toBe(container)

    await wrapper.setProps({ days: [day('2026-08-24', false)] })
    await flushPromises()
    expect(dayCell(wrapper, '2026-08-24').findAll('.vc-dot')).toHaveLength(0)
  })

  it('emits only a validated DiaryDate for day clicks', async () => {
    const wrapper = mountCalendar()
    await flushPromises()

    await wrapper.get('[data-date="2026-08-24"]').trigger('click')
    await flushPromises()

    const payload = wrapper.emitted('date-selected')?.[0]?.[0]
    expect(payload).toBe('2026-08-24')
    expect(payload).not.toBeInstanceOf(Date)
    expect(String(payload)).not.toMatch(/[T/\\]|\.md/)
  })

  it('keeps the custom day-content seam, click behavior, and non-visual marker meaning', async () => {
    const wrapper = mountCalendar()
    await flushPromises()

    const target = wrapper.get('[data-date="2026-08-24"]')
    expect(target.element.tagName).toBe('BUTTON')
    expect(target.attributes('type')).toBe('button')
    expect(target.attributes('role')).toBe('button')
    expect(target.attributes('data-diary-day-content')).toBe('')
    expect(target.attributes('aria-label')).toContain('Diary exists')
    expect(target.text()).toContain('Diary exists')

    await target.trigger('click')
    expect(wrapper.emitted('date-selected')).toHaveLength(1)
  })

  it('navigates previous and next month without selecting a date', async () => {
    const wrapper = mountCalendar()
    await flushPromises()
    wrapper.emitted('month-change')!.length = 0

    await wrapper.get('.vc-next').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="diary-calendar"]').attributes('data-month')).toBe('2026-09')
    expect(wrapper.emitted('month-change')?.at(-1)?.[0]).toEqual({ year: 2026, month: 9 })
    expect(wrapper.emitted('date-selected')).toBeUndefined()

    await wrapper.get('.vc-prev').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="diary-calendar"]').attributes('data-month')).toBe('2026-08')
    expect(wrapper.emitted('month-change')?.at(-1)?.[0]).toEqual({ year: 2026, month: 8 })
  })

  it('uses browser-local civil Today, navigates to its month, and emits one date intent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 24, 23, 59, 30))
    const wrapper = mountCalendar([], { initialMonth: { year: 2025, month: 1 } })
    await flushPromises()

    await wrapper.get('[data-testid="diary-calendar-today"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="diary-calendar"]').attributes('data-month')).toBe('2026-08')
    expect(wrapper.emitted('date-selected')).toEqual([['2026-08-24']])
  })

  it('provides accessible navigation labels, loading/error presentation, and locale/theme integration', async () => {
    const wrapper = mountCalendar([day('2026-08-24')], { loading: true, error: 'Projection unavailable' })
    await flushPromises()

    expect(wrapper.get('[data-testid="diary-calendar-today"]').attributes('type')).toBe('button')
    expect(wrapper.get('[data-testid="diary-calendar-today"]').attributes('aria-label')).toBe('Today')
    expect(wrapper.get('.vc-prev').attributes('type')).toBe('button')
    expect(wrapper.get('.vc-prev').text()).toContain('Previous month')
    expect(wrapper.get('.vc-next').attributes('type')).toBe('button')
    expect(wrapper.get('.vc-next').text()).toContain('Next month')
    expect(wrapper.get('[data-testid="diary-calendar"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('[data-testid="diary-calendar-loading"]').attributes('role')).toBe('status')
    expect(wrapper.get('[data-testid="diary-calendar-error"]').attributes('role')).toBe('alert')
    expect(wrapper.get('[data-testid="diary-calendar"]').attributes('data-locale')).toBe('en-US')
    expect(wrapper.find('.vc-light').exists()).toBe(true)

    useI18n().setLocale('zh')
    useTheme().set('dark')
    await flushPromises()
    expect(wrapper.get('[data-testid="diary-calendar"]').attributes('data-locale')).toBe('zh-CN')
    expect(wrapper.get('[data-testid="diary-calendar-today"]').text()).toBe('今天')
    expect(wrapper.find('.vc-dark').exists()).toBe(true)
  })

  it('does not import or invoke API, router, editor, persistence, or UTC seams', () => {
    const componentSource = readFileSync(
      resolve(process.cwd(), 'src/components/diary/DiaryCalendar.vue'),
      'utf8',
    )
    const adapterSource = readFileSync(
      resolve(process.cwd(), 'src/components/diary/diaryCalendarAdapter.ts'),
      'utf8',
    )

    expect(componentSource).toContain("from 'v-calendar'")
    expect(componentSource).toContain("'v-calendar/style.css'")
    expect(componentSource).toContain('#day-content')
    expect(componentSource).not.toMatch(/fetch\(|authFetch|createPost|savePost|recoverPost|deletePost|useRouter|router\.|Editor|\/api\//)
    expect(componentSource).not.toContain('toISOString')
    expect(adapterSource).not.toContain('v-calendar')
    expect(adapterSource).not.toContain('toISOString')
  })

  it('does not call fetch for Calendar presentation interactions', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const wrapper = mountCalendar()
    await flushPromises()

    await wrapper.get('[data-date="2026-08-24"]').trigger('click')
    await wrapper.get('[data-testid="diary-calendar-today"]').trigger('click')
    await wrapper.get('.vc-next').trigger('click')
    await wrapper.get('.vc-prev').trigger('click')
    await flushPromises()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('unmounts and remounts without stale Calendar state', async () => {
    const first = mountCalendar()
    await flushPromises()
    first.unmount()

    const second = mountCalendar([day('2026-08-25')])
    await flushPromises()
    expect(second.find('[data-date="2026-08-25"]').exists()).toBe(true)
    expect(second.findAll('.vc-dot')).toHaveLength(1)
    second.unmount()
  })
})
