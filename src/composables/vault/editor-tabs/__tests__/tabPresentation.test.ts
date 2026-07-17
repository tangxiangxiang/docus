// Pure presentation tests — no Vue mounting required. The presentation
// module is the single source of truth for tab title, status text, and
// aria-label, so the unit tests here cover the full mapping.

import { describe, expect, it } from 'vitest'
import type { WorkspaceTab } from '../../../../components/vault/tabs'
import type { DocumentSavePresentation } from '../savePresentation'
import {
  deriveDisplayTitle,
  deriveTabUiPresentation,
} from '../tabPresentation'

const NO_T = (key: string) => key

function save(overrides: Partial<DocumentSavePresentation> = {}): DocumentSavePresentation {
  return {
    status: 'idle',
    dirty: false,
    inFlight: false,
    hasNewerChanges: false,
    retryable: false,
    attention: false,
    ...overrides,
  }
}

function tab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: 'inbox/test-document-1.md',
    label: 'test-document-1',
    title: 'Test Document 1',
    save: save(),
    kind: 'document',
    ...overrides,
  }
}

describe('deriveDisplayTitle', () => {
  it('returns the title when it is set and not equal to the path', () => {
    expect(deriveDisplayTitle('Inbox 测试', 'inbox/test-document-1.md')).toBe('Inbox 测试')
  })

  it('falls back to the path basename when title is empty', () => {
    expect(deriveDisplayTitle('', 'inbox/test-document-1.md')).toBe('test-document-1')
  })

  it('falls back to the path basename when title is only whitespace', () => {
    expect(deriveDisplayTitle('   ', 'inbox/test-document-1.md')).toBe('test-document-1')
  })

  it('falls back to the path basename when title equals the path', () => {
    expect(deriveDisplayTitle('inbox/test-document-1.md', 'inbox/test-document-1.md'))
      .toBe('test-document-1')
  })

  it('falls back to the path basename when title is identical to the trimmed path', () => {
    expect(deriveDisplayTitle('  inbox/test-document-1.md  ', 'inbox/test-document-1.md'))
      .toBe('test-document-1')
  })

  it('strips the .md extension from the basename', () => {
    expect(deriveDisplayTitle('', 'foo/bar/baz.md')).toBe('baz')
  })

  it('preserves non-md extensions', () => {
    expect(deriveDisplayTitle('', 'foo/bar/data.json')).toBe('data.json')
  })

  it('falls back to the full path when there is no basename', () => {
    expect(deriveDisplayTitle('', 'orphan')).toBe('orphan')
  })
})

describe('deriveTabUiPresentation — title + path rules', () => {
  it('renders a document whose title equals its path without repeating the path twice', () => {
    const t = tab({
      id: 'inbox/test-document-1',
      title: 'inbox/test-document-1',
    })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('test-document-1')
    expect(p.fullPath).toBe('inbox/test-document-1')
    // Tooltip shows the full path only when it differs from the title.
    expect(p.fullPath !== p.displayTitle).toBe(true)
  })

  it('renders an empty title using the path basename', () => {
    const t = tab({ title: '' })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('test-document-1')
    expect(p.fullPath).toBe('inbox/test-document-1.md')
  })

  it('preserves a Chinese title and shows the full path alongside it', () => {
    const t = tab({ title: '测试列表' })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('测试列表')
    expect(p.fullPath).toBe('inbox/test-document-1.md')
  })
})

