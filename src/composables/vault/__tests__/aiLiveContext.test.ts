import { describe, expect, it } from 'vitest'
import {
  captureAiLiveContext,
  liveEditorForPath,
  type AiDiffContext,
  type AiDiffSource,
  type AiDocumentContext,
  type AiDocumentSource,
  type AiHistoryContext,
  type AiHistorySource,
  type AiLiveContextCapture,
  type AiLiveContextInput,
  type AiRecoveryContext,
  type AiRecoverySource,
} from '../aiLiveContext'

function documentTab(overrides: Partial<AiDocumentSource> = {}): AiDocumentSource {
  return {
    path: 'inbox/ideas',
    documentId: 'doc-a',
    title: 'Ideas',
    raw: '# Ideas\n\nlive body',
    revision: 5,
    savedRevision: 4,
    saveStatus: 'dirty',
    loading: false,
    loadError: null,
    externalKind: null,
    externalRaw: null,
    ...overrides,
  }
}

function historySnapshot(overrides: Partial<AiHistorySource> = {}): AiHistorySource {
  return {
    tabId: 'history:inbox/redis',
    documentPath: 'inbox/redis',
    documentTitle: 'Redis Notes',
    revisionId: 'rev-9',
    revisionTime: 1752566260000,
    rawMarkdown: '# Redis\n\nhistorical body',
    status: 'ready',
    ...overrides,
  }
}

function historyComparison(overrides: Partial<AiDiffSource> = {}): AiDiffSource {
  return {
    tabId: 'diff:inbox/redis',
    documentPath: 'inbox/redis',
    documentTitle: 'Redis Notes',
    revisionId: 'rev-9',
    revisionTime: 1752566260000,
    oldRaw: '# Redis\n\nold side',
    newRaw: '# Redis\n\nsnapshot side',
    currentDirty: false,
    status: 'ready',
    ...overrides,
  }
}

function recoveryTab(overrides: Partial<AiRecoverySource> = {}): AiRecoverySource {
  return {
    tabId: 'recovery:vault:doc-a',
    recoveryId: 'rec-1',
    source: 'primary',
    documentId: 'doc-a',
    documentPath: 'inbox/ideas',
    documentTitle: 'Ideas',
    decisionKind: 'divergent',
    diskStatus: 'ready',
    diskDocumentId: 'doc-a',
    view: 'content',
    draftRaw: '# Ideas\n\ndraft body',
    diskRaw: '# Ideas\n\ndisk body',
    status: 'ready',
    ...overrides,
  }
}

function input(overrides: Partial<AiLiveContextInput> = {}): AiLiveContextInput {
  return {
    vaultId: 'vault',
    activeWorkspaceTabId: null,
    documentTabs: [],
    historySnapshots: [],
    historyComparisons: [],
    recoveryTabs: [],
    ...overrides,
  }
}

function readyContext(capture: AiLiveContextCapture) {
  expect(capture.status).toBe('ready')
  if (capture.status !== 'ready') throw new Error('capture is not ready')
  return capture.context
}

function readyDocument(capture: AiLiveContextCapture): AiDocumentContext {
  const context = readyContext(capture)
  expect(context.kind).toBe('document')
  if (context.kind !== 'document') throw new Error(`expected document context, got ${context.kind}`)
  return context
}

function readyHistory(capture: AiLiveContextCapture): AiHistoryContext {
  const context = readyContext(capture)
  expect(context.kind).toBe('history')
  if (context.kind !== 'history') throw new Error(`expected history context, got ${context.kind}`)
  return context
}

function readyDiff(capture: AiLiveContextCapture): AiDiffContext {
  const context = readyContext(capture)
  expect(context.kind).toBe('diff')
  if (context.kind !== 'diff') throw new Error(`expected diff context, got ${context.kind}`)
  return context
}

function readyRecovery(capture: AiLiveContextCapture): AiRecoveryContext {
  const context = readyContext(capture)
  expect(context.kind).toBe('recovery')
  if (context.kind !== 'recovery') throw new Error(`expected recovery context, got ${context.kind}`)
  return context
}

