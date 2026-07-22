// Startup crash recovery for the atomic write/delete protocols.
//
// The atomic replace protocol (server/atomicTextWrite.ts) commits by
// taking the current generation aside to a private staging path,
// verifying it, and linking the new generation in create-only. Between
// the takeover rename and the link the formal path does not exist; if
// the process dies there (kill -9, power loss, container stop) the
// vault is left with the formal path MISSING and only hidden staging
// files — the note appears to vanish, because vault traversal only
// sees *.md names. The delete protocols stage generations under
// `.docus-delete-inflight-*` names with the same exposure.
//
// recoverInterruptedOperations() runs at startup BEFORE the HTTP
// server accepts requests (server/prod.ts, server/vite-plugin.ts) and
// reconciles every reserved-pattern artifact it finds. The rules never
// destroy user data they cannot prove stale:
//
//   * journaled replace, staged + no target: complete the commit when
//     BOTH generations still match the journaled hashes; otherwise
//     restore the old generation (create-only — a path claimed
//     externally during recovery quarantines the staged bytes instead
//     of clobbering the new one);
//   * journaled replace, staged + target present: the commit landed or
//     an external writer won the path — clean the staging (staged ==
//     the caller's verified base, which the caller held);
//   * journaled replace, no staged: the takeover never happened —
//     remove the stale journal (and an uncommitted save temp whose
//     target still exists);
//   * journal-less staged/remove temps: restore the bytes create-only
//     when the path is empty; leave them quarantined when claimed;
//   * journal-less save temp: remove it when the target exists (it
//     never committed); keep + report it when the target is gone
//     (intent cannot be guessed);
//   * `.docus-delete-inflight-*` with the target still empty:
//     COMPLETE the interrupted delete (the deletion was initiated and
//     validated; leaving the metadata row would bind an identity to a
//     missing file); target re-occupied: leave the quarantine as the
//     path-reuse branch intended; explicit `.docus-quarantine-reuse-*`
//     artifacts are never auto-deleted, even if the path later empties;
//   * journaled folder rename (op 'folder-rename'): the directory move
//     is a single rename(2) over our own mkdir-gated empty directory,
//     so after a crash the whole tree sits at exactly one of the two
//     paths. Source tree still present: the move never landed — remove
//     the stale journal (and our own EMPTY gate directory at the
//     destination, proven ours by being empty); source gone +
//     destination present: the move landed — COMPLETE the metadata
//     prefix move (idempotent) and remove the journal;
//   * journal-less `.docus-rename-*` staging (create-only file move):
//     the protocol takes the source aside, links it into the
//     destination (create-only), and unlinks the staging name. A crash
//     between link and unlink leaves two names on one inode — an
//     inode scan finds the destination partner, the staging name is
//     removed, and the metadata move completes. No partner: the crash
//     hit between takeover and link — restore the source create-only
//     (a re-used source quarantines the staging instead).
//
// Every pattern name is reserved by the vault path syntax
// (server/paths.ts): no legal document or folder name can contain a
// dot segment, so these artifacts are unambiguous. Recovery never
// throws — per-item failures are reported and left on disk — and never
// logs file CONTENT: paths and actions only.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import type { Database as DatabaseT } from 'better-sqlite3'
import { removeDurableJournal, rewriteDurableJournal, sha256Hex, syncParentDirectoryBestEffort, writeDurableJournal } from './atomicTextWrite.js'
import { isValidPathSyntax } from './paths.js'
import {
  deleteDocumentMetadata,
  deleteDocumentMetadataPrefix,
  getDocumentMetadata,
  listDocumentMetadata,
  moveDocumentMetadataPrefix,
  moveDocumentMetadataReplacingDestination,
} from './documentMetadata.js'

export interface RecoveryAction {
  /** Vault-relative path of the affected file/folder (or artifact). */
  readonly file: string
  /** completed-save | completed-rename | restored | completed-delete | cleaned | quarantined | failed */
  readonly action: 'completed-save' | 'completed-rename' | 'restored' | 'completed-delete' | 'cleaned' | 'quarantined' | 'failed'
  readonly detail?: string
}

export interface RecoveryReport {
  readonly actions: readonly RecoveryAction[]
}

interface ReplaceJournal {
  version: 1
  op: 'replace'
  staged: string
  replacement: string
  expectedHash: string
  replacementHash: string
  phase?: 'manual-recovery-required'
}

interface FolderRenameJournal {
  version: 1
  op: 'folder-rename'
  /** Vault-relative folder paths (no leading/trailing slash). */
  srcRel: string
  destRel: string
  sourceDev: number
  sourceIno: number
}

interface FileRenameJournal {
  version: 1
  op: 'file-rename'
  srcRel: string
  destRel: string
  staging?: string
  documentId?: string
  sourceHash: string
}

interface DeleteReuseManifest {
  version: 1
  op: 'delete-path-reuse'
  kind: 'file' | 'folder'
  path: string
  inflight: string
  quarantine: string
  identities: Array<{ path: string; id: string }>
}

