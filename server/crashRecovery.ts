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
// `.docus-delete-*` names with the same exposure.
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
//   * `.docus-delete-*` quarantine with the target still empty:
//     COMPLETE the interrupted delete (the deletion was initiated and
//     validated; leaving the metadata row would bind an identity to a
//     missing file); target re-occupied: leave the quarantine as the
//     path-reuse branch intended;
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
import type { Dirent } from 'node:fs'
import type { Database as DatabaseT } from 'better-sqlite3'
import { sha256Hex } from './atomicTextWrite.js'
import {
  deleteDocumentMetadata,
  deleteDocumentMetadataPrefix,
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
}

interface FolderRenameJournal {
  version: 1
  op: 'folder-rename'
  /** Vault-relative folder paths (no leading/trailing slash). */
  srcRel: string
  destRel: string
}

// Reserved artifact name patterns (see file header for why they are
// unambiguous). The capture is the target's basename.
const JOURNAL_RE = /^\.(.+)\.docus-journal-[0-9a-f-]+$/
const STAGED_RE = /^\.(.+)\.docus-staged-[0-9a-f-]+$/
const SAVE_RE = /^\.(.+)\.docus-save-[0-9a-f-]+$/
const REMOVE_RE = /^\.(.+)\.docus-remove-[0-9a-f-]+$/
const RENAME_RE = /^\.(.+)\.docus-rename-[0-9a-f-]+$/
const DELETE_RE = /^(.+)\.docus-delete-\d+$/

interface ArtifactGroup {
  base: string
  journals: string[]
  staged: string[]
  save: string[]
  remove: string[]
  rename: string[]
  quarantines: string[]
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
    ) {
      return entry as ReplaceJournal
    }
    return null
  } catch {
    return null
  }
}

function parseFolderRenameJournal(raw: string): FolderRenameJournal | null {
  try {
    const entry = JSON.parse(raw) as Partial<FolderRenameJournal>
    if (
      entry.version === 1
      && entry.op === 'folder-rename'
      && typeof entry.srcRel === 'string'
      && typeof entry.destRel === 'string'
    ) {
      return entry as FolderRenameJournal
    }
    return null
  } catch {
    return null
  }
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

/** true only for a readable EMPTY directory; anything else (external
 * content, unreadable, missing, a file) is conservatively "not ours". */
async function isEmptyDirectory(absPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(absPath)
    return entries.length === 0
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
  dir: string,
  targetAbs: string,
  journalAbs: string,
  journal: ReplaceJournal,
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  const stagedAbs = path.join(dir, journal.staged)
  const saveAbs = path.join(dir, journal.replacement)
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
    await rm(journalAbs)
    note(journalAbs, 'cleaned', 'stale journal (takeover never happened)')
    return
  }

  if (targetExists) {
    // The commit landed (crash during cleanup) or an external writer
    // claimed the path while we held the old generation. staged == the
    // caller's verified base, which the caller held in memory, so
    // cleaning both temps loses nothing uniquely ours.
    await rm(stagedAbs)
    await rm(saveAbs)
    await rm(journalAbs)
    note(targetAbs, 'cleaned', 'staging from a completed or externally superseded save')
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
      await rm(journalAbs)
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
  await rm(saveAbs)
  await rm(journalAbs)
}

async function recoverFolderRenameJournal(
  contentDir: string,
  db: DatabaseT,
  journalAbs: string,
  journal: FolderRenameJournal,
  note: (absPath: string, action: RecoveryAction['action'], detail?: string) => void,
): Promise<void> {
  const srcAbs = path.join(contentDir, journal.srcRel)
  const destAbs = path.join(contentDir, journal.destRel)
  // The directory move is a single rename(2) over our own mkdir-gated
  // empty directory: after a crash the whole tree is at exactly ONE of
  // the two paths, never split.
  const srcIsDir = await isDirectory(srcAbs)
  const destIsDir = await isDirectory(destAbs)

  if (srcIsDir) {
    if (!destIsDir) {
      // Crash before the move (or after an externally re-used
      // destination failed it — the route removes the journal in that
      // case, so this is the pre-move crash): state is consistent,
      // the journal is stale.
      await rm(journalAbs)
      note(journalAbs, 'cleaned', 'stale folder-rename journal (move never started)')
      return
    }
    // Both directories exist: the move never landed (rename would have
    // emptied src). dest is either OUR empty gate directory (crash
    // between mkdir and rename — proven ours by being empty) or
    // external content. Remove it only in the proven-ours case.
    if (await isEmptyDirectory(destAbs)) {
      await fs.rmdir(destAbs).catch(() => {})
      await rm(journalAbs)
      note(destAbs, 'cleaned', 'empty gate directory from an interrupted folder rename')
      return
    }
    await rm(journalAbs)
    note(journalAbs, 'cleaned', 'folder-rename destination claimed externally; rename never landed')
    return
  }

  if (destIsDir) {
    // The move landed; finish the metadata prefix move (idempotent: it
    // is a no-op if the crash hit after the move, during journal
    // removal) and clear the journal.
    try {
      moveDocumentMetadataPrefix(db, journal.srcRel, journal.destRel)
    } catch (error) {
      note(journalAbs, 'failed', `could not complete folder-rename metadata move: ${(error as Error).message}`)
      return
    }
    await rm(journalAbs)
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
      group = { base, journals: [], staged: [], save: [], remove: [], rename: [], quarantines: [] }
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
  }

  for (const group of groups.values()) {
    const targetAbs = path.join(dir, group.base)
    // Journals are authoritative and go first.
    for (const journalName of group.journals.sort()) {
      const journalAbs = path.join(dir, journalName)
      try {
        const journalRaw = await fs.readFile(journalAbs, 'utf8')
        const replaceJournal = parseReplaceJournal(journalRaw)
        if (replaceJournal) {
          await recoverReplaceJournal(dir, targetAbs, journalAbs, replaceJournal, note)
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
        if (await exists(targetAbs)) {
          note(quarantineAbs, 'quarantined', 'delete staging outlived a path reuse; kept for inspection')
        } else {
          await completeInterruptedDelete(contentDir, db, quarantineAbs, targetAbs, note)
        }
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