const NOW = 1753084800000

describe('captureAiLiveContext', () => {
  describe('document context', () => {
    it('captures the latest tab.raw of a dirty document', () => {
      const tab = documentTab({ raw: '# Ideas\n\nlatest keystroke' })
      const capture = captureAiLiveContext(
        input({ activeWorkspaceTabId: 'inbox/ideas', documentTabs: [tab] }),
        { now: () => NOW },
      )

      expect(capture).toEqual({
        status: 'ready',
        context: {
          v: 1,
          kind: 'document',
          capturedAt: NOW,
          vaultId: 'vault',
          workspaceTabId: 'inbox/ideas',
          identity: { documentId: 'doc-a', path: 'inbox/ideas' },
          title: 'Ideas',
          raw: '# Ideas\n\nlatest keystroke',
          revision: 5,
          savedRevision: 4,
          dirty: true,
          saveStatus: 'dirty',
        },
      })
    })

    it('sends an empty body verbatim instead of falling back', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({ raw: '', revision: 3, savedRevision: 3, saveStatus: 'saved' })],
      }))

      const context = readyDocument(capture)
      expect(context.raw).toBe('')
      expect(context.dirty).toBe(false)
    })

    it('only sends the active tab when two document tabs are open', () => {
      const dirtyA = documentTab({ path: 'inbox/a', documentId: 'doc-a', raw: 'A body', saveStatus: 'dirty' })
      const cleanB = documentTab({
        path: 'inbox/b',
        documentId: 'doc-b',
        title: 'B',
        raw: 'B body',
        revision: 2,
        savedRevision: 2,
        saveStatus: 'saved',
      })
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/b',
        documentTabs: [dirtyA, cleanB],
      }))

      const context = readyDocument(capture)
      expect(context.identity).toEqual({ documentId: 'doc-b', path: 'inbox/b' })
      expect(context.raw).toBe('B body')
      expect(JSON.stringify(context)).not.toContain('A body')
    })

    it('never sends an inactive dirty tab while a clean tab is active', () => {
      const dirtyA = documentTab({ path: 'inbox/a', raw: 'unsaved A', saveStatus: 'dirty' })
      const cleanB = documentTab({
        path: 'inbox/b',
        documentId: 'doc-b',
        raw: 'saved B',
        revision: 1,
        savedRevision: 1,
        saveStatus: 'saved',
      })
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/b',
        documentTabs: [dirtyA, cleanB],
      }))

      const context = readyDocument(capture)
      expect(context.raw).toBe('saved B')
      expect(JSON.stringify(context)).not.toContain('unsaved A')
    })

    it('reports loading instead of returning stale content', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({ loading: true, raw: 'stale' })],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'loading' })
    })

    it('reports load-error instead of returning stale content', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({ loadError: 'fetch failed', raw: 'stale' })],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'load-error' })
    })

    it('reports missing-identity when documentId is null', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({ documentId: null })],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'missing-identity' })
    })

    it('reports missing-identity when documentId is undefined', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({ documentId: undefined })],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'missing-identity' })
    })

    it('captures normally while saveStatus is offline', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({ saveStatus: 'offline' })],
      }))

      const context = readyDocument(capture)
      expect(context.saveStatus).toBe('offline')
      expect(context.raw).toBe('# Ideas\n\nlive body')
    })

    it('uses the buffer revision, not the in-flight savingRevision', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        // Mid-save: revision 7 is on screen, revision 6 is in flight.
        documentTabs: [documentTab({ revision: 7, savedRevision: 5, saveStatus: 'saving' })],
      }))

      const context = readyDocument(capture)
      expect(context.revision).toBe(7)
      expect(context.savedRevision).toBe(5)
      expect(context.dirty).toBe(true)
    })

    it('carries an external modified conflict with its raw', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({
          saveStatus: 'external',
          externalKind: 'modified',
          externalRaw: '# Ideas\n\nexternal version',
        })],
      }))

      const context = readyDocument(capture)
      expect(context.external).toEqual({
        kind: 'modified',
        raw: '# Ideas\n\nexternal version',
      })
      expect(context.raw).toBe('# Ideas\n\nlive body')
    })

    it('carries an external delete with a null raw', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab({
          saveStatus: 'external',
          externalKind: 'deleted',
          externalRaw: null,
        })],
      }))

      const context = readyDocument(capture)
      expect(context.external).toEqual({ kind: 'deleted', raw: null })
    })
  })

  describe('history context', () => {
    it('sends the ready snapshot raw with its revision identity', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'history:inbox/redis',
        historySnapshots: [historySnapshot()],
      }), { now: () => NOW })

      expect(capture).toEqual({
        status: 'ready',
        context: {
          v: 1,
          kind: 'history',
          capturedAt: NOW,
          vaultId: 'vault',
          workspaceTabId: 'history:inbox/redis',
          readOnly: true,
          identity: { path: 'inbox/redis', revisionId: 'rev-9', revisionTime: 1752566260000 },
          title: 'Redis Notes',
          raw: '# Redis\n\nhistorical body',
        },
      })
    })

    it('reports loading before the snapshot is ready', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'history:inbox/redis',
        historySnapshots: [historySnapshot({ status: 'loading', rawMarkdown: 'partial' })],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'loading' })
    })

    it('reports load-error even when a stale body is still held', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'history:inbox/redis',
        historySnapshots: [historySnapshot({ status: 'error', rawMarkdown: '# stale' })],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'load-error' })
    })
  })

  describe('diff context', () => {
    it('re-reads the after side from the live editor at capture time', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        historyComparisons: [historyComparison({ newRaw: '# Redis\n\nsnapshot side', currentDirty: false })],
      }), {
        now: () => NOW,
        liveDocument: () => ({ raw: '# Redis\n\ntyped after the diff opened', dirty: true, documentId: 'doc-r' }),
      })

      const context = readyDiff(capture)
      expect(context.before).toEqual({ raw: '# Redis\n\nold side', source: 'history' })
      expect(context.after).toEqual({
        raw: '# Redis\n\ntyped after the diff opened',
        source: 'live-editor',
        dirty: true,
      })
      expect(context.identity.currentDocumentId).toBe('doc-r')
    })

    it('prefers the live editor over a stale comparison snapshot', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        historyComparisons: [historyComparison({ newRaw: 'stale snapshot', currentDirty: false })],
      }), {
        liveDocument: () => ({ raw: 'fresh buffer', dirty: true, documentId: 'doc-r' }),
      })

      const context = readyDiff(capture)
      expect(context.after.raw).toBe('fresh buffer')
      expect(context.after.source).toBe('live-editor')
      expect(JSON.stringify(context)).not.toContain('stale snapshot')
    })

    it('falls back to the comparison snapshot when no editor is loaded', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        historyComparisons: [historyComparison({ newRaw: '# Redis\n\nsnapshot side', currentDirty: true })],
      }), { liveDocument: () => null })

      const context = readyDiff(capture)
      expect(context.after).toEqual({
        raw: '# Redis\n\nsnapshot side',
        source: 'comparison-snapshot',
        dirty: true,
      })
      expect(context.identity.currentDocumentId).toBeNull()
    })

    it('defaults the live lookup to null when not injected', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        historyComparisons: [historyComparison()],
      }))

      const context = readyDiff(capture)
      expect(context.after.source).toBe('comparison-snapshot')
      expect(context.identity.currentDocumentId).toBeNull()
    })

    it('reports missing-identity when the live editor lacks a documentId', () => {
      // A loaded buffer with no stable identity (metadata missing, stale
      // tab restore, path reuse in flight) must NOT be sent as the
      // after side — and must NOT silently fall back to the comparison's
      // stale newRaw either.
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        historyComparisons: [historyComparison({ newRaw: '# Redis\n\nstale snapshot body' })],
      }), {
        liveDocument: () => ({ raw: '# Redis\n\nidentity-less buffer', dirty: true, documentId: null }),
      })

      expect(capture).toEqual({ status: 'unavailable', reason: 'missing-identity' })
      expect(JSON.stringify(capture)).not.toContain('identity-less buffer')
      expect(JSON.stringify(capture)).not.toContain('stale snapshot body')
    })

    it('reports loading and load-error for a non-ready comparison', () => {
      const loading = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        historyComparisons: [historyComparison({ status: 'loading' })],
      }))
      const errored = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        historyComparisons: [historyComparison({ status: 'error' })],
      }))

      expect(loading).toEqual({ status: 'unavailable', reason: 'loading' })
      expect(errored).toEqual({ status: 'unavailable', reason: 'load-error' })
    })
  })

  describe('recovery context', () => {
    it('sends only the draft in content view, never the hidden disk body', () => {
      // The tab's disk side IS readable here — content view must still
      // not carry it, because the user is only looking at the draft.
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a',
        recoveryTabs: [recoveryTab({ view: 'content' })],
      }), { now: () => NOW })

      expect(capture).toEqual({
        status: 'ready',
        context: {
          v: 1,
          kind: 'recovery',
          capturedAt: NOW,
          vaultId: 'vault',
          workspaceTabId: 'recovery:vault:doc-a',
          readOnly: true,
          identity: {
            recoveryId: 'rec-1',
            documentId: 'doc-a',
            path: 'inbox/ideas',
            source: 'primary',
          },
          title: 'Ideas',
          decisionKind: 'divergent',
          view: 'content',
          draft: { raw: '# Ideas\n\ndraft body' },
        },
      })
      if (capture.status !== 'ready') return
      const context = readyRecovery(capture)
      expect(context.disk).toBeUndefined()
      expect(JSON.stringify(context)).not.toContain('disk body')
    })

    it('sends both sides in diff view', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a',
        recoveryTabs: [recoveryTab({ view: 'diff' })],
      }))

      const context = readyRecovery(capture)
      expect(context.view).toBe('diff')
      expect(context.draft.raw).toBe('# Ideas\n\ndraft body')
      expect(context.disk).toEqual({ documentId: 'doc-a', raw: '# Ideas\n\ndisk body' })
    })

    it('preserves both documentIds on identity mismatch in diff view', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a',
        recoveryTabs: [recoveryTab({
          decisionKind: 'identity-mismatch',
          documentId: 'doc-a',
          diskDocumentId: 'doc-b',
          view: 'diff',
        })],
      }))

      const context = readyRecovery(capture)
      expect(context.identity.documentId).toBe('doc-a')
      expect(context.disk?.documentId).toBe('doc-b')
    })

    it('downgrades diff view to content when the disk is readable but its raw is null', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a',
        recoveryTabs: [recoveryTab({
          view: 'diff',
          diskStatus: 'ready',
          diskRaw: null,
          diskDocumentId: null,
        })],
      }))

      const context = readyRecovery(capture)
      expect(context.view).toBe('content')
      expect(context.draft.raw).toBe('# Ideas\n\ndraft body')
      expect(context.disk).toBeUndefined()
    })

    it('carries a conflict source through the identity', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a:rec-1',
        recoveryTabs: [recoveryTab({ tabId: 'recovery:vault:doc-a:rec-1', source: 'conflict' })],
      }))

      const context = readyRecovery(capture)
      expect(context.identity.source).toBe('conflict')
    })

    it('omits the disk block and downgrades the view when the disk is missing', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a',
        recoveryTabs: [recoveryTab({
          view: 'diff',
          diskStatus: 'missing',
          diskRaw: null,
          diskDocumentId: null,
          decisionKind: 'missing-source',
        })],
      }))

      const context = readyRecovery(capture)
      expect(context.view).toBe('content')
      expect(context.draft.raw).toBe('# Ideas\n\ndraft body')
      expect(context.disk).toBeUndefined()
    })

    it('reports load-error for an errored recovery tab', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a',
        recoveryTabs: [recoveryTab({ status: 'error', draftRaw: 'stale' })],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'load-error' })
    })
  })

  describe('resolution priority and workspace state', () => {
    it('returns none when there is no active workspace tab', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: null,
        documentTabs: [documentTab()],
      }))

      expect(capture).toEqual({ status: 'none' })
    })

    it('returns none when there is no vault', () => {
      const capture = captureAiLiveContext(input({
        vaultId: null,
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab()],
      }))

      expect(capture).toEqual({ status: 'none' })
    })

    it('lets an active recovery win over loaded document tabs', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'recovery:vault:doc-a',
        documentTabs: [documentTab({ raw: 'behind-the-dialog document' })],
        recoveryTabs: [recoveryTab()],
      }))

      const context = readyRecovery(capture)
      expect(JSON.stringify(context)).not.toContain('behind-the-dialog document')
    })

    it('lets an active diff win over the document tab for the same path', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'diff:inbox/redis',
        documentTabs: [documentTab({ path: 'inbox/redis', documentId: 'doc-r' })],
        historyComparisons: [historyComparison()],
      }), {
        liveDocument: () => ({ raw: 'live', dirty: false, documentId: 'doc-r' }),
      })

      readyDiff(capture)
    })

    it('lets an active history snapshot win over document tabs', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'history:inbox/redis',
        documentTabs: [documentTab({ path: 'inbox/redis', documentId: 'doc-r', raw: 'live buffer' })],
        historySnapshots: [historySnapshot()],
      }))

      const context = readyHistory(capture)
      expect(context.raw).toBe('# Redis\n\nhistorical body')
    })

    it('reports stale-workspace when the active id matches nothing', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/closed-meanwhile',
        documentTabs: [documentTab()],
      }))

      expect(capture).toEqual({ status: 'unavailable', reason: 'stale-workspace' })
    })
  })

  describe('capture semantics', () => {
    it('copies by value so later mutation of the source does not leak in', () => {
      const tab = documentTab({ raw: 'body at send time' })
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [tab],
      }))

      // The user keeps typing / the tab object mutates after Send.
      tab.raw = 'body typed after send'
      tab.title = 'Retitled'

      const context = readyDocument(capture)
      expect(context.raw).toBe('body at send time')
      expect(context.title).toBe('Ideas')
    })

    it('stamps capturedAt from the injected clock', () => {
      const capture = captureAiLiveContext(input({
        activeWorkspaceTabId: 'inbox/ideas',
        documentTabs: [documentTab()],
      }), { now: () => 1234567890 })

      const context = readyContext(capture)
      expect(context.capturedAt).toBe(1234567890)
    })
  })
})