describe('deriveTabUiPresentation — status text', () => {
  it.each([
    ['idle', 'status.saved'],
    ['saved', 'status.saved'],
    ['dirty', 'status.unsaved'],
    ['saving', 'status.saving'],
    ['saving-dirty', 'status.saving_dirty'],
    ['error', 'status.error'],
    ['offline', 'status.offline'],
    ['external', 'status.external'],
  ] as const)('maps %s → %s', (status, key) => {
    const t = tab({ save: save({ status }) })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.statusText).toBe(key)
  })

  it('does not emit the raw enum names in user-facing strings', () => {
    for (const status of ['idle', 'saved', 'dirty', 'saving', 'saving-dirty', 'error', 'offline', 'external'] as const) {
      const t = tab({ save: save({ status }) })
      const p = deriveTabUiPresentation(t, NO_T)
      expect(p.statusText).not.toBe(status)
    }
  })

  it('does not surface the literal word Idle/空闲', () => {
    const idle = tab({ save: save({ status: 'idle' }) })
    const saved = tab({ save: save({ status: 'saved' }) })
    expect(deriveTabUiPresentation(idle, NO_T).statusText).not.toBe('idle')
    expect(deriveTabUiPresentation(idle, NO_T).statusText).not.toBe('Idle')
    expect(deriveTabUiPresentation(idle, NO_T).statusText).not.toBe('空闲')
    expect(deriveTabUiPresentation(saved, NO_T).statusText).not.toBe('idle')
    expect(deriveTabUiPresentation(saved, NO_T).statusText).not.toBe('Idle')
    expect(deriveTabUiPresentation(saved, NO_T).statusText).not.toBe('空闲')
  })

  it('omits the status text for history and diff tabs', () => {
    const h = tab({ kind: 'history', save: save() })
    const d = tab({ kind: 'diff', save: save() })
    expect(deriveTabUiPresentation(h, NO_T).statusText).toBeNull()
    expect(deriveTabUiPresentation(d, NO_T).statusText).toBeNull()
    expect(deriveTabUiPresentation(h, NO_T).statusKind).toBe('none')
    expect(deriveTabUiPresentation(d, NO_T).statusKind).toBe('none')
    expect(deriveTabUiPresentation(h, NO_T).fullPath).toBeNull()
    expect(deriveTabUiPresentation(d, NO_T).fullPath).toBeNull()
  })
})

describe('deriveTabUiPresentation — presentation priority', () => {
  it('shows saving / saving-dirty even when runtime saveStatus is dirty', () => {
    const p = deriveTabUiPresentation(
      tab({
        save: save({
          status: 'saving-dirty',
          dirty: true,
          inFlight: true,
          hasNewerChanges: true,
        }),
      }),
      NO_T,
    )
    expect(p.statusKind).toBe('saving')
    expect(p.statusText).toBe('status.saving_dirty')
  })

  it('prefers error over dirty', () => {
    const p = deriveTabUiPresentation(
      tab({ save: save({ status: 'error', dirty: true, retryable: true, attention: true }) }),
      NO_T,
    )
    expect(p.statusKind).toBe('error')
    expect(p.statusText).toBe('status.error')
  })

  it('prefers offline over dirty', () => {
    const p = deriveTabUiPresentation(
      tab({ save: save({ status: 'offline', dirty: true, retryable: true, attention: true }) }),
      NO_T,
    )
    expect(p.statusKind).toBe('offline')
    expect(p.statusText).toBe('status.offline')
  })

  it('prefers external over dirty', () => {
    const p = deriveTabUiPresentation(
      tab({ save: save({ status: 'external', dirty: true, attention: true }) }),
      NO_T,
    )
    expect(p.statusKind).toBe('external')
    expect(p.statusText).toBe('status.external')
  })
})

describe('deriveTabUiPresentation — aria-label', () => {
  it('combines title + status for document tabs', () => {
    const p = deriveTabUiPresentation(tab({ save: save({ status: 'dirty', dirty: true }) }), NO_T)
    expect(p.ariaLabel).toBe('Test Document 1 status.unsaved')
  })

  it('does not include any status for history / diff', () => {
    const h = deriveTabUiPresentation(
      tab({ kind: 'history', label: 'Redis (History)', title: 'Redis Notes' }),
      NO_T,
    )
    expect(h.ariaLabel).toBe('Redis (History)')
    expect(h.ariaLabel).not.toMatch(/status\.|Saved|Unsaved|Saving|Error|Offline|Externally/)
  })
})