// Reserved artifact name patterns (see file header for why they are
// unambiguous). The capture is the target's basename.
const JOURNAL_RE = /^\.(.+)\.docus-journal-[0-9a-f-]+$/
const STAGED_RE = /^\.(.+)\.docus-staged-[0-9a-f-]+$/
const SAVE_RE = /^\.(.+)\.docus-save-[0-9a-f-]+$/
const REMOVE_RE = /^\.(.+)\.docus-remove-[0-9a-f-]+$/
const RENAME_RE = /^\.(.+)\.docus-rename-[0-9a-f-]+$/
const DELETE_RE = /^(.+)\.docus-delete-\d+$/
const DELETE_INFLIGHT_RE = /^(.+)\.docus-delete-inflight-[0-9a-f-]+$/
const DELETE_QUARANTINE_RE = /^(.+)\.docus-quarantine-reuse-[0-9a-f-]+$/
const DELETE_MANIFEST_RE = /^\.(.+)\.docus-delete-manifest-[0-9a-f-]+$/

interface ArtifactGroup {
  base: string
  journals: string[]
  staged: string[]
  save: string[]
  remove: string[]
  rename: string[]
  quarantines: string[]
  deleteManifests: string[]
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.stat(absPath)
    return true
  } catch {
    return false
  }
}

async function rm(absPath: string): Promise<void> {
  await fs.rm(absPath, { force: true, recursive: false }).catch(() => {})
}

async function hashMatches(absPath: string, expectedHash: string): Promise<boolean> {
  try {
    return sha256Hex(await fs.readFile(absPath, 'utf8')) === expectedHash
  } catch {
    return false
  }
}

/** link(2) is create-only: a path claimed externally wins; the staged
 * bytes then stay on disk under their staging name (quarantined). */
async function restoreCreateOnly(stagedAbs: string, targetAbs: string): Promise<{ restored: boolean }> {
  try {
    await fs.link(stagedAbs, targetAbs)
    await rm(stagedAbs)
    return { restored: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { restored: false }
    throw error
  }
}

function parseReplaceJournal(raw: string): ReplaceJournal | null {
  try {
    const entry = JSON.parse(raw) as Partial<ReplaceJournal>
    if (
      entry.version === 1
      && entry.op === 'replace'
      && typeof entry.staged === 'string'
      && typeof entry.replacement === 'string'
      && typeof entry.expectedHash === 'string'
      && typeof entry.replacementHash === 'string'
      && (entry.phase === undefined || entry.phase === 'manual-recovery-required')
    ) {
      return entry as ReplaceJournal
    }
    return null
  } catch {
    return null
  }
}

function isContained(contentDir: string, candidate: string): boolean {
  const root = path.resolve(contentDir)
  const resolved = path.resolve(candidate)
  return resolved === root || resolved.startsWith(`${root}${path.sep}`)
}

function validReplaceJournalPaths(dir: string, contentDir: string, targetAbs: string, journal: ReplaceJournal): boolean {
  const targetBase = path.basename(targetAbs)
  if (path.basename(journal.staged) !== journal.staged || path.basename(journal.replacement) !== journal.replacement) return false
  if (!journal.staged.startsWith(`.${targetBase}.docus-staged-`)) return false
  const validReplacementName = journal.phase === 'manual-recovery-required'
    ? journal.replacement.startsWith(`.${targetBase}.docus-quarantine-save-`)
    : journal.replacement.startsWith(`.${targetBase}.docus-save-`)
  if (!validReplacementName) return false
  return isContained(contentDir, path.resolve(dir, journal.staged))
    && isContained(contentDir, path.resolve(dir, journal.replacement))
    && isContained(contentDir, targetAbs)
}

function validRenameRel(contentDir: string, rel: string): boolean {
  if (!isValidPathSyntax(rel)) return false
  return isContained(contentDir, path.resolve(contentDir, rel))
}

function journalBelongsToSource(
  contentDir: string,
  journalAbs: string,
  srcRel: string,
  kind: 'file' | 'folder',
): boolean {
  const sourceAbs = kind === 'file'
    ? path.join(contentDir, `${srcRel}.md`)
    : path.join(contentDir, srcRel)
  return path.dirname(journalAbs) === path.dirname(sourceAbs)
    && path.basename(journalAbs).startsWith(`.${path.basename(sourceAbs)}.docus-journal-`)
}

function parseFolderRenameJournal(raw: string): FolderRenameJournal | null {
  try {
    const entry = JSON.parse(raw) as Partial<FolderRenameJournal>
    if (
      entry.version === 1
      && entry.op === 'folder-rename'
      && typeof entry.srcRel === 'string'
      && typeof entry.destRel === 'string'
      && typeof entry.sourceDev === 'number'
      && typeof entry.sourceIno === 'number'
    ) {
      return entry as FolderRenameJournal
    }
    return null
  } catch {
    return null
  }
}

function parseFileRenameJournal(raw: string): FileRenameJournal | null {
  try {
    const entry = JSON.parse(raw) as Partial<FileRenameJournal>
    if (entry.version === 1 && entry.op === 'file-rename'
      && typeof entry.srcRel === 'string' && typeof entry.destRel === 'string'
      && (entry.staging === undefined || typeof entry.staging === 'string')
      && typeof entry.sourceHash === 'string'
      && (entry.documentId === undefined || typeof entry.documentId === 'string')) return entry as FileRenameJournal
    return null
  } catch { return null }
}

function parseDeleteReuseManifest(raw: string): DeleteReuseManifest | null {
  try {
    const entry = JSON.parse(raw) as Partial<DeleteReuseManifest>
    if (entry.version !== 1 || entry.op !== 'delete-path-reuse') return null
    if (entry.kind !== 'file' && entry.kind !== 'folder') return null
    if (typeof entry.path !== 'string' || typeof entry.inflight !== 'string' || typeof entry.quarantine !== 'string') return null
    if (!Array.isArray(entry.identities) || !entry.identities.every((item) => item && typeof item.path === 'string' && typeof item.id === 'string')) return null
    return entry as DeleteReuseManifest
  } catch { return null }
}

function vaultRelative(contentDir: string, absPath: string): string {
  return path.relative(contentDir, absPath).split(path.sep).join('/')
}

/** Document metadata paths are vault paths without the .md extension. */
function metadataPathFor(vaultRel: string): string {
  return vaultRel.replace(/\.md$/, '')
}

async function isDirectory(absPath: string): Promise<boolean> {
  try {
    return (await fs.stat(absPath)).isDirectory()
  } catch {
    return false
  }
}

async function walkDirectories(
  dir: string,
  visit: (dir: string, entries: Dirent[]) => Promise<void>,
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  await visit(dir, entries)
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === '.git' || entry.name === 'node_modules') continue
    await walkDirectories(path.join(dir, entry.name), visit)
  }
}