describe('liveEditorForPath', () => {
  it('returns the live buffer with revision-based dirtiness and identity', () => {
    const tabs = [
      documentTab({ path: 'inbox/a', documentId: 'doc-a', revision: 3, savedRevision: 3 }),
      documentTab({ path: 'inbox/b', documentId: 'doc-b', raw: 'B', revision: 4, savedRevision: 2 }),
    ]

    expect(liveEditorForPath(tabs, 'inbox/b')).toEqual({
      raw: 'B',
      dirty: true,
      documentId: 'doc-b',
    })
    expect(liveEditorForPath(tabs, 'inbox/a')?.dirty).toBe(false)
  })

  it('returns null when no tab is open for the path', () => {
    expect(liveEditorForPath([documentTab()], 'inbox/elsewhere')).toBeNull()
  })

  it('returns null for a loading tab', () => {
    expect(liveEditorForPath([documentTab({ loading: true })], 'inbox/ideas')).toBeNull()
  })

  it('returns null for a tab that failed to load', () => {
    expect(liveEditorForPath(
      [documentTab({ loadError: 'fetch failed' })],
      'inbox/ideas',
    )).toBeNull()
  })

  it('normalizes a missing documentId to null', () => {
    expect(liveEditorForPath(
      [documentTab({ documentId: undefined })],
      'inbox/ideas',
    )?.documentId).toBeNull()
  })
})
