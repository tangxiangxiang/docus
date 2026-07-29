import path from 'node:path'

import { promises as fs } from 'node:fs'

import {
  rewriteDurableJournal,
} from './atomicTextWrite.js'
import {
  parseRenameReferenceJournalObject,
  type RenameReferenceJournalEntry,
} from './renameReferenceJournal.js'
import { isPhysicallyContained } from './documentFileLifecycle.js'

export type RenameReferenceOwnerDisposition =
  | { kind: 'legacy-prefix-move' }
  | { kind: 'folder-snapshot-owned', ownerJournal: string, ownerTransactionId: string, ownerDescriptorHash: string, metadataHandled: boolean }
  | {
    kind: 'folder-snapshot-owner-pending',
    ownerJournal: string,
    ownerTransactionId: string,
    ownerDescriptorHash: string,
    previousDirection: 'roll-forward' | 'roll-back',
  }

export type FolderRaceOwnerHooks = {
  afterBindOwnerPending?: () => void | Promise<void>
  afterV4OwnerJournalDurable?: () => void | Promise<void>
  afterOwnerDurableMark?: () => void | Promise<void>
}
let __ownerRaceHooks: FolderRaceOwnerHooks | null = null
export function __setFolderMoveOwnerRaceHooksForTesting(hooks: FolderRaceOwnerHooks | null): void {
  __ownerRaceHooks = hooks
}

/**
 * Step one of the P0-1 owner binding protocol: rewrite the companion
 * journal as folder-snapshot-owner-pending BEFORE the durable v4 owner
 * folder journal is written. This produces a durable "started but not
 * yet committed" state that recovery can reconcile on startup.
 *
 * On a crash between bindOwnerPending and the v4 owner folder journal
 * rewrite, the companion remains owner-pending and recovery must NOT
 * silently defer it — recovery must either promote the owner binding
 * (if the v4 journal is on disk and matches) or quarantine it (if the
 * v4 journal is missing or mismatched).
 */
export type RenameReferenceOwnerEntryShape = RenameReferenceJournalEntry & {
  phase: RenameReferenceJournalEntry['phase']
  metadataDisposition?: never
}

export async function bindOwnerPending(input: {
  journalPath: string
  phase: RenameReferenceJournalEntry['phase']
  baseEntry: RenameReferenceJournalEntry
  descriptorHash: string
  owner: { ownerJournal: string, ownerTransactionId: string }
}): Promise<void> {
  const disposition: RenameReferenceOwnerDisposition = {
    kind: 'folder-snapshot-owner-pending',
    ownerJournal: input.owner.ownerJournal,
    ownerTransactionId: input.owner.ownerTransactionId,
    ownerDescriptorHash: input.descriptorHash,
    previousDirection: input.phase === 'roll-back' ? 'roll-back' : 'roll-forward',
  }
  await rewriteDurableJournal(input.journalPath, {
    ...input.baseEntry,
    phase: input.phase,
    metadataDisposition: disposition,
  })
  if (__ownerRaceHooks?.afterBindOwnerPending) {
    await __ownerRaceHooks.afterBindOwnerPending()
  }
}

/**
 * Step three of the P0-1 owner binding protocol: rewrite the companion
 * journal as folder-snapshot-owned / metadataHandled=false AFTER the
 * durable v4 owner folder journal is on disk and validated.
 */
export async function markOwnerDurable(input: {
  journalPath: string
  phase: RenameReferenceJournalEntry['phase']
  baseEntry: RenameReferenceJournalEntry
  owner: { ownerJournal: string, ownerTransactionId: string }
  descriptorHash: string
}): Promise<void> {
  await rewriteDurableJournal(input.journalPath, {
    ...input.baseEntry,
    phase: input.phase,
    metadataDisposition: {
      kind: 'folder-snapshot-owned',
      ownerJournal: input.owner.ownerJournal,
      ownerTransactionId: input.owner.ownerTransactionId,
      ownerDescriptorHash: input.descriptorHash,
      metadataHandled: false,
    },
  })
  if (__ownerRaceHooks?.afterOwnerDurableMark) {
    await __ownerRaceHooks.afterOwnerDurableMark()
  }
}

/**
 * Step four: when the rename handoff is complete, mark handled (the
 * equivalent of markRenameReferenceMetadataHandled, but uses the
 * unified P0-1 state machine).
 */
