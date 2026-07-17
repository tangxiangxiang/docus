// Pure presentation tests — no Vue mounting required. The presentation
// module is the single source of truth for tab title, document title,
// status text, and aria-label, so the unit tests here cover the full
// mapping.

import { describe, expect, it } from 'vitest'
import type { WorkspaceTab } from '../../../../components/vault/tabs'
import type { DocumentSavePresentation } from '../savePresentation'
import {
  deriveDisplayTitle,
  deriveDocumentTitle,
  deriveTabUiPresentation,
} from '../tabPresentation'

// Minimal translator stub: only the keys the presentation module
// looks up at runtime. Tests that need exact aria-label output
// compose expectations off this map; tests that only care about
// presence/absence still use NO_T.
const NO_T = (key: string) => key
const STUB_STRINGS: Record<string, string> = {
  'status.saved': 'Saved',
  'workspace_tab.aria_separator': ', ',
  'workspace_tab.aria_file': 'file {name}',
}
function stubT(key: string, params: Record<string, string | number> = {}): string {
  const template = STUB_STRINGS[key]
  if (!template) return key
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ))
}

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

function basename(path: string): string {
  const last = path.split('/').pop() ?? path
  return last.endsWith('.md') ? last.slice(0, -3) : last
}

function tab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  const id = overrides.id ?? 'inbox/test-document-1.md'
  return {
    id,
    label: basename(id),
    title: 'Test Document 1',
    save: save(),
    kind: 'document',
    ...overrides,
  }
}

describe('deriveDisplayTitle', () => {
  it('uses label when it is set and non-empty', () => {
    expect(deriveDisplayTitle('test-document-1', 'inbox/test-document-1.md'))
      .toBe('test-document-1')
  })

  it('strips the .md extension from the label', () => {
    expect(deriveDisplayTitle('test-document-1.md', 'inbox/test-document-1.md'))
      .toBe('test-document-1')
  })

  it('falls back to the path basename when label is empty', () => {
    expect(deriveDisplayTitle('', 'inbox/test-document-1.md')).toBe('test-document-1')
  })

  it('falls back to the path basename when label is whitespace', () => {
    expect(deriveDisplayTitle('   ', 'inbox/test-document-1.md')).toBe('test-document-1')
  })

  it('does NOT use tab.title even when it is set', () => {
    // The original Edit-07A behavior (which mixed metadata title into
    // the strip) is explicitly forbidden here — the tab strip must
    // always be the filename/basename regardless of what
    // frontmatter says.
    expect(deriveDisplayTitle('test-document-1', 'inbox/test-document-1.md'))
      .not.toBe('测试文档')
  })
})

describe('deriveDocumentTitle', () => {
  it('returns the trimmed title when it is set and differs from the path', () => {
    expect(deriveDocumentTitle('测试文档', 'inbox/test-document-1', 'test-document-1'))
      .toBe('测试文档')
  })

  it('returns null when title is empty', () => {
    expect(deriveDocumentTitle('', 'inbox/test-document-1', 'test-document-1'))
      .toBeNull()
  })

  it('returns null when title is whitespace only', () => {
    expect(deriveDocumentTitle('   ', 'inbox/test-document-1', 'test-document-1'))
      .toBeNull()
  })

  it('returns null when title equals the full path', () => {
    expect(deriveDocumentTitle('inbox/test-document-1', 'inbox/test-document-1', 'test-document-1'))
      .toBeNull()
  })

  it('returns null when title equals displayTitle', () => {
    expect(deriveDocumentTitle('test-document-1', 'inbox/test-document-1', 'test-document-1'))
      .toBeNull()
  })

  it('returns null when title without .md equals displayTitle', () => {
    expect(deriveDocumentTitle('test-document-1.md', 'inbox/test-document-1.md', 'test-document-1'))
      .toBeNull()
  })
})

