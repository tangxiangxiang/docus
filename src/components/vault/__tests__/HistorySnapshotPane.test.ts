// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HistorySnapshotPane from '../HistorySnapshotPane.vue'
import type { HistorySnapshot } from '../../../composables/vault/useHistorySnapshots'

const snapshot = (overrides: Partial<HistorySnapshot> = {}): HistorySnapshot => ({
  tabId: 'history:inbox/redis',
  documentPath: 'inbox/redis',
  documentTitle: 'Redis Notes',
  revisionId: 'revision-a',
  revisionTime: new Date(2026, 6, 15, 10, 31).getTime(),
  summary: 'Update cache section',
  rawMarkdown: '# Historical Redis\n\n```ts\nconst cached = true\n```',
  status: 'ready',
  error: null,
  ...overrides,
})

function mountPane(value: HistorySnapshot) {
  return mount(HistorySnapshotPane, {
    props: { snapshot: value },
    global: {
      stubs: {
        ReadingPane: {
          props: ['raw', 'resolver'],
          template: '<article class="reading-pane-stub">{{ raw }}</article>',
        },
      },
    },
  })
}

describe('HistorySnapshotPane', () => {
  it('disables Restore while Create Version owns the document mutation lock', async () => {
    const wrapper = mountPane(snapshot())
    await wrapper.setProps({ mutationLocked: true })

    expect(wrapper.get('.history-restore-button').attributes('disabled')).toBeDefined()
  })

  it('renders the banner, read-only toolbar, and exact Markdown through ReadingPane', async () => {
    const wrapper = mountPane(snapshot())

    expect(wrapper.text()).toContain('Viewing historical version')
    expect(wrapper.text()).toContain('Current document is unchanged.')
    expect(wrapper.text()).toContain('Read only')
    expect(wrapper.get('.reading-pane-stub').text()).toContain('const cached = true')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.find('.monaco-host').exists()).toBe(false)
    expect(wrapper.get('.history-restore-button').text()).toBe('Restore this version')
    expect(wrapper.get('.history-restore-button').attributes('disabled')).toBeUndefined()

    await wrapper.get('.history-restore-button').trigger('click')
    expect(wrapper.emitted('restore')?.[0]?.[0]).toMatchObject({ revisionId: 'revision-a' })
    const toolbarButtons = wrapper.findAll('.history-snapshot-toolbar button')
    await toolbarButtons[1]!.trigger('click')
    expect(wrapper.emitted('open-diff')?.[0]?.[0]).toMatchObject({ revisionId: 'revision-a' })
    await toolbarButtons[2]!.trigger('click')
    expect(wrapper.emitted('view-current')).toEqual([['inbox/redis']])
    await toolbarButtons[3]!.trigger('click')
    expect(wrapper.emitted('close')).toEqual([['history:inbox/redis']])
  })

  it('disables restore and announces the busy state while restoring', () => {
    const wrapper = mount(HistorySnapshotPane, {
      props: { snapshot: snapshot(), restoring: true },
      global: { stubs: { ReadingPane: true } },
    })

    expect(wrapper.get('section').attributes('aria-busy')).toBe('true')
    expect(wrapper.get('.history-restore-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.history-restore-button').text()).toBe('Restoring...')
  })

  it('keeps loading and error states inside the history viewer', async () => {
    const wrapper = mountPane(snapshot({ status: 'loading', rawMarkdown: '' }))
    expect(wrapper.get('.history-snapshot-state').text()).toBe('Loading revision...')

    await wrapper.setProps({ snapshot: snapshot({ status: 'error', rawMarkdown: '', error: null }) })
    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to load revision.')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['history:inbox/redis']])
  })

  it('exposes a focus target for the read-only viewer', () => {
    const wrapper = mount(HistorySnapshotPane, {
      props: { snapshot: snapshot() },
      attachTo: document.body,
      global: { stubs: { ReadingPane: true } },
    })
    wrapper.vm.focusViewer()
    expect(document.activeElement).toBe(wrapper.get('h2').element)
    wrapper.unmount()
  })
})
