import { describe, expect, it } from 'vitest'
import {
  UNSAVED_DRAFT_VERSION,
  type UnsavedDraft,
} from '../draftTypes'
import type { DraftRecoveryDecisionKind } from '../draftRecoveryDecision'
import type { DraftRecoveryItem } from '../useUnsavedDraftRecovery'
import { recoveryTabId, useDraftRecoveryTabs } from '../useDraftRecoveryTabs'

function item(kind: DraftRecoveryDecisionKind = 'baseline-match'): DraftRecoveryItem {
  const draft: UnsavedDraft = {
    version: UNSAVED_DRAFT_VERSION,
    vaultId: 'vault',
    documentId: 'document-a',
    documentPath: 'notes/a',
    content: 'private draft body',
    baseContentHash: null,
    baseModifiedAt: 1,
    createdAt: 1,
    updatedAt: 2,
  }
  return {
    recoveryId: 'recovery-a',
    draft,
    status: 'ready',
    error: null,
    decision: {
      kind,
      draft,
      disk: {
        status: 'ready',
        documentPath: 'notes/a',
        documentId: 'document-a',
        raw: 'disk',
        mtime: 1,
      },
    },
  }
}

describe('useDraftRecoveryTabs', () => {
  it('keeps Recovery tabs separate, stable, and free of content in the id', () => {
    const recovery = useDraftRecoveryTabs()
    const opened = recovery.open(item('divergent'), 'diff')

    expect(opened?.tabId).toBe(recoveryTabId('vault', 'document-a'))
    expect(opened?.tabId).not.toContain('private draft body')
    expect(recovery.activeTab.value?.view).toBe('diff')
    recovery.open(item('divergent'), 'content')
    expect(recovery.tabs.value).toHaveLength(1)
    expect(recovery.activeTab.value?.view).toBe('content')
  })

  it('closes views without changing recovery storage state', () => {
    const recovery = useDraftRecoveryTabs()
    const opened = recovery.open(item(), 'content')!
    recovery.close(opened.tabId)
    expect(recovery.tabs.value).toEqual([])
    expect(recovery.activeTab.value).toBeNull()
  })

  it('derives current-document and diff capabilities from the disk snapshot', () => {
    const recovery = useDraftRecoveryTabs()
    const matching = recovery.open(item('unknown'), 'diff')!
    expect(matching).toMatchObject({
      canViewCurrent: true,
      canViewDiff: true,
      view: 'diff',
    })

    const unreadable = item('unknown')
    unreadable.decision!.disk = {
      status: 'unreadable',
      documentPath: 'notes/a',
      error: 'private',
    }
    const unavailable = recovery.open(unreadable, 'diff')!
    expect(unavailable).toMatchObject({
      diskStatus: 'unreadable',
      diskDocumentId: null,
      canViewCurrent: false,
      canViewDiff: false,
      view: 'content',
    })

    const mismatched = item('identity-mismatch')
    if (mismatched.decision?.disk.status === 'ready') {
      mismatched.decision.disk.documentId = 'replacement'
    }
    const reused = recovery.open(mismatched, 'content')!
    expect(reused.canViewCurrent).toBe(false)
    expect(reused.canViewDiff).toBe(true)
  })
})
