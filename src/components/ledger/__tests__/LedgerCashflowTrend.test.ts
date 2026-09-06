// @vitest-environment jsdom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { LedgerTrendPoint } from '../../../../shared/ledgerProtocol'
import { useTheme } from '../../../composables/useTheme'
import LedgerCashflowTrend from '../LedgerCashflowTrend.vue'

// Only the DOM-owning entry point is mocked. `echarts/charts`, `components`
// and `renderers` load for real so the modular import paths stay verified.
const echarts = vi.hoisted(() => {
  const instances: { setOption: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = []
  const init = vi.fn((element: HTMLElement) => {
    void element
    const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
    instances.push(instance)
    return instance
  })
  return { init, use: vi.fn(), instances }
})

vi.mock('echarts/core', () => ({ init: echarts.init, use: echarts.use }))

class TestResizeObserver {
  static instances: TestResizeObserver[] = []
  readonly observed: Element[] = []
  readonly callback: () => void
  disconnected = false
  constructor(callback: () => void) {
    this.callback = callback
    TestResizeObserver.instances.push(this)
  }
  observe(target: Element): void { this.observed.push(target) }
  unobserve(): void { /* not exercised */ }
  disconnect(): void { this.disconnected = true }
}

interface ChartOption {
  legend: { data: readonly string[] }
  tooltip: { formatter: (params: unknown) => string }
  xAxis: { data: readonly string[] }
  yAxis: { min?: number; max?: number; axisLabel: { formatter: (value: number) => string } }
  series: readonly { name: string; type: string; data: readonly number[] }[]
}

function point(month: string, incomeMinor: number, expenseMinor: number): LedgerTrendPoint {
  const [year, index] = month.split('-').map(Number)
  return {
    month,
    startAt: Date.UTC(year, index - 1, 1),
    endAt: Date.UTC(year, index, 1),
    incomeMinor,
    expenseMinor,
    balanceMinor: incomeMinor - expenseMinor,
  }
}

const sixMonths: readonly LedgerTrendPoint[] = [
  point('2026-04', 510_000, 5_290),
  point('2026-05', 480_000, 120_000),
  point('2026-06', 500_000, 640_000),
  point('2026-07', 500_000, 30_000),
  point('2026-08', 520_000, 44_000),
  point('2026-09', 510_000, 5_290),
]

const wrappers: VueWrapper[] = []

function mountTrend(trend: readonly LedgerTrendPoint[], currency = 'CNY'): VueWrapper {
  const wrapper = mount(LedgerCashflowTrend, { props: { trend, currency } })
  wrappers.push(wrapper)
  return wrapper
}

function lastOption(instanceIndex = 0): ChartOption {
  const instance = echarts.instances[instanceIndex]
  const calls = instance.setOption.mock.calls
  return calls[calls.length - 1][0] as ChartOption
}

describe('LedgerCashflowTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    echarts.instances.length = 0
    TestResizeObserver.instances.length = 0
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
    vi.unstubAllGlobals()
    useTheme().set('light')
  })

  it('renders an empty state without initializing a chart', () => {
    const wrapper = mountTrend([])

    expect(wrapper.find('[data-testid="ledger-cashflow-trend-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ledger-cashflow-trend-canvas"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ledger-cashflow-trend-table"]').exists()).toBe(false)
    expect(echarts.init).not.toHaveBeenCalled()
  })

  it('initializes one chart on the plot container and applies a single option', () => {
    const wrapper = mountTrend(sixMonths)

    expect(echarts.init).toHaveBeenCalledTimes(1)
    expect(echarts.init.mock.calls[0][0]).toBe(wrapper.get('[data-testid="ledger-cashflow-trend-canvas"]').element)
    expect(echarts.instances[0].setOption).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="ledger-cashflow-trend-empty"]').exists()).toBe(false)
  })

  it('maps the six months to a bar/bar/line series over one shared value axis', () => {
    mountTrend(sixMonths)
    const option = lastOption()

    expect(option.xAxis.data).toEqual(['4月', '5月', '6月', '7月', '8月', '9月'])
    expect(option.series.map((series) => [series.name, series.type])).toEqual([
      ['收入', 'bar'],
      ['支出', 'bar'],
      ['收支结余', 'line'],
    ])
    expect(option.series[0].data).toEqual([510_000, 480_000, 500_000, 500_000, 520_000, 510_000])
    expect(option.series[1].data).toEqual([5_290, 120_000, 640_000, 30_000, 44_000, 5_290])
    // The negative June balance has to survive onto the same axis.
    expect(option.series[2].data).toEqual([504_710, 360_000, -140_000, 470_000, 476_000, 504_710])
    expect(Array.isArray(option.yAxis)).toBe(false)
    expect(option.legend.data).toEqual(['收入', '支出', '收支结余'])
  })

  it('qualifies month labels with the year when the window crosses one', () => {
    mountTrend([
      point('2025-10', 100, 0),
      point('2025-11', 100, 0),
      point('2025-12', 100, 0),
      point('2026-01', 100, 0),
      point('2026-02', 100, 0),
      point('2026-03', 100, 0),
    ])

    expect(lastOption().xAxis.data).toEqual(['2025/10', '2025/11', '2025/12', '2026/01', '2026/02', '2026/03'])
  })

  it('formats the tooltip with Ledger money and no protocol field names', () => {
    mountTrend(sixMonths)
    const text = lastOption().tooltip.formatter([{ dataIndex: 5 }]).replace(/<[^>]*>/g, ' ')

    expect(text).toContain('2026年9月')
    expect(text).toContain('收入')
    expect(text).toContain('¥5,100.00')
    expect(text).toContain('支出')
    expect(text).toContain('¥52.90')
    expect(text).toContain('收支结余')
    expect(text).toContain('+¥5,047.10')
    expect(text).not.toContain('incomeMinor')
    expect(text).not.toContain('expenseMinor')
    expect(text).not.toContain('balanceMinor')
  })

  it('renders a signed negative balance in the tooltip', () => {
    mountTrend(sixMonths)
    const text = lastOption().tooltip.formatter([{ dataIndex: 2 }]).replace(/<[^>]*>/g, ' ')

    expect(text).toContain('2026年6月')
    expect(text).toContain('-¥1,400.00')
  })

  it('formats axis ticks with the Ledger money formatter and rejects unusable ticks', () => {
    mountTrend(sixMonths)
    const formatter = lastOption().yAxis.axisLabel.formatter

    expect(formatter(500_000)).toBe('¥5,000.00')
    expect(formatter(-140_000)).toBe('-¥1,400.00')
    // ECharts owns its tick values; a fractional one must not reach the
    // minor-unit formatter, which only accepts safe integers.
    expect(formatter(250_000.5)).toBe('¥2,500.01')
    expect(formatter(Number.NaN)).toBe('')
    expect(formatter(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('honours a non-CNY currency in every formatted boundary', () => {
    mountTrend([point('2026-09', 100_000, 25_000)], 'JPY')
    const option = lastOption()

    expect(option.yAxis.axisLabel.formatter(100_000)).toContain('100,000')
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).toContain('100,000')
    expect(option.tooltip.formatter([{ dataIndex: 0 }])).not.toContain('¥100,000.00')
  })

  it('gives an all-zero trend a finite axis range instead of a collapsed one', () => {
    mountTrend([
      point('2026-04', 0, 0),
      point('2026-05', 0, 0),
      point('2026-06', 0, 0),
    ])
    const option = lastOption()

    expect(option.yAxis.min).toBe(0)
    expect(option.yAxis.max).toBe(100)
    expect(Number.isFinite(option.yAxis.max)).toBe(true)
    expect(option.series.every((series) => series.data.every((value) => value === 0))).toBe(true)
  })

  it('exposes every month to assistive technology in a visually hidden table', () => {
    const wrapper = mountTrend(sixMonths)
    const table = wrapper.get('[data-testid="ledger-cashflow-trend-table"]')

    expect(table.classes()).toContain('sr-only')
    // The visually-hidden rule belongs on a plain block: a `display: table`
    // box does not reliably honour `width: 1px` + `overflow: hidden`.
    expect(table.element.tagName).toBe('DIV')
    expect(table.get('table').classes()).not.toContain('sr-only')
    expect(wrapper.get('[data-testid="ledger-cashflow-trend-canvas"]').attributes('aria-hidden')).toBe('true')
    expect(table.findAll('thead th').map((cell) => cell.text())).toEqual(['月份', '收入', '支出', '收支结余'])

    const rows = table.findAll('tbody tr')
    expect(rows).toHaveLength(6)
    expect(rows[5].get('th').text()).toBe('2026年9月')
    expect(rows[5].findAll('td').map((cell) => cell.text())).toEqual(['¥5,100.00', '¥52.90', '+¥5,047.10'])
    expect(rows[2].findAll('td')[2].text()).toBe('-¥1,400.00')
  })

  it('updates the live instance when the anchored trend changes instead of re-initializing', async () => {
    const wrapper = mountTrend(sixMonths)
    expect(echarts.instances[0].setOption).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ trend: [point('2026-03', 1_000, 400), ...sixMonths.slice(0, 5)] })

    expect(echarts.init).toHaveBeenCalledTimes(1)
    expect(echarts.instances[0].dispose).not.toHaveBeenCalled()
    expect(echarts.instances[0].setOption).toHaveBeenCalledTimes(2)
    expect(lastOption().xAxis.data).toEqual(['3月', '4月', '5月', '6月', '7月', '8月'])
  })

  it('refreshes the option when the appearance changes', async () => {
    mountTrend(sixMonths)
    expect(echarts.instances[0].setOption).toHaveBeenCalledTimes(1)

    useTheme().set('dark')
    await nextTick()

    expect(echarts.instances[0].setOption).toHaveBeenCalledTimes(2)
    expect(echarts.init).toHaveBeenCalledTimes(1)
  })

  it('resizes with the container rather than only with the window', () => {
    const wrapper = mountTrend(sixMonths)
    const observer = TestResizeObserver.instances[0]

    expect(observer.observed).toEqual([wrapper.get('[data-testid="ledger-cashflow-trend-canvas"]').element])
    observer.callback()
    expect(echarts.instances[0].resize).toHaveBeenCalledTimes(1)
  })

  it('falls back to the window when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    mountTrend(sixMonths)

    window.dispatchEvent(new Event('resize'))
    expect(echarts.instances[0].resize).toHaveBeenCalledTimes(1)
  })

  it('disposes the chart and the observer on unmount', () => {
    const wrapper = mountTrend(sixMonths)
    const observer = TestResizeObserver.instances[0]

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)

    expect(echarts.instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(observer.disconnected).toBe(true)
  })

  it('removes the window fallback listener on unmount', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const wrapper = mountTrend(sixMonths)

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    window.dispatchEvent(new Event('resize'))

    expect(echarts.instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(echarts.instances[0].resize).not.toHaveBeenCalled()
  })

  it('tears the chart down when the trend empties and rebuilds it when data returns', async () => {
    const wrapper = mountTrend(sixMonths)

    await wrapper.setProps({ trend: [] })
    await nextTick()
    expect(echarts.instances[0].dispose).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="ledger-cashflow-trend-empty"]').exists()).toBe(true)

    await wrapper.setProps({ trend: sixMonths })
    await nextTick()
    expect(echarts.init).toHaveBeenCalledTimes(2)
    expect(echarts.instances[1].setOption).toHaveBeenCalled()
  })
})