async function recoverReplaceJournal(
  contentDir: string,
  dir: string,
  targetAbs: string,
  journalAbs: string,
  journal: ReplaceJournal,
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  if (!validReplaceJournalPaths(dir, contentDir, targetAbs, journal)) {
    note(journalAbs, 'quarantined', 'invalid replace journal paths; no referenced path was touched')
    return
  }
  if (journal.phase === 'manual-recovery-required') {
    note(journalAbs, 'quarantined', 'manual recovery set retained; no generation was touched')
    return
  }
  const stagedAbs = path.join(dir, journal.staged)
  const saveAbs = path.join(dir, journal.replacement)
  const quarantineReplacement = async (): Promise<string> => {
    if (!await exists(saveAbs) || journal.replacement.includes('.docus-quarantine-save-')) return journal.replacement
    const quarantinedName = `.${path.basename(targetAbs)}.docus-quarantine-save-${randomUUID()}`
    const quarantinedAbs = path.join(dir, quarantinedName)
    await fs.rename(saveAbs, quarantinedAbs)
    await syncParentDirectoryBestEffort(quarantinedAbs)
    return quarantinedName
  }
  const stagedExists = await exists(stagedAbs)
  const targetExists = await exists(targetAbs)

  if (!stagedExists) {
    // The takeover never happened (crash before the rename) or an
    // earlier recovery already resolved it. The journal is stale; an
    // uncommitted save temp is removed only when its target still
    // exists — with the target gone the intent cannot be guessed, so
    // the hidden temp stays and is reported.
    if (await exists(saveAbs)) {
      if (targetExists) {
        await rm(saveAbs)
        note(saveAbs, 'cleaned', 'uncommitted save temp')
      } else {
        note(saveAbs, 'quarantined', 'save temp without a target; kept for inspection')
      }
    }
    await removeDurableJournal(journalAbs).catch(() => {})
    note(journalAbs, 'cleaned', 'stale journal (takeover never happened)')
    return
  }

  if (targetExists) {
    const targetIsReplacement = await hashMatches(targetAbs, journal.replacementHash)
    const targetIsExpected = await hashMatches(targetAbs, journal.expectedHash)
    if (targetIsReplacement) {
      await rm(stagedAbs)
      await rm(saveAbs)
      await removeDurableJournal(journalAbs).catch(() => {})
      note(targetAbs, 'cleaned', 'staging from a completed save')
    } else {
      // The formal path is the old generation or a third-party version.
      // Neither hidden generation is provably stale; retain both and the
      // journal as an explicit recovery set for manual inspection.
      note(journalAbs, 'quarantined', targetIsExpected
        ? 'old generation occupies target; replacement retained for inspection'
        : 'external generation occupies target; old and replacement generations retained')
      const replacement = await quarantineReplacement().catch(() => journal.replacement)
      await rewriteDurableJournal(journalAbs, { ...journal, replacement, phase: 'manual-recovery-required' }).catch(() => {})
    }
    return
  }

  // Interrupted after the takeover, target still empty. Complete the
  // commit when both generations still match the journaled hashes —
  // that is exactly the commit the process died inside; otherwise
  // restore the old generation.
  if (
    await hashMatches(stagedAbs, journal.expectedHash)
    && await exists(saveAbs)
    && await hashMatches(saveAbs, journal.replacementHash)
  ) {
    try {
      await fs.link(saveAbs, targetAbs)
      await rm(saveAbs)
      await rm(stagedAbs)
      await removeDurableJournal(journalAbs).catch(() => {})
      note(targetAbs, 'completed-save', 'interrupted save completed from journal')
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        note(targetAbs, 'failed', `could not complete interrupted save: ${(error as Error).message}`)
        return
      }
      // An external writer claimed the path between our check and the
      // link: fall through and restore/quarantine the old generation.
    }
  }
  const { restored } = await restoreCreateOnly(stagedAbs, targetAbs).catch((error) => {
    note(targetAbs, 'failed', `could not restore previous generation: ${(error as Error).message}`)
    return { restored: false }
  })
  if (restored) {
    note(targetAbs, 'restored', 'interrupted save rolled back to the previous generation')
  } else if (await exists(stagedAbs)) {
    note(stagedAbs, 'quarantined', 'previous generation kept; target claimed externally during recovery')
  }
  // A failed verification means neither replacement nor its intent is
  // proven stale. Keep it and the journal as a recovery set.
  if (await exists(saveAbs)) {
    const replacement = await quarantineReplacement()
    await rewriteDurableJournal(journalAbs, { ...journal, replacement, phase: 'manual-recovery-required' }).catch((error) => {
      note(journalAbs, 'failed', `could not persist manual-recovery phase: ${(error as Error).message}`)
    })
  } else {
    await removeDurableJournal(journalAbs).catch(() => {})
  }
}

