// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HistoryComparisonPane from '../HistoryComparisonPane.vue'
import type { HistoryComparison } from '../../../composables/vault/useHistoryComparisons'
import { useI18n } from '../../../composables/useI18n'

function comparison(overrides: Partial<HistoryComparison> = {}): HistoryComparison {
  return {
    tabId: 'diff:inbox/redis',
    documentPath: 'inbox/redis',
    documentTitle: 'Redis Notes',
    revisionId: 'revision-a',
    revisionTime: new Date(2026, 6, 15, 10, 31).getTime(),
    summary: 'Update cache section',
    oldRaw: 'old',
    newRaw: 'new',
    currentDirty: true,
    diff: {
      ops: [
        { op: 'remove', oldLine: 1, newLine: null, text: 'old' },
        { op: 'add', oldLine: null, newLine: 1, text: 'new' },
      ],
      stats: { added: 1, removed: 1, equal: 0 },
    },
    status: 'ready',
    error: null,
    ...overrides,
  }
}

function mountPane(value: HistoryComparison) {
  return mount(HistoryComparisonPane, {
    props: { comparison: value },
    global: {
      stubs: {
        SideBySideDiff: {
          props: ['diff', 'oldLabel', 'newLabel'],
          template: '<div class="side-by-side-stub">{{ oldLabel }} / {{ newLabel }}</div>',
        },
      },
    },
  })
}

describe('HistoryComparisonPane', () => {
  it('disables Restore while Create Version owns the document mutation lock', () => {
    const wrapper = mount(HistoryComparisonPane, {
      props: { comparison: comparison(), mutationLocked: true },
    })
    expect(wrapper.get('.history-restore-button').attributes('disabled')).toBeDefined()
  })

  it('renders a directional read-only comparison and exposes navigation actions', async () => {
    const wrapper = mountPane(comparison())

    expect(wrapper.text()).toContain('Comparing with current')
    expect(wrapper.text()).toContain('Unsaved changes')
    expect(wrapper.get('.side-by-side-stub').text()).toBe('Historical Version / Current Version')
    expect(wrapper.get('.history-restore-button').text()).toBe('Restore this version')

    const buttons = wrapper.findAll('.history-snapshot-toolbar button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    await buttons[3]!.trigger('click')
    expect(wrapper.emitted('restore')?.[0]?.[0]).toMatchObject({ revisionId: 'revision-a' })
    expect(wrapper.emitted('view-historical')?.[0]?.[0]).toMatchObject({ revisionId: 'revision-a' })
    expect(wrapper.emitted('view-current')).toEqual([['inbox/redis']])
    expect(wrapper.emitted('close')).toEqual([['diff:inbox/redis']])
  })

  it('disables restore and announces the busy state while restoring', () => {
    const wrapper = mountPane(comparison())
    void wrapper.setProps({ restoring: true })

    return wrapper.vm.$nextTick().then(() => {
      expect(wrapper.get('section').attributes('aria-busy')).toBe('true')
      expect(wrapper.get('.history-restore-button').attributes('disabled')).toBeDefined()
      expect(wrapper.get('.history-restore-button').text()).toBe('Restoring...')
    })
  })

  it('renders loading, error, retry, and identical states inline', async () => {
    const wrapper = mountPane(comparison({ status: 'loading', diff: null }))
    expect(wrapper.get('[role="status"]').text()).toContain('Comparing versions')

    await wrapper.setProps({ comparison: comparison({ status: 'error', diff: null, error: null }) })
    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to load the current version')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['diff:inbox/redis']])

    await wrapper.setProps({
      comparison: comparison({
        status: 'ready',
        currentDirty: false,
        diff: { ops: [], stats: { added: 0, removed: 0, equal: 0 } },
      }),
    })
    expect(wrapper.text()).toContain('identical')
    expect(wrapper.text()).toContain('Latest version')
  })

  it('formats the revision date with the application locale', () => {
    const { setLocale } = useI18n()
    setLocale('zh')
    try {
      const wrapper = mountPane(comparison())
      expect(wrapper.text()).toContain('2026年7月15日')
      expect(wrapper.text()).toContain('历史版本')
      expect(wrapper.text()).toContain('当前版本')
    } finally {
      setLocale('en')
    }
  })

  it('exposes a focus target for the comparison viewer', () => {
    const wrapper = mount(HistoryComparisonPane, {
      props: { comparison: comparison(), mutationLocked: true },
      attachTo: document.body,
      global: { stubs: { SideBySideDiff: true } },
    })
    wrapper.vm.focusViewer()
    expect(document.activeElement).toBe(wrapper.get('h2').element)
    expect(document.activeElement).not.toBe(wrapper.get('.history-restore-button').element)
    wrapper.unmount()
  })
})
