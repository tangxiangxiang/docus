// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import DraftRecoveryCenter from '../DraftRecoveryCenter.vue'
import { capacitySnapshot, primaryRecoveryRecord } from '../../../composables/vault/draft-recovery/draftCleanup'
import type { UnsavedDraft } from '../../../composables/vault/draft-recovery/draftTypes'

function draft(): UnsavedDraft {
  return {
    version: 1,
    vaultId: 'vault',
    documentId: 'doc',
    documentPath: 'notes/private.md',
    content: 'local bytes',
    baseContentHash: null,
    baseModifiedAt: null,
    createdAt: 1,
    updatedAt: 2,
  }
}

const wrappers: Array<{ unmount(): void }> = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

function setup(protectedRecord = false) {
  const record = primaryRecoveryRecord(draft())
  const id = JSON.stringify(['vault', 'doc'])
  const wrapper = mount(DraftRecoveryCenter, {
    props: {
      records: [record],
      items: [{
        recoveryId: id,
        draft: draft(),
        source: 'primary',
        conflict: null,
        decision: { kind: 'missing-source', draft: draft(), disk: { status: 'missing', documentPath: 'notes/private.md' } },
        status: 'ready',
        error: null,
      }],
      capacity: capacitySnapshot([record]),
      unsupportedCount: 2,
      selectedIds: new Set<string>(),
      protectedIds: protectedRecord ? new Set([id]) : new Set<string>(),
      loading: false,
      error: null,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('DraftRecoveryCenter', () => {
  it('shows device-local capacity metadata without exposing content', () => {
    const wrapper = setup()
    expect(wrapper.text()).toContain('notes/private.md')
    expect(wrapper.text()).toContain('1 unsaved item')
    expect(wrapper.text()).toContain('newer Docus version')
    expect(wrapper.text()).not.toContain('local bytes')
  })

  it('disables selection and deletion for protected records', () => {
    const wrapper = setup(true)
    expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
    const buttons = wrapper.findAll('button')
    const deleteButton = buttons.at(-1)!
    expect(deleteButton.attributes('disabled')).toBeDefined()
  })
})