describe('deriveTabUiPresentation — strip always uses label/basename', () => {
  it('scenario 1 — label + Chinese title + path', () => {
    const t = tab({
      id: 'inbox/test-document-1',
      label: 'test-document-1',
      title: '测试文档',
    })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('test-document-1')
    expect(p.documentTitle).toBe('测试文档')
    expect(p.fullPath).toBe('inbox/test-document-1')
  })

  it('scenario 2 — title equals path; documentTitle line is suppressed', () => {
    const t = tab({
      id: 'inbox/test-document-1',
      label: 'test-document-1',
      title: 'inbox/test-document-1',
    })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('test-document-1')
    expect(p.documentTitle).toBeNull()
    expect(p.fullPath).toBe('inbox/test-document-1')
  })

  it('scenario 3 — title equals displayTitle; documentTitle line is suppressed', () => {
    const t = tab({
      id: 'inbox/test-document-1',
      label: 'test-document-1',
      title: 'test-document-1',
    })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('test-document-1')
    expect(p.documentTitle).toBeNull()
  })

  it('scenario 4 — empty title; documentTitle line is suppressed', () => {
    const t = tab({
      id: 'inbox/test-document-1',
      label: 'test-document-1',
      title: '',
    })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('test-document-1')
    expect(p.documentTitle).toBeNull()
  })

  it('scenario 5 — multiple tabs with mixed-language titles; strip always uses basename', () => {
    const tabs: WorkspaceTab[] = [
      tab({ id: 'inbox/a.md', label: 'a', title: '中文标题' }),
      tab({ id: 'inbox/b.md', label: 'b', title: 'English Title' }),
      tab({ id: 'inbox/c.md', label: 'c', title: '' }),
    ]
    const presentations = tabs.map((t) => deriveTabUiPresentation(t, NO_T))
    expect(presentations.map((p) => p.displayTitle)).toEqual(['a', 'b', 'c'])
    // Strip language NEVER comes from title.
    expect(presentations.map((p) => p.displayTitle)).not.toContain('中文标题')
    expect(presentations.map((p) => p.displayTitle)).not.toContain('English Title')
    // Document titles preserved for tooltip lines.
    expect(presentations[0]!.documentTitle).toBe('中文标题')
    expect(presentations[1]!.documentTitle).toBe('English Title')
    expect(presentations[2]!.documentTitle).toBeNull()
  })

  it('scenario 6 — history/diff keep their existing title semantics', () => {
    const h = tab({
      id: 'history:redis',
      kind: 'history',
      label: 'Redis (历史)',
      title: 'Redis',
    })
    const d = tab({
      id: 'diff:redis',
      kind: 'diff',
      label: 'Redis (差异)',
      title: 'Redis',
    })
    expect(deriveTabUiPresentation(h, NO_T).displayTitle).toBe('Redis (历史)')
    expect(deriveTabUiPresentation(d, NO_T).displayTitle).toBe('Redis (差异)')
    expect(deriveTabUiPresentation(h, NO_T).documentTitle).toBeNull()
    expect(deriveTabUiPresentation(d, NO_T).documentTitle).toBeNull()
    expect(deriveTabUiPresentation(h, NO_T).fullPath).toBeNull()
  })

  it('falls back to path basename when label is empty', () => {
    const t = tab({
      id: 'inbox/production-plan.md',
      label: '',
      title: '',
    })
    const p = deriveTabUiPresentation(t, NO_T)
    expect(p.displayTitle).toBe('production-plan')
    expect(p.fullPath).toBe('inbox/production-plan.md')
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
  it('includes documentTitle + "file <displayTitle>" when documentTitle is present', () => {
    const p = deriveTabUiPresentation(
      tab({ id: 'a.md', label: 'a', title: '测试文档' }),
      stubT,
    )
    expect(p.ariaLabel).toBe('测试文档, file a, Saved')
  })

  it('falls back to displayTitle when documentTitle is null', () => {
    const p = deriveTabUiPresentation(
      tab({ id: 'a.md', label: 'a', title: '' }),
      stubT,
    )
    expect(p.ariaLabel).toBe('a, Saved')
  })

  it('omits documentTitle when it would duplicate displayTitle', () => {
    const p = deriveTabUiPresentation(
      tab({ id: 'a.md', label: 'a', title: 'a' }),
      stubT,
    )
    expect(p.ariaLabel).toBe('a, Saved')
  })

  it('history / diff aria-label keeps the legacy layout (no documentTitle, no status)', () => {
    const h = deriveTabUiPresentation(
      tab({ kind: 'history', label: 'Redis (历史)', title: 'Redis' }),
      NO_T,
    )
    expect(h.ariaLabel).toBe('Redis (历史)')
  })
})