export async function markOwnerHandled(input: {
  journalPath: string
  owner: { ownerJournal: string, ownerTransactionId: string, ownerDescriptorHash: string }
}): Promise<boolean> {
  const raw = await fs.readFile(input.journalPath, 'utf8')
  const parsed = parseRenameReferenceJournalObject(JSON.parse(raw))
  if (!parsed
    || parsed.metadataDisposition?.kind !== 'folder-snapshot-owned'
    || parsed.metadataDisposition.ownerJournal !== input.owner.ownerJournal
    || parsed.metadataDisposition.ownerTransactionId !== input.owner.ownerTransactionId
    || parsed.metadataDisposition.ownerDescriptorHash !== input.owner.ownerDescriptorHash) {
    return false
  }
  if (parsed.metadataDisposition.metadataHandled) return true
  await rewriteDurableJournal(input.journalPath, {
    ...parsed,
    metadataDisposition: { ...parsed.metadataDisposition, metadataHandled: true },
  })
  return true
}

export type ReconcilePendingResult =
  | { action: 'promote', reason: 'owner journal matches' }
  | { action: 'quarantine', reason: string }
  | { action: 'no-action', reason: string }

/**
 * Reconcile a companion journal whose metadataDisposition is
 * folder-snapshot-owner-pending. This runs at the START of
 * recoverRenameReferencesJournal — before the
 * metadataHandled:false early return — so the companion can either be
 * promoted to folder-snapshot-owned (if the v4 owner folder journal is
 * on disk and matches) or quarantined (if the v4 journal is absent or
 * mismatched). Either way, recovery advances the companion and never
 * silently defers it.
 */
export async function reconcilePendingRenameReferenceOwner(input: {
  contentDir: string
  journalPath: string
  entry: RenameReferenceJournalEntry
  ownerDescriptorHash: string
}): Promise<ReconcilePendingResult> {
  const disposition = input.entry.metadataDisposition
  if (disposition?.kind !== 'folder-snapshot-owner-pending') {
    return { action: 'no-action', reason: 'not in owner-pending state' }
  }
  const ownerJournalRel = disposition.ownerJournal
  const ownerJournalAbs = path.join(path.dirname(input.journalPath), ownerJournalRel)
  try {
    if (!await isPhysicallyContained(input.contentDir, ownerJournalAbs)) {
      return {
        action: 'quarantine',
        reason: `companion owner-binding pending and owner journal escapes the vault: ${ownerJournalRel}`,
      }
    }
    const ownerStat = await fs.lstat(ownerJournalAbs, { bigint: true })
    if (!ownerStat.isFile() || ownerStat.isSymbolicLink()) {
      return {
        action: 'quarantine',
        reason: `companion owner-binding pending and owner journal is not a real file: ${ownerJournalRel}`,
      }
    }
  } catch {
    // The owner folder journal is absent. The v4 owner rename never
    // flipped durable before the route crashed between bindOwnerPending
    // and the durable v4 owner journal rewrite. The companion cannot
    // promote; fail closed by quarantining with the documented detail.
    return {
      action: 'quarantine',
      reason: 'rename-reference owner-binding pending and owner folder journal is absent',
    }
  }
  // Owner folder journal exists: validate that the journal entry binds
  // to the exact transactionId and descriptorHash the companion claims.
  let ownerEntry: unknown
  try {
    ownerEntry = JSON.parse(await fs.readFile(ownerJournalAbs, 'utf8'))
  } catch {
    return {
      action: 'quarantine',
      reason: 'rename-reference owner-binding pending and owner folder journal is unreadable',
    }
  }
  if (!ownerEntry || typeof ownerEntry !== 'object') {
    return {
      action: 'quarantine',
      reason: 'rename-reference owner-binding pending and owner folder journal is unreadable',
    }
  }
  const ownerObj = ownerEntry as Record<string, unknown>
  if (typeof ownerObj.transactionId !== 'string'
    || ownerObj.transactionId !== disposition.ownerTransactionId) {
    return {
      action: 'quarantine',
      reason: 'rename-reference owner-binding transactionId mismatch',
    }
  }
  // The companion owner descriptorHash must match the descriptor hash
  // built from the companion's own stable descriptor; if the v4 owner
  // folder journal carries a different hash it cannot be the same
  // transaction (a malicious journal cannot bind to the companion).
  if (disposition.ownerDescriptorHash !== input.ownerDescriptorHash) {
    return {
      action: 'quarantine',
      reason: 'rename-reference owner-binding descriptorHash mismatch',
    }
  }
  // All checks pass: promote to folder-snapshot-owned (metadataHandled=false).
  // Recovery will continue; if the owner journal completes its handoff,
  // the companion is consumed; otherwise it remains a pinned dependent.
  await rewriteDurableJournal(input.journalPath, {
    ...input.entry,
    metadataDisposition: {
      kind: 'folder-snapshot-owned',
      ownerJournal: disposition.ownerJournal,
      ownerTransactionId: disposition.ownerTransactionId,
      ownerDescriptorHash: disposition.ownerDescriptorHash,
      metadataHandled: false,
    },
  })
  return { action: 'promote', reason: 'owner journal matches' }
}