async function recoverFileRenameJournal(
  contentDir: string, db: DatabaseT, journalAbs: string, journal: FileRenameJournal,
  legacyStagingNames: readonly string[],
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  if (
    journal.srcRel === journal.destRel
    || !validRenameRel(contentDir, journal.srcRel)
    || !validRenameRel(contentDir, journal.destRel)
    || !journalBelongsToSource(contentDir, journalAbs, journal.srcRel, 'file')
    || (journal.staging !== undefined && path.basename(journal.staging) !== journal.staging)
  ) {
    note(journalAbs, 'quarantined', 'invalid file-rename journal paths; no referenced path was touched')
    return
  }
  const srcAbs = path.join(contentDir, `${journal.srcRel}.md`)
  const destAbs = path.join(contentDir, `${journal.destRel}.md`)
  const stagingName = journal.staging ?? (legacyStagingNames.length === 1 ? legacyStagingNames[0] : undefined)
  const stagingAbs = stagingName ? path.join(path.dirname(srcAbs), stagingName) : null
  if (
    stagingName !== undefined
    && (!stagingName.startsWith(`.${path.basename(srcAbs)}.docus-rename-`)
      || !stagingAbs
      || !isContained(contentDir, stagingAbs))
  ) {
    note(journalAbs, 'quarantined', 'invalid file-rename staging path; no referenced path was touched')
    return
  }
  const srcExists = await exists(srcAbs)
  const destExists = await exists(destAbs)
  const stagingExists = stagingAbs ? await exists(stagingAbs) : false
  const sourceMetadata = getDocumentMetadata(db, journal.srcRel)
  const destinationMetadata = getDocumentMetadata(db, journal.destRel)
  if (journal.documentId && destinationMetadata?.id === journal.documentId) {
    if (stagingExists) {
      if (!destExists) {
        note(journalAbs, 'quarantined', 'metadata committed but destination is missing; staging retained')
        return
      }
      const [stagedStat, destStat] = await Promise.all([fs.stat(stagingAbs!), fs.stat(destAbs)])
      if (stagedStat.dev !== destStat.dev || stagedStat.ino !== destStat.ino) {
        note(journalAbs, 'quarantined', 'metadata committed but staging belongs to another generation')
        return
      }
      await rm(stagingAbs!)
    }
    await removeDurableJournal(journalAbs).catch(() => {})
    note(destAbs, 'cleaned', 'file-rename metadata already committed')
    return
  }
  if (!srcExists && destExists && await hashMatches(destAbs, journal.sourceHash)) {
    if (stagingExists) {
      const [stagedStat, destStat] = await Promise.all([fs.stat(stagingAbs!), fs.stat(destAbs)])
      if (stagedStat.dev !== destStat.dev || stagedStat.ino !== destStat.ino) {
        note(journalAbs, 'quarantined', 'rename staging does not match destination generation')
        return
      }
    }
    if (!journal.documentId || sourceMetadata?.id !== journal.documentId) {
      note(journalAbs, 'quarantined', 'file-rename source identity no longer matches journal')
      return
    }
    try {
      const moved = moveDocumentMetadataReplacingDestination(db, journal.srcRel, journal.destRel)
      if (!moved) {
        note(journalAbs, 'quarantined', 'file-rename source metadata missing; journal retained')
        return
      }
      if (stagingExists) await rm(stagingAbs!)
      await removeDurableJournal(journalAbs)
      note(destAbs, 'completed-rename', 'interrupted file rename metadata move completed from journal')
    } catch (error) {
      note(journalAbs, 'failed', `could not complete file-rename metadata move: ${(error as Error).message}`)
    }
    return
  }
  if (!srcExists && !destExists && stagingExists) {
    if (!stagingAbs || !await hashMatches(stagingAbs, journal.sourceHash)) {
      note(journalAbs, 'quarantined', 'rename staging hash does not match journal')
      return
    }
    const { restored } = await restoreCreateOnly(stagingAbs, srcAbs)
    if (!restored) {
      note(stagingAbs, 'quarantined', 'rename staging retained; source claimed during recovery')
      return
    }
    await removeDurableJournal(journalAbs)
    note(srcAbs, 'restored', 'interrupted file rename rolled back before destination link')
    return
  }
  if (srcExists && !destExists && await hashMatches(srcAbs, journal.sourceHash)) {
    await removeDurableJournal(journalAbs)
    note(journalAbs, 'cleaned', 'stale file-rename journal (move never landed)')
    return
  }
  note(journalAbs, 'quarantined', 'ambiguous file-rename state retained for inspection')
}

