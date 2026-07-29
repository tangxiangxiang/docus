import type { FolderMoveJournalV4 } from './folderMoveTransaction.js'

export type FolderMoveRecoveryStrength = 'strong' | 'weak' | 'unusable'

/**
 * Classify a folder-move journal's recovery strength.
 *
 * Strong journals have every durable site fully populated: v4 with
 * gateProof at the phase-machine gate, every entry carrying
 * dev/ino/hash proof, every declared directory carrying dev/ino
 * proof, and unsafe-numeric dev/ino not used (precision lost).
 *
 * Weak journals are those the parser accepts but recovery cannot
 * trust without further inspection:
 *   - legacy v1/v2/v3 variants (no phase gateProof, no
 *     directoryGenerations).
 *   - v4 at gate-created/files-landed with no gateProof (the
 *     markerless phase-machine variant — anyone could have advanced
 *     the phase without producing a gate token).
 *   - v4 empty-tree journals with no gateProof.
 *   - v4 with mixed proof across entries (some entries lack dev/ino
 *     or hash).
 *   - v4 unsafe-numeric dev/ino (legacy numeric compatibility path;
 *     precision lost).
 *
 * Existing on-disk v4 journals written BEFORE commit 3 (no
 * directoryGenerations field, but with proper entries, gateProof,
 * and phase) are still replayed — they have every other durable
 * site populated. The directoryGenerations field is an additive
 * strengthening, not a hard requirement for backwards compatibility.
 *
 * The classifier is consulted by crashRecovery before any
 * filesystem/SQLite mutation. Weak journals are quarantined with a
 * documented detail — disk state is preserved as-is.
 */
export function classifyFolderMoveRecoveryStrength(
  journal: unknown,
): { strength: FolderMoveRecoveryStrength, reason?: string } {
  if (!journal || typeof journal !== 'object') {
    return { strength: 'unusable', reason: 'not an object' }
  }
  const entry = journal as Record<string, unknown>
  const version = entry.version
  if (version !== 4) {
    // v1/v2/v3 journals never carry directoryGenerations, gateProof,
    // or phase-aligned hash proof — they fail closed by definition.
    return {
      strength: 'weak',
      reason: `legacy journal version ${String(version)} lacks durable phase-machine proof`,
    }
  }
  const phase = entry.phase
  const entries = Array.isArray(entry.entries) ? entry.entries : []
  const gateProof = entry.gateProof
  // v4 markerless: at gate-created/files-landed, with NO entries
  // AND no gateProof. Such a journal has no per-entry dev/ino/hash
  // proof and no gate token to prove the phase advance — anything
  // written to disk has no durable ownership guarantee. Empty-tree
  // journals are also caught by this rule.
  const hasGateProof = gateProof !== undefined && gateProof !== null
    && !(typeof gateProof === 'string' && gateProof.length === 0)
  if ((phase === 'gate-created' || phase === 'files-landed')
    && !hasGateProof && entries.length === 0) {
    return {
      strength: 'weak',
      reason: 'v4 markerless journal: no gateProof and no per-entry proof',
    }
  }
  // Empty-tree journals with no gateProof cannot prove what was on
  // disk — a sibling may have moved/created files in the meantime.
  const emptyTree = entry.emptyTree === true
  if (emptyTree && entries.length === 0
    && (gateProof === undefined || gateProof === null)) {
    return {
      strength: 'weak',
      reason: 'v4 empty-tree journal lacks gateProof',
    }
  }
  // Mixed proof across entries: some carry dev/ino/hash, some don't.
  // The surface area for any single entry that lost durable
  // ownership is the whole tree — fail closed.
  if (entries.length > 0) {
    let hashedCount = 0
    for (const row of entries as Array<Record<string, unknown>>) {
      if (row
        && typeof row.sourceDev === 'string' && /^\d+$/.test(row.sourceDev)
        && typeof row.sourceIno === 'string' && /^[1-9]\d*$/.test(row.sourceIno)
        && typeof row.sourceHash === 'string' && /^[0-9a-f]{64}$/.test(row.sourceHash)) {
        hashedCount += 1
      }
    }
    if (hashedCount !== entries.length) {
      return {
        strength: 'weak',
        reason: `v4 journal has mixed proof across entries (${hashedCount}/${entries.length} hashed)`,
      }
    }
  }
  // v4 unsafe-numeric dev/ino: precision already lost. The parser
  // accepts these for read-only backward compat, but recovery must
  // not act on them.
  if (typeof entry.sourceDev === 'number'
    || typeof entry.sourceIno === 'number') {
    return {
      strength: 'weak',
      reason: 'v4 journal uses unsafe-numeric dev/ino (precision lost)',
    }
  }
  // Markers present — accept as strong.
  return { strength: 'strong' }
}

/**
 * Convenience: was the journal classified strong?
 */
export function isStrongFolderMoveRecovery(
  journal: FolderMoveJournalV4,
): boolean {
  return classifyFolderMoveRecoveryStrength(journal).strength === 'strong'
}