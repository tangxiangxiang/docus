// @vitest-environment jsdom
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import DiaryReaderDialog from '../DiaryReaderDialog.vue'
import { useI18n } from '../../../composables/useI18n'
import type { Resolver as WikiResolver } from '../../../lib/wikiLinks'
import { parseDiaryDate } from '../../../../shared/diaryProtocol'

const READER_DATE = parseDiaryDate('2026-08-24')!

const ReadingPaneStub = defineComponent({
  props: {
    raw: { type: String, required: true },
    sourcePath: { type: String, required: true },
    resolver: { type: Function },
  },
  template: '<article data-testid="reading-pane-stub"><h1>{{ raw }}</h1><p>{{ sourcePath }}</p></article>',
})

function mountReader(extraProps: Record<string, unknown> = {}): VueWrapper {
  return mount(DiaryReaderDialog, {
    attachTo: document.body,
    props: {
      date: READER_DATE,
      path: 'diary/2026-08-24',
      raw: '# Existing Diary',
      ...extraProps,
    },
    global: { stubs: { ReadingPane: ReadingPaneStub } },
  })
}

describe('DiaryReaderDialog', () => {
  beforeEach(() => useI18n().setLocale('en'))

  afterEach(() => {
    document.body.innerHTML = ''
    useI18n().setLocale('zh')
  })

  it('renders the existing ReadingPane seam with the backing document identity', () => {
    const resolver: WikiResolver = (ref) => ({ target: ref })
    const wrapper = mountReader({ resolver })
    const readingPane = wrapper.findComponent(ReadingPaneStub)

    expect(wrapper.get('[data-testid="diary-reader-dialog"]').attributes('role')).toBe('dialog')
    expect(wrapper.get('[data-testid="diary-reader-dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.get('#diary-reader-title').text()).toBe('2026-08-24')
    expect(wrapper.get('[data-testid="diary-reader-dialog"]').attributes('data-path')).toBe('diary/2026-08-24')
    expect(wrapper.get('[data-testid="reading-pane-stub"]').text()).toContain('# Existing Diary')
    expect(wrapper.get('[data-testid="reading-pane-stub"]').text()).toContain('diary/2026-08-24')
    expect(readingPane.props('raw')).toBe('# Existing Diary')
    expect(readingPane.props('sourcePath')).toBe('diary/2026-08-24')
    expect(readingPane.props('resolver')).toBe(resolver)
  })

  it('shows loading and error states without mounting a second reading surface', async () => {
    const wrapper = mountReader({ loading: true, error: 'ignored while loading' })
    expect(wrapper.get('[data-testid="diary-reader-loading"]').text()).toContain('Loading Diary')
    expect(wrapper.find('[data-testid="reading-pane-stub"]').exists()).toBe(false)

    await wrapper.setProps({ loading: false, error: 'Diary unavailable' })
    expect(wrapper.get('[data-testid="diary-reader-error"]').text()).toContain('Diary unavailable')
    expect(wrapper.find('[data-testid="reading-pane-stub"]').exists()).toBe(false)
  })

  it('uses one presentation close event for Back, Close, and Escape', async () => {
    const wrapper = mountReader()

    await wrapper.get('[data-testid="diary-reader-back"]').trigger('click')
    await wrapper.get('[data-testid="diary-reader-close"]').trigger('click')
    await wrapper.get('[data-testid="diary-reader-dialog"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('close')).toHaveLength(3)
    expect(wrapper.emitted('edit')).toBeUndefined()
  })

  it('emits the temporary D5 edit handoff without owning document lifecycle', async () => {
    const wrapper = mountReader()

    await wrapper.get('[data-testid="diary-reader-edit"]').trigger('click')

    expect(wrapper.emitted('edit')).toEqual([[]])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('moves initial focus into the Reader and exposes a stable focus method', async () => {
    const wrapper = mountReader()
    const focusInitial = (wrapper.vm as unknown as { focusInitial: () => void }).focusInitial

    focusInitial()
    await nextTick()

    expect(wrapper.get('[data-testid="diary-reader-back"]').element).toBe(document.activeElement)
  })

  it('keeps the Reader actions localized for both English and Chinese', async () => {
    const wrapper = mountReader()

    expect(wrapper.get('[data-testid="diary-reader-back"]').attributes('aria-label')).toBe('Back to calendar')
    expect(wrapper.get('[data-testid="diary-reader-edit"]').attributes('aria-label')).toBe('Edit Diary')
    expect(wrapper.get('[data-testid="diary-reader-close"]').attributes('aria-label')).toBe('Close reader')

    useI18n().setLocale('zh')
    await nextTick()
    expect(wrapper.get('[data-testid="diary-reader-back"]').attributes('aria-label')).toBe('返回日历')
    expect(wrapper.get('[data-testid="diary-reader-edit"]').attributes('aria-label')).toBe('编辑日记')
    expect(wrapper.get('[data-testid="diary-reader-close"]').attributes('aria-label')).toBe('关闭阅读器')
  })
})