async function recoverFolderRenameJournal(
  contentDir: string,
  db: DatabaseT,
  journalAbs: string,
  journal: FolderRenameJournal,
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  if (
    journal.srcRel === journal.destRel
    || path.dirname(journal.srcRel) !== path.dirname(journal.destRel)
    || !validRenameRel(contentDir, journal.srcRel)
    || !validRenameRel(contentDir, journal.destRel)
    || !journalBelongsToSource(contentDir, journalAbs, journal.srcRel, 'folder')
  ) {
    note(journalAbs, 'quarantined', 'invalid folder-rename journal paths; no referenced path was touched')
    return
  }
  const srcAbs = path.join(contentDir, journal.srcRel)
  const destAbs = path.join(contentDir, journal.destRel)
  // The directory move is a single rename(2) over our own mkdir-gated
  // empty directory: after a crash the whole tree is at exactly ONE of
  // the two paths, never split.
  const srcIsDir = await isDirectory(srcAbs)
  const destIsDir = await isDirectory(destAbs)
  const matchesSourceGeneration = async (abs: string): Promise<boolean> => {
    try {
      const stat = await fs.stat(abs)
      return stat.dev === journal.sourceDev && stat.ino === journal.sourceIno
    } catch { return false }
  }

  if (srcIsDir) {
    if (!await matchesSourceGeneration(srcAbs)) {
      note(journalAbs, 'quarantined', 'folder-rename source generation does not match journal')
      return
    }
    if (!destIsDir) {
      // Crash before the move (or after an externally re-used
      // destination failed it — the route removes the journal in that
      // case, so this is the pre-move crash): state is consistent,
      // the journal is stale.
      await removeDurableJournal(journalAbs).catch(() => {})
      note(journalAbs, 'cleaned', 'stale folder-rename journal (move never started)')
      return
    }
    // Empty is not ownership proof. Without a journaled gate token we
    // never remove a destination directory, even when it is empty.
    note(journalAbs, 'quarantined', 'source remains but destination also exists; destination ownership is unproven')
    return
  }

  if (destIsDir) {
    if (!await matchesSourceGeneration(destAbs)) {
      note(journalAbs, 'quarantined', 'folder-rename destination generation does not match journal')
      return
    }
    // The move landed; finish the metadata prefix move (idempotent: it
    // is a no-op if the crash hit after the move, during journal
    // removal) and clear the journal.
    try {
      moveDocumentMetadataPrefix(db, journal.srcRel, journal.destRel)
    } catch (error) {
      note(journalAbs, 'failed', `could not complete folder-rename metadata move: ${(error as Error).message}`)
      return
    }
    await removeDurableJournal(journalAbs).catch(() => {})
    note(destAbs, 'completed-rename', 'interrupted folder rename completed from journal')
    return
  }

  // Neither path exists: cannot guess what happened; leave the journal
  // for inspection.
  note(journalAbs, 'failed', 'folder-rename journal but neither source nor destination exists')
}

async function recoverRenameStaging(
  contentDir: string,
  db: DatabaseT,
  dir: string,
  base: string,
  stagedAbs: string,
  getInodeMap: () => Promise<Map<string, string[]>>,
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  // The create-only file move (createOnlyMoveFile) takes the source
  // aside under this reserved name, links it into the destination
  // (create-only), then unlinks the staging name. A crash between the
  // link and the unlink leaves two names on one inode — find the
  // destination partner by inode and complete the rename. (Hardlinked
  // .md files in a vault are vanishingly rare; an unrelated hardlink
  // partner would be indistinguishable here — a documented limit.)
  const stat = await fs.stat(stagedAbs)
  const inodeMap = await getInodeMap()
  // Re-verify each candidate's inode: the map may be cached from an
  // earlier directory's recovery, and paths can have changed since.
  const partners: string[] = []
  for (const candidate of inodeMap.get(`${stat.dev}:${stat.ino}`) ?? []) {
    if (candidate === stagedAbs) continue
    try {
      if ((await fs.stat(candidate)).ino === stat.ino) partners.push(candidate)
    } catch { /* candidate vanished mid-recovery */ }
  }
  if (partners.length > 0) {
    const destAbs = [...partners].sort()[0]
    await rm(stagedAbs)
    // The metadata move runs AFTER the file move in both the forward
    // rename and its internal rollback, so with staging still on disk
    // the identity is still at the staging basename's path. Complete
    // the move so the identity follows the bytes (replacing-destination
    // semantics also cover the rollback-crash direction).
    const fromMeta = metadataPathFor(vaultRelative(contentDir, path.join(dir, base)))
    const toMeta = metadataPathFor(vaultRelative(contentDir, destAbs))
    if (fromMeta !== toMeta) {
      try { moveDocumentMetadataReplacingDestination(db, fromMeta, toMeta) } catch { /* best effort */ }
    }
    note(destAbs, 'completed-rename', 'interrupted rename completed (staging inode matched destination)')
    return
  }
  // No link partner: the crash hit between the takeover rename and the
  // link. Restore the source create-only — a path re-used externally
  // wins and the staging stays quarantined.
  const sourceAbs = path.join(dir, base)
  if (await exists(sourceAbs)) {
    note(stagedAbs, 'quarantined', 'rename staging; source re-used externally, kept for inspection')
    return
  }
  const { restored } = await restoreCreateOnly(stagedAbs, sourceAbs)
  if (restored) note(sourceAbs, 'restored', 'orphaned rename staging restored')
  else note(stagedAbs, 'quarantined', 'rename staging; source claimed externally during recovery')
}

