// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import HistoryChangesPanel from '../HistoryChangesPanel.vue'
import { useI18n } from '../../../composables/useI18n'

const entries = [
  { path: 'inbox/modified.md', index: ' ', worktree: 'M' },
  { path: 'inbox/new.md', index: '?', worktree: '?' },
  { path: 'archive/deleted.md', index: 'D', worktree: ' ' },
]

beforeEach(() => useI18n().setLocale('en'))

describe('HistoryChangesPanel', () => {
  it('renders understandable statuses and accessible selection controls', async () => {
    const wrapper = mount(HistoryChangesPanel, {
      props: {
        entries,
        selectedPaths: new Set(['inbox/modified.md']),
        message: '',
        busy: false,
        canCommit: false,
        error: null,
      },
    })
    expect(wrapper.text()).toContain('Modified')
    expect(wrapper.text()).toContain('New')
    expect(wrapper.text()).toContain('Deleted')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(3)
    expect(wrapper.get('input').attributes('aria-label')).toContain('inbox/modified.md')
    expect(wrapper.get('label[for="history-version-message"]').text()).toBe('Version message')

    await wrapper.findAll('input[type="checkbox"]')[1]!.trigger('change')
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['inbox/new.md'])
  })

  it('emits select-all, clear, message, and keyboard submission intents', async () => {
    const wrapper = mount(HistoryChangesPanel, {
      props: {
        entries,
        selectedPaths: new Set(['inbox/modified.md']),
        message: 'Version',
        busy: false,
        canCommit: true,
        error: null,
      },
    })
    const actionButtons = wrapper.findAll('.history-changes-actions button')
    await actionButtons[0]!.trigger('click')
    await actionButtons[1]!.trigger('click')
    await wrapper.get('textarea').setValue('Next version')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(wrapper.emitted('select-all')).toHaveLength(1)
    expect(wrapper.emitted('clear-selection')).toHaveLength(1)
    expect(wrapper.emitted('update:message')?.at(-1)).toEqual(['Next version'])
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('exposes localized busy and error states and disables mutation controls', () => {
    useI18n().setLocale('zh')
    const wrapper = mount(HistoryChangesPanel, {
      props: {
        entries,
        selectedPaths: new Set(['inbox/modified.md']),
        message: '版本',
        busy: true,
        canCommit: false,
        error: '提交失败',
      },
    })
    expect(wrapper.get('.history-changes').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('[role="status"]').text()).toBe('正在创建版本…')
    expect(wrapper.get('[role="alert"]').text()).toBe('提交失败')
    expect(wrapper.get('.history-create-version').text()).toBe('正在创建版本…')
    expect(wrapper.findAll('input:disabled')).toHaveLength(3)
  })

  it('exposes an explicit retry when real-index repair is pending', async () => {
    const wrapper = mount(HistoryChangesPanel, {
      props: {
        entries: [],
        selectedPaths: new Set<string>(),
        message: '',
        busy: false,
        canCommit: false,
        error: null,
        indexRepairPending: true,
        indexRepairBusy: false,
      },
    })

    const button = wrapper.get('.history-commit-error button')
    expect(button.text()).toBe('Retry Git status repair')
    await button.trigger('click')
    expect(wrapper.emitted('repair-index')).toHaveLength(1)
  })
})
