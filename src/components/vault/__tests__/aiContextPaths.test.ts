import { describe, expect, it } from 'vitest'
import type {
  AiDiffContext,
  AiDocumentContext,
  AiHistoryContext,
  AiLiveContextCapture,
  AiLiveContextUnavailableReason,
  AiRecoveryContext,
} from '../../../composables/vault/aiLiveContext'
import {
  displayPathForCapture,
  legacyTransportPathForCapture,
} from '../aiContextPaths'

function documentCapture(path = 'notes/a.md'): AiLiveContextCapture {
  const context: AiDocumentContext = {
    v: 1,
    kind: 'document',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: path,
    identity: { documentId: 'doc-a', path },
    title: 'a',
    raw: 'body',
    revision: 1,
    savedRevision: 1,
    dirty: false,
    saveStatus: 'idle',
  }
  return { status: 'ready', context }
}

function historyCapture(path = 'notes/a.md'): AiLiveContextCapture {
  const context: AiHistoryContext = {
    v: 1,
    kind: 'history',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: `history:${path}`,
    readOnly: true,
    identity: { path, revisionId: 'rev-1', revisionTime: 1 },
    title: 'a',
    raw: 'old body',
  }
  return { status: 'ready', context }
}

function diffCapture(path = 'notes/a.md'): AiLiveContextCapture {
  const context: AiDiffContext = {
    v: 1,
    kind: 'diff',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: `diff:${path}`,
    readOnly: true,
    identity: { path, revisionId: 'rev-1', revisionTime: 1, currentDocumentId: 'doc-a' },
    title: 'a',
    before: { raw: 'old', source: 'history' },
    after: { raw: 'new', source: 'live-editor', dirty: true },
  }
  return { status: 'ready', context }
}

function recoveryCapture(path = 'notes/a.md'): AiLiveContextCapture {
  const context: AiRecoveryContext = {
    v: 1,
    kind: 'recovery',
    capturedAt: 1,
    vaultId: 'vault-a',
    workspaceTabId: `recovery:vault-a:doc-draft-a`,
    readOnly: true,
    identity: { recoveryId: 'r-1', documentId: 'doc-draft-a', path, source: 'primary' },
    title: 'a',
    decisionKind: 'divergent',
    view: 'content',
    draft: { raw: 'draft' },
  }
  return { status: 'ready', context }
}

function unavailable(reason: AiLiveContextUnavailableReason): AiLiveContextCapture {
  return { status: 'unavailable', reason }
}

describe('legacyTransportPathForCapture (Edit-10.2)', () => {
  it('claims the current file path only for a live Document context', () => {
    expect(legacyTransportPathForCapture(documentCapture('notes/a.md'))).toBe('notes/a.md')
  })

  it('sends no path for a History snapshot (the path points at current disk, not the historical body)', () => {
    expect(legacyTransportPathForCapture(historyCapture('notes/a.md'))).toBeUndefined()
  })

  it('sends no path for a Diff (before/after cannot be expressed as one current file)', () => {
    expect(legacyTransportPathForCapture(diffCapture('notes/a.md'))).toBeUndefined()
  })

  it('sends no path for Recovery (the local draft cannot be expressed as a server path)', () => {
    expect(legacyTransportPathForCapture(recoveryCapture('notes/a.md'))).toBeUndefined()
  })

  it('fails closed for every unavailable reason', () => {
    for (const reason of ['loading', 'load-error', 'missing-identity', 'stale-workspace'] as const) {
      expect(legacyTransportPathForCapture(unavailable(reason))).toBeUndefined()
    }
  })

  it('sends no path when there is no context at all', () => {
    expect(legacyTransportPathForCapture({ status: 'none' })).toBeUndefined()
  })
})

describe('displayPathForCapture (Edit-10.2)', () => {
  it('shows the identity path of any ready context kind', () => {
    expect(displayPathForCapture(documentCapture('notes/a.md'))).toBe('notes/a.md')
    expect(displayPathForCapture(historyCapture('notes/h.md'))).toBe('notes/h.md')
    expect(displayPathForCapture(diffCapture('notes/d.md'))).toBe('notes/d.md')
    expect(displayPathForCapture(recoveryCapture('notes/r.md'))).toBe('notes/r.md')
  })

  it('shows nothing while the context is unavailable', () => {
    for (const reason of ['loading', 'load-error', 'missing-identity', 'stale-workspace'] as const) {
      expect(displayPathForCapture(unavailable(reason))).toBeNull()
    }
  })

  it('shows nothing when there is no context', () => {
    expect(displayPathForCapture({ status: 'none' })).toBeNull()
  })
})