async function completeInterruptedDelete(
  contentDir: string,
  db: DatabaseT,
  quarantineAbs: string,
  targetAbs: string,
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  // The deletion was initiated and validated; the staged generation is
  // the only copy left. Finishing the delete reconciles the metadata
  // (otherwise the identity row would point at a missing file). The
  // bytes survive under version control / the user's own backups —
  // resurrecting a user-requested delete on every crash would be a
  // worse surprise.
  const stat = await fs.stat(quarantineAbs)
  const metaPath = metadataPathFor(vaultRelative(contentDir, targetAbs))
  if (stat.isDirectory()) {
    await fs.rm(quarantineAbs, { recursive: true, force: true })
    deleteDocumentMetadataPrefix(db, metaPath)
    note(targetAbs, 'completed-delete', 'interrupted folder delete completed')
    return
  }
  await rm(quarantineAbs)
  deleteDocumentMetadata(db, metaPath)
  note(targetAbs, 'completed-delete', 'interrupted delete completed')
}

async function recoverDirectory(
  contentDir: string,
  db: DatabaseT,
  dir: string,
  entries: Dirent[],
  getInodeMap: () => Promise<Map<string, string[]>>,
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  const groups = new Map<string, ArtifactGroup>()
  const groupFor = (base: string): ArtifactGroup => {
    let group = groups.get(base)
    if (!group) {
      group = { base, journals: [], staged: [], save: [], remove: [], rename: [], quarantines: [], deleteManifests: [] }
      groups.set(base, group)
    }
    return group
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // A folder delete stages the whole subtree as a DIRECTORY under
      // the reserved `.docus-delete-*` name.
      const dirMatch = DELETE_RE.exec(entry.name)
      if (dirMatch) groupFor(dirMatch[1]).quarantines.push(entry.name)
      const inflightMatch = DELETE_INFLIGHT_RE.exec(entry.name)
      if (inflightMatch) groupFor(inflightMatch[1]).quarantines.push(entry.name)
      const quarantineMatch = DELETE_QUARANTINE_RE.exec(entry.name)
      if (quarantineMatch) groupFor(quarantineMatch[1]).quarantines.push(entry.name)
      continue
    }
    const name = entry.name
    let match = JOURNAL_RE.exec(name)
    if (match) { groupFor(match[1]).journals.push(name); continue }
    match = STAGED_RE.exec(name)
    if (match) { groupFor(match[1]).staged.push(name); continue }
    match = SAVE_RE.exec(name)
    if (match) { groupFor(match[1]).save.push(name); continue }
    match = REMOVE_RE.exec(name)
    if (match) { groupFor(match[1]).remove.push(name); continue }
    match = RENAME_RE.exec(name)
    if (match) { groupFor(match[1]).rename.push(name); continue }
    match = DELETE_RE.exec(name)
    if (match) { groupFor(match[1]).quarantines.push(name); continue }
    match = DELETE_INFLIGHT_RE.exec(name)
    if (match) { groupFor(match[1]).quarantines.push(name); continue }
    match = DELETE_QUARANTINE_RE.exec(name)
    if (match) { groupFor(match[1]).quarantines.push(name); continue }
    match = DELETE_MANIFEST_RE.exec(name)
    if (match) { groupFor(match[1]).deleteManifests.push(name); continue }
  }

  for (const group of groups.values()) {
    const targetAbs = path.join(dir, group.base)
    for (const manifestName of group.deleteManifests.sort()) {
      const manifestAbs = path.join(dir, manifestName)
      try {
        const manifest = parseDeleteReuseManifest(await fs.readFile(manifestAbs, 'utf8'))
        if (!manifest || !isValidPathSyntax(manifest.path)) {
          note(manifestAbs, 'quarantined', 'invalid delete path-reuse manifest')
          continue
        }
        const expectedTarget = manifest.kind === 'file'
          ? path.join(contentDir, `${manifest.path}.md`)
          : path.join(contentDir, manifest.path)
        if (expectedTarget !== targetAbs
          || path.basename(manifest.inflight) !== manifest.inflight
          || path.basename(manifest.quarantine) !== manifest.quarantine
          || !manifest.inflight.startsWith(`${group.base}.docus-delete-inflight-`)
          || !manifest.quarantine.startsWith(`${group.base}.docus-quarantine-reuse-`)) {
          note(manifestAbs, 'quarantined', 'delete path-reuse manifest is not bound to its public path')
          continue
        }
        const identitiesAreScoped = manifest.identities.every((identity) =>
          isValidPathSyntax(identity.path)
          && (manifest.kind === 'file'
            ? identity.path === manifest.path
            : identity.path === manifest.path || identity.path.startsWith(`${manifest.path}/`)))
        if (!identitiesAreScoped) {
          note(manifestAbs, 'quarantined', 'delete path-reuse manifest contains out-of-scope identities')
          continue
        }
        const inflightAbs = path.join(dir, manifest.inflight)
        const quarantineAbs = path.join(dir, manifest.quarantine)
        if (await exists(inflightAbs) && !await exists(quarantineAbs)) {
          await fs.rename(inflightAbs, quarantineAbs)
          await syncParentDirectoryBestEffort(quarantineAbs)
        }
        if (!await exists(quarantineAbs)) {
          note(manifestAbs, 'failed', 'delete path-reuse manifest has no surviving quarantine generation')
          continue
        }
        for (const identity of manifest.identities) {
          if (getDocumentMetadata(db, identity.path)?.id === identity.id) {
            deleteDocumentMetadata(db, identity.path)
          }
        }
        await removeDurableJournal(manifestAbs)
        note(quarantineAbs, 'quarantined', 'delete path-reuse identity detachment replayed')
      } catch (error) {
        note(manifestAbs, 'failed', (error as Error).message)
      }
    }
    // Journals are authoritative and go first.
    for (const journalName of group.journals.sort()) {
      const journalAbs = path.join(dir, journalName)
      try {
        const journalRaw = await fs.readFile(journalAbs, 'utf8')
        const replaceJournal = parseReplaceJournal(journalRaw)
        if (replaceJournal) {
          await recoverReplaceJournal(contentDir, dir, targetAbs, journalAbs, replaceJournal, note)
          continue
        }
        const fileJournal = parseFileRenameJournal(journalRaw)
        if (fileJournal) {
          await recoverFileRenameJournal(contentDir, db, journalAbs, fileJournal, group.rename, note)
          continue
        }
        const folderJournal = parseFolderRenameJournal(journalRaw)
        if (folderJournal) {
          await recoverFolderRenameJournal(contentDir, db, journalAbs, folderJournal, note)
          continue
        }
        note(journalAbs, 'quarantined', 'unrecognized journal left in place')
      } catch (error) {
        note(journalAbs, 'failed', (error as Error).message)
      }
    }
    // A retained journal means recovery deliberately quarantined an
    // operation as ambiguous/invalid. Its companion artifacts form one
    // recovery set and must not then be consumed by the generic orphan
    // rules below.
    if (await Promise.all(group.journals.map((name) => exists(path.join(dir, name)))).then((states) => states.some(Boolean))) {
      continue
    }
    // Whatever survived journal processing (or never had a journal) is
    // handled by the orphan rules. Existence is re-checked on disk:
    // journal recovery may already have consumed these files.
    for (const stagedName of group.staged) {
      const stagedAbs = path.join(dir, stagedName)
      if (!await exists(stagedAbs)) continue
      try {
        if (await exists(targetAbs)) {
          note(stagedAbs, 'quarantined', 'staged generation without a journal; target exists, kept for inspection')
        } else {
          const { restored } = await restoreCreateOnly(stagedAbs, targetAbs)
          if (restored) note(targetAbs, 'restored', 'orphaned staged generation restored')
          else note(stagedAbs, 'quarantined', 'orphaned staged generation; target claimed externally')
        }
      } catch (error) {
        note(stagedAbs, 'failed', (error as Error).message)
      }
    }
    for (const removeName of group.remove) {
      const removeAbs = path.join(dir, removeName)
      if (!await exists(removeAbs)) continue
      try {
        if (await exists(targetAbs)) {
          // The bytes were being removed and the path was recreated
          // externally: the staging is stale.
          await rm(removeAbs)
          note(removeAbs, 'cleaned', 'stale removal staging (target recreated)')
        } else {
          // Conservative: an interrupted conditional removal restores
          // the bytes; the removal can be retried by its owner.
          const { restored } = await restoreCreateOnly(removeAbs, targetAbs)
          if (restored) note(targetAbs, 'restored', 'interrupted removal rolled back')
          else note(removeAbs, 'quarantined', 'removal staging; target claimed externally')
        }
      } catch (error) {
        note(removeAbs, 'failed', (error as Error).message)
      }
    }
    for (const saveName of group.save) {
      const saveAbs = path.join(dir, saveName)
      if (!await exists(saveAbs)) continue
      try {
        if (await exists(targetAbs)) {
          await rm(saveAbs)
          note(saveAbs, 'cleaned', 'uncommitted save temp')
        } else {
          note(saveAbs, 'quarantined', 'save temp without a target; kept for inspection')
        }
      } catch (error) {
        note(saveAbs, 'failed', (error as Error).message)
      }
    }
    for (const quarantineName of group.quarantines) {
      const quarantineAbs = path.join(dir, quarantineName)
      if (!await exists(quarantineAbs)) continue
      try {
        if (DELETE_QUARANTINE_RE.test(quarantineName)) {
          note(quarantineAbs, 'quarantined', 'path-reuse quarantine is never auto-deleted')
          continue
        }
        const isLegacyAmbiguous = DELETE_RE.test(quarantineName)
        const targetExists = await exists(targetAbs)
        if (targetExists || isLegacyAmbiguous) {
          // A public target alongside delete staging proves path reuse.
          // Persist that disposition BEFORE touching identity rows, so a
          // crash can never leave a reusable in-flight name behind. Old
          // timestamp-only names are ambiguous after upgrade and are
          // conservatively promoted even when the target is currently
          // absent; they are never auto-deleted.
          const permanentAbs = path.join(dir, `${group.base}.docus-quarantine-reuse-${randomUUID()}`)
          const metaPath = metadataPathFor(vaultRelative(contentDir, targetAbs))
          const stagedStatBefore = await fs.stat(quarantineAbs)
          const legacyIdentities = isLegacyAmbiguous
            ? (stagedStatBefore.isDirectory()
                ? listDocumentMetadata(db).filter((item) => item.path === metaPath || item.path.startsWith(`${metaPath}/`))
                : [getDocumentMetadata(db, metaPath)].filter((item): item is NonNullable<typeof item> => item !== null))
                .map((item) => ({ path: item.path, id: item.id }))
            : []
          if (isLegacyAmbiguous) {
            const legacyManifestAbs = path.join(dir, `.${group.base}.docus-quarantine-manifest-${randomUUID()}`)
            await writeDurableJournal(legacyManifestAbs, {
              version: 1,
              op: 'legacy-delete-quarantine',
              path: metaPath,
              quarantine: path.basename(permanentAbs),
              identities: legacyIdentities,
            })
          }
          await fs.rename(quarantineAbs, permanentAbs)
          await syncParentDirectoryBestEffort(permanentAbs)
          if (isLegacyAmbiguous) {
            for (const identity of legacyIdentities) {
              if (getDocumentMetadata(db, identity.path)?.id === identity.id) deleteDocumentMetadata(db, identity.path)
            }
          } else if (targetExists) {
            if (stagedStatBefore.isDirectory()) deleteDocumentMetadataPrefix(db, metaPath)
            else deleteDocumentMetadata(db, metaPath)
          }
          note(permanentAbs, 'quarantined', targetExists
            ? 'delete staging promoted after path reuse; stale identity removed'
            : 'legacy delete staging conservatively promoted')
          continue
        }
        await completeInterruptedDelete(contentDir, db, quarantineAbs, targetAbs, note)
      } catch (error) {
        note(quarantineAbs, 'failed', (error as Error).message)
      }
    }
    for (const renameName of group.rename) {
      const renameAbs = path.join(dir, renameName)
      if (!await exists(renameAbs)) continue
      try {
        await recoverRenameStaging(contentDir, db, dir, group.base, renameAbs, getInodeMap, note)
      } catch (error) {
        note(renameAbs, 'failed', (error as Error).message)
      }
    }
  }
}

