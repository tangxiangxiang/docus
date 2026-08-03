// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentMetadataForm from '../DocumentMetadataForm.vue'
import { draftsByDocumentId } from '../metadataDraftStore'
import { useI18n } from '../../../composables/useI18n'

const getPost = vi.fn()
const updateDocumentMetadata = vi.fn()
const suggestSummary = vi.fn()

vi.mock('../../../lib/api', () => ({
  getPost: (...args: unknown[]) => getPost(...args),
  updateDocumentMetadata: (...args: unknown[]) => updateDocumentMetadata(...args),
}))
vi.mock('../../../lib/ai-api', () => ({
  suggestSummary: (...args: unknown[]) => suggestSummary(...args),
}))
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const post = (path: string, id: string, title: string) => ({
  path,
  raw: `# ${title}`,
  content: `# ${title}`,
  frontmatter: {},
  metadata: { id, path, title, summary: `${title} summary`, tags: ['Rag'], createdAt: 1, updatedAt: 2 },
  size: 1,
  mtime: 2,
})

beforeEach(() => {
  draftsByDocumentId.clear()
  useI18n().setLocale('en')
  getPost.mockReset().mockImplementation((path: string) => Promise.resolve(post(path, `id-${path}`, path)))
  updateDocumentMetadata.mockReset().mockImplementation(async (path: string, input: any) => ({
    ...post(path, `id-${path}`, input.title).metadata,
    ...input,
    updatedAt: 99,
  }))
  suggestSummary.mockReset().mockResolvedValue({ summary: 'AI summary' })
})

describe('DocumentMetadataForm', () => {
  it('loads normally and keeps save disabled until a normalized change is made', async () => {
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a', showCancel: false } })
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('a')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input').setValue('  New title  ')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
  })

  it('ignores an older response and its finally while a newer path is loading', async () => {
    let resolveA!: (value: any) => void
    let resolveB!: (value: any) => void
    getPost.mockReset()
      .mockReturnValueOnce(new Promise((resolve) => { resolveA = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveB = resolve }))
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a' } })
    await wrapper.setProps({ path: 'b' })
    resolveB(post('b', 'id-b', 'B'))
    await flushPromises()
    resolveA(post('a', 'id-a', 'A'))
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('B')
    expect(wrapper.get('[aria-busy]').attributes('aria-busy')).toBe('false')
  })

  it('clears old fields on failure, blocks saving, and retries inline', async () => {
    getPost.mockReset().mockResolvedValueOnce(post('a', 'id-a', 'A')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(post('b', 'id-b', 'B'))
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a' } })
    await flushPromises()
    await wrapper.setProps({ path: 'b' })
    await flushPromises()
    expect(wrapper.text()).toContain('Failed to load')
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
    await wrapper.get('.document-metadata-error button').trigger('click')
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('B')
  })

  it('preserves separate dirty drafts by document id across tab-like path switches', async () => {
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a' } })
    await flushPromises()
    await wrapper.get('input').setValue('A draft')
    await wrapper.setProps({ enabled: false })
    await wrapper.setProps({ path: 'b', enabled: true })
    await flushPromises()
    await wrapper.get('input').setValue('B draft')
    await wrapper.setProps({ enabled: false })
    await wrapper.setProps({ path: 'a', enabled: true })
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('A draft')
    expect(draftsByDocumentId.get('id-b')?.title).toBe('B draft')
  })

  it('resets to the last successful base and saves updated base/updatedAt', async () => {
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a' } })
    await flushPromises()
    await wrapper.get('input').setValue('Changed')
    await wrapper.get('.document-metadata-actions button:nth-of-type(2)').trigger('click')
    expect(wrapper.get('input').element.value).toBe('a')
    await wrapper.get('input').setValue('Saved')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(updateDocumentMetadata).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'Saved' }))
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('does not let a save response for A overwrite the newly loaded B form', async () => {
    let resolveSave!: (value: any) => void
    updateDocumentMetadata.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve }))
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a' } })
    await flushPromises()
    await wrapper.get('input').setValue('A changed')
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ path: 'b' })
    await flushPromises()
    resolveSave({ ...post('a', 'id-a', 'A changed').metadata, title: 'A saved', updatedAt: 100 })
    await flushPromises()
    expect(wrapper.get('input').element.value).toBe('b')
    expect(draftsByDocumentId.has('id-b')).toBe(false)
  })

  it('uses the live summary source and ignores a response after the user edits the field', async () => {
    let resolveSummary!: (value: { summary: string }) => void
    suggestSummary.mockReturnValueOnce(new Promise((resolve) => { resolveSummary = resolve }))
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a', summarySource: '# live unsaved body' } })
    await flushPromises()
    await wrapper.get('.metadata-generate-summary').trigger('click')
    await wrapper.get('textarea').setValue('User summary')
    resolveSummary({ summary: 'stale AI result' })
    await flushPromises()
    expect(suggestSummary).toHaveBeenCalledWith(
      { path: 'a', language: 'en', content: '# live unsaved body' },
      expect.any(AbortSignal),
    )
    expect(wrapper.get('textarea').element.value).toBe('User summary')
  })

  it('is readonly in history, diff, and recovery contexts, including the save shortcut', async () => {
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a', context: 'history' } })
    await flushPromises()
    expect(wrapper.text()).toContain('historical version')
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.metadata-generate-summary').exists()).toBe(false)
    await wrapper.get('form').trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(updateDocumentMetadata).not.toHaveBeenCalled()
  })

  it('aborts summary generation on unmount', async () => {
    let signal!: AbortSignal
    suggestSummary.mockImplementationOnce((_input: unknown, nextSignal: AbortSignal) => {
      signal = nextSignal
      return new Promise(() => {})
    })
    const wrapper = mount(DocumentMetadataForm, { props: { path: 'a' } })
    await flushPromises()
    await wrapper.get('.metadata-generate-summary').trigger('click')
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
  })
})
