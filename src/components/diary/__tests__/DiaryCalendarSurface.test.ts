// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import type { TreeNode } from '../../../lib/api'
import DiaryCalendarSurface from '../DiaryCalendarSurface.vue'
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

function file(path: string, title = path): TreeNode {
  const name = path.split('/').pop() ?? path
  return { kind: 'file', name, path, title, mtime: 0 }
}

function treeWith(...paths: string[]): TreeNode[] {
  return [{
    kind: 'folder',
    name: 'content',
    path: '',
    children: [{
      kind: 'folder',
      name: 'diary',
      path: 'diary',
      children: paths.map((path) => file('diary/' + path)),
    }],
  }]
}

function mountSurface(tree: TreeNode[] = treeWith('2026-08-24'), extraProps: Record<string, unknown> = {}): VueWrapper {
  return mount(DiaryCalendarSurface, {
    props: {
      tree,
      initialMonth: { year: 2026, month: 8 },
      ...extraProps,
    },
  })
}

function dayCell(wrapper: VueWrapper, value: string): DOMWrapper<Element> {
  return wrapper.findAll('.vc-day').find((cell) => cell.find('[data-date="' + value + '"]').exists())!
}

describe('DiaryCalendarSurface', () => {
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
  })

  it('projects the authoritative tree into managed Diary markers', async () => {
    const wrapper = mountSurface(treeWith('2026-08-24', '2026-08-25', 'legacy'))
    await flushPromises()

    expect(wrapper.find('.diary-calendar-surface-header').exists()).toBe(false)
    expect(wrapper.find('.diary-calendar-toolbar').exists()).toBe(false)
    expect(wrapper.get('[data-testid="diary-calendar-surface"]').attributes('role')).toBe('region')
    expect(dayCell(wrapper, '2026-08-24').findAll('.vc-dot')).toHaveLength(1)
    expect(dayCell(wrapper, '2026-08-25').findAll('.vc-dot')).toHaveLength(1)
    expect(dayCell(wrapper, '2026-08-26').findAll('.vc-dot')).toHaveLength(0)
  })

  it('keeps a full calendar for empty data and separates loading/error states', async () => {
    const empty = mountSurface(treeWith(), { loading: false })
    await flushPromises()
    expect(empty.find('.vc-monthly').exists()).toBe(true)
    expect(empty.get('[data-testid="diary-calendar-surface-empty"]').text()).toContain('No diary entries')

    const loading = mountSurface(treeWith(), { loading: true, error: 'Tree unavailable' })
    await flushPromises()
    expect(loading.get('[data-testid="diary-calendar-surface"]').attributes('aria-busy')).toBe('true')
    expect(loading.get('[data-testid="diary-calendar-loading"]').attributes('role')).toBe('status')
    expect(loading.get('[data-testid="diary-calendar-error"]').attributes('role')).toBe('alert')
    expect(loading.find('.vc-monthly').exists()).toBe(true)
  })

  it('re-emits date and month intents without owning navigation side effects', async () => {
    const wrapper = mountSurface()
    await flushPromises()

    await wrapper.get('[data-date="2026-08-24"]').trigger('click')
    await wrapper.get('.vc-next').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('date-selected')).toEqual([['2026-08-24']])
    expect(wrapper.emitted('month-change')?.at(-1)?.[0]).toEqual({ year: 2026, month: 9 })
  })

  it('updates markers reactively from the latest tree props', async () => {
    const wrapper = mountSurface(treeWith())
    await flushPromises()
    expect(wrapper.findAll('.vc-dot')).toHaveLength(0)

    await wrapper.setProps({ tree: treeWith('2026-08-24') })
    await flushPromises()
    expect(dayCell(wrapper, '2026-08-24').findAll('.vc-dot')).toHaveLength(1)
  })

  it('does not own API, router, editor, or Diary create lifecycle', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/diary/DiaryCalendarSurface.vue'),
      'utf8',
    )

    expect(source).toContain('projectDiaryDaysFromTree(props.tree)')
    expect(source).toContain("@date-selected=\"emit('date-selected', $event)\"")
    expect(source).toContain("@month-change=\"emit('month-change', $event)\"")
    expect(source).not.toMatch(/fetch\(|authFetch|createPost|openPost|useRouter|router\.|\/api\/|openDiaryDate|toISOString/)
  })
})