/**
 * Reconcile interrupted atomic operations found under `contentDir`.
 * Runs at startup before the HTTP server accepts requests. Never
 * throws; per-item failures are reported in the returned report and
 * left on disk for the next startup (or manual inspection). `db` is
 * used only to reconcile metadata of completed deletes.
 */
export async function recoverInterruptedOperations(
  contentDir: string,
  db: DatabaseT,
): Promise<RecoveryReport> {
  const actions: RecoveryAction[] = []
  const note = (absPath: string, action: RecoveryAction['action'], detail?: string): void => {
    actions.push(detail === undefined
      ? { file: vaultRelative(contentDir, absPath), action }
      : { file: vaultRelative(contentDir, absPath), action, detail })
  }
  // Lazy ONE-WALK inode index, built only if a journal-less rename
  // staging artifact needs its link partner (the rename destination)
  // identified. Keyed "dev:ino" → every path carrying that inode.
  let inodeMap: Map<string, string[]> | null = null
  const getInodeMap = async (): Promise<Map<string, string[]>> => {
    if (inodeMap) return inodeMap
    const map = new Map<string, string[]>()
    await walkDirectories(contentDir, async (walkDir, entries) => {
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const abs = path.join(walkDir, entry.name)
        try {
          const stat = await fs.stat(abs)
          const key = `${stat.dev}:${stat.ino}`
          const list = map.get(key)
          if (list) list.push(abs)
          else map.set(key, [abs])
        } catch { /* vanished mid-walk */ }
      }
    })
    inodeMap = map
    return map
  }
  try {
    await walkDirectories(contentDir, async (dir, entries) => {
      await recoverDirectory(contentDir, db, dir, entries, getInodeMap, note)
    })
  } catch (error) {
    note(contentDir, 'failed', (error as Error).message)
  }
  return { actions }
}
