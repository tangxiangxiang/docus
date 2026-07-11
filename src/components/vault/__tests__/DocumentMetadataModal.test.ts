// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DocumentMetadataModal from '../DocumentMetadataModal.vue'

const getPost = vi.fn()
const updateDocumentMetadata = vi.fn()

vi.mock('../../../lib/api', () => ({
  getPost: (...args: unknown[]) => getPost(...args),
  updateDocumentMetadata: (...args: unknown[]) => updateDocumentMetadata(...args),
}))

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const metadata = {
  id: 'doc-1', path: 'inbox/note', title: 'Note', summary: 'Summary',
  tags: ['rag', 'notes'], aliases: ['Old name'], createdAt: 1, updatedAt: 2,
}

beforeEach(() => {
  getPost.mockReset().mockResolvedValue({ metadata, frontmatter: {} })
  updateDocumentMetadata.mockReset().mockResolvedValue({ ...metadata, title: 'Updated' })
})

describe('DocumentMetadataModal', () => {
  it('loads metadata and saves normalized lists', async () => {
    const wrapper = mount(DocumentMetadataModal, {
      props: { open: true, path: 'inbox/note' },
      attachTo: document.body,
    })
    await flushPromises()
    const inputs = document.body.querySelectorAll<HTMLInputElement>('.document-metadata-field input')
    expect(inputs[0].value).toBe('Note')
    const tagInput = document.body.querySelector<HTMLInputElement>('input[placeholder="rag, notes"]')!
    tagInput.value = 'rag, RAG, new'
    tagInput.dispatchEvent(new Event('input', { bubbles: true }))
    const aliasInput = document.body.querySelector<HTMLInputElement>('input[placeholder="用逗号分隔"]')!
    aliasInput.value = 'Old name, Alias'
    aliasInput.dispatchEvent(new Event('input', { bubbles: true }))
    document.body.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(updateDocumentMetadata).toHaveBeenCalledWith('inbox/note', expect.objectContaining({
      tags: ['rag', 'new'], aliases: ['Old name', 'Alias'],
    }))
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ title: 'Updated' })
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mount(DocumentMetadataModal, {
      props: { open: true, path: 'inbox/note' },
      attachTo: document.body,
    })
    await flushPromises()
    document.body.querySelector('.document-metadata-backdrop')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
