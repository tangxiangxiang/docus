import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Database as DatabaseT } from 'better-sqlite3'
import { getDocumentMetadata, moveDocumentMetadataReplacingDestination } from './documentMetadata.js'
import {
  renameWithTransientWindowsRetry,
  restoreStagedGeneration,
  syncParentDirectoryBestEffort,
  sha256Hex,
  sha256HexBuffer,
  removeDurableJournal,
  writeDurableJournal,
} from './atomicTextWrite.js'
import type { FolderMoveJournalEntry } from './folderMoveTransaction.js'

/** Test-only hooks for the create-only move race/crash windows. Null
 * in production; tests reset in finally. `afterMkdirGate` fires right
 * after the destination gate directory is created (the window in which
 * external content can land inside it); `afterRenameLinked` fires after
 * the destination link lands but before the staging name is removed
 * (the window a kill -9 leaves two names on one inode). The replayable
 * directory-move hooks mirror those seams for the per-file protocol. */
export type CreateOnlyMoveHooks = {
  afterMkdirGate?: (toDirAbs: string) => void | Promise<void>
  afterRenameTakenOver?: (stagingPath: string) => void | Promise<void>
  afterRenameLinked?: () => void | Promise<void>
  /** Fires after the staging name is gone but before metadata moves. */
  afterFileMoveFinalized?: () => void | Promise<void>
  /** Fires right after the replayable directory move's mkdir gate is
   * created, before any entry has moved. */
  afterReplayableGate?: (toDirAbs: string) => void | Promise<void>
  /** Fires after each per-file move of a replayable directory move
   * lands at the destination — the crash window that leaves the tree
   * split between source and destination. */
  afterReplayableMovedEntry?: (entryRel: string) => void | Promise<void>
  /** Fires right after the shared exact final parity passes (all files
   * and directories match the journal) but BEFORE the gate token is
   * removed and metadata is committed — the crash window for F3. */
  afterReplayableFinalParity?: (toDirAbs: string) => void | Promise<void>
}
let __createOnlyMoveHooks: CreateOnlyMoveHooks | null = null
export function __setCreateOnlyMoveHooksForTesting(hooks: CreateOnlyMoveHooks | null): void {
  __createOnlyMoveHooks = hooks
}

/** Internal: notify the per-entry crash seam. Both the mover AND the
 * recovery replay loop call it, so a crash child can pause at the same
 * seam whether the move runs in the route or at startup recovery
 * (the "kill recovery mid-replay" point). No-op in production. */
export async function fireReplayableMovedEntryHook(entryRel: string): Promise<void> {
  if (__createOnlyMoveHooks?.afterReplayableMovedEntry) await __createOnlyMoveHooks.afterReplayableMovedEntry(entryRel)
}

/** The move destination was claimed by an external writer. The source
 * was restored (or quarantined if it too was re-used); nothing was
 * overwritten. Callers map this to a retryable conflict. */
export class RenameDestinationOccupiedError extends Error {
  constructor(destinationPath: string) {
    super(`rename destination already exists: ${destinationPath}`)
    this.name = 'RenameDestinationOccupiedError'
  }
}

/** A rolled-back rename could not return to its original path because
 * an external writer re-used it. The bytes were NOT overwritten — they
 * stayed at the rename destination (or, pathologically, quarantined
 * under a staging name). Callers must keep the identity with the bytes
 * instead of restoring it onto the external file. */
export class RenameSourceReusedError extends Error {
  readonly stagingPath?: string
  readonly survivingPath: 'staging' | 'destination'
  readonly sourceReused = true
  readonly destinationOccupied: boolean
  readonly journalPath?: string
  constructor(sourcePath: string, disposition: {
    stagingPath?: string
    survivingPath?: 'staging' | 'destination'
    destinationOccupied?: boolean
    journalPath?: string
  } = {}) {
    super(`rename rollback: source path re-used externally: ${sourcePath}`)
    this.name = 'RenameSourceReusedError'
    this.stagingPath = disposition.stagingPath
    this.survivingPath = disposition.survivingPath ?? 'destination'
    this.destinationOccupied = disposition.destinationOccupied ?? false
    this.journalPath = disposition.journalPath
  }
}

/** The filesystem cannot perform create-only moves (link(2) is
 * rejected with EPERM/EOPNOTSUPP/ENOTSUP — e.g. a link-incapable
 * filesystem). Every touched path was restored; nothing was moved.
 * Callers map this to a clear 501: a check-then-rename fallback would
 * reintroduce the exact external-overwrite race the create-only
 * protocol exists to prevent. */
export class UnsupportedDirectoryMoveError extends Error {
  readonly unsupportedMove = true
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`unsupported create-only directory move: ${detail}`)
    this.name = 'UnsupportedDirectoryMoveError'
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
  }
}

const LINK_INCAPABLE_CODES = new Set(['EPERM', 'EOPNOTSUPP', 'ENOTSUP'])

/**
 * Move a file WITHOUT ever replacing a generation we do not own:
 *
 *   1. take the source aside to a private staging path (ownership of
 *      the source bytes is now ours alone);
 *   2. link(2) the staging into the destination — create-only: if an
 *      external writer claimed the destination, EEXIST fails the move
 *      closed and the source is restored (itself create-only, so a
 *      re-used source quarantines the bytes instead of clobbering);
 *   3. unlink the staging name; the inode now has exactly one name.
 *
 * POSIX rename(2) atomically REPLACES an existing target, so a plain
 * "does the destination exist?" check at the route layer can never
 * protect external editors (Obsidian/vim/sync software ignore our
 * in-process locks). link(2) is its create-only counterpart. Both
 * paths are inside the vault, i.e. on one filesystem. A link-incapable
 * filesystem (EPERM/EOPNOTSUPP/ENOTSUP) fails closed after restoring
 * the source: a check-then-rename fallback would reintroduce the exact
 * external-overwrite race this primitive exists to prevent.
 */
export async function createOnlyMoveFile(fromAbs: string, toAbs: string, preparedStagingPath?: string): Promise<void> {
  const stagedPath = preparedStagingPath ?? path.join(
    path.dirname(fromAbs),
    `.${path.basename(fromAbs)}.docus-rename-${randomUUID()}`,
  )
  await renameWithTransientWindowsRetry(fromAbs, stagedPath)
  if (__createOnlyMoveHooks?.afterRenameTakenOver) await __createOnlyMoveHooks.afterRenameTakenOver(stagedPath)
  try {
    await fs.link(stagedPath, toAbs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EOPNOTSUPP' || code === 'ENOTSUP') {
      const { quarantined } = await restoreStagedGeneration(stagedPath, fromAbs)
      if (quarantined) {
        throw new RenameSourceReusedError(fromAbs, {
          stagingPath: stagedPath,
          survivingPath: 'staging',
          destinationOccupied: await fs.stat(toAbs).then(() => true, () => false),
        })
      }
      if (await fs.stat(toAbs).then(() => true, () => false)) throw new RenameDestinationOccupiedError(toAbs)
      throw error
    }
    if (code === 'EEXIST') {
      // An external writer won the destination: restore the source
      // create-only and fail closed. If the source was re-used too,
      // the bytes stay quarantined rather than overwriting either
      // external file.
      const { quarantined } = await restoreStagedGeneration(stagedPath, fromAbs)
      throw quarantined ? new RenameSourceReusedError(fromAbs, { stagingPath: stagedPath, survivingPath: 'staging', destinationOccupied: true }) : new RenameDestinationOccupiedError(toAbs)
    }
    const { quarantined } = await restoreStagedGeneration(stagedPath, fromAbs)
    if (quarantined) {
      throw new RenameSourceReusedError(fromAbs, {
        stagingPath: stagedPath,
        survivingPath: 'staging',
        destinationOccupied: false,
      })
    }
    throw error
  }
  if (__createOnlyMoveHooks?.afterRenameLinked) await __createOnlyMoveHooks.afterRenameLinked()
  await fs.rm(stagedPath, { force: true })
  await syncParentDirectoryBestEffort(toAbs)
}

/** How a directory move is executed. POSIX gets the single-syscall
 * atomic rename; Windows cannot replace a directory with rename(2) —
 * even an empty one — and gets the journaled per-file replay instead. */
export type DirectoryMoveStrategy = 'atomic-rename' | 'replayable-move'

/** The strategy value PERSISTED in the folder-move journal. It is the
 * runtime strategy itself: routes, the recovery parser, and the crash
 * fixtures all import this ONE type, so the persisted value can never
 * drift away from what the mover and the parser understand. (Round-7
 * P0: the route persisted 'replayable-move'/'atomic-rename' while the
 * parser only accepted 'replayable'/'atomic' — every real journal was
 * unparseable and its recovery could never run.) */
export type FolderMoveJournalStrategy = DirectoryMoveStrategy
export const FOLDER_MOVE_STRATEGIES: readonly FolderMoveJournalStrategy[] = ['atomic-rename', 'replayable-move']

export const platformDirectoryMoveStrategy: DirectoryMoveStrategy = process.platform === 'win32' ? 'replayable-move' : 'atomic-rename'

let __directoryMoveStrategyOverride: DirectoryMoveStrategy | null = null
/** Test-only seam: force the Windows replayable protocol on POSIX so
 * crash children can exercise the journaled per-file path the real
 * HTTP route persists — through the route itself, not a copy. Null in
 * production. */
export function __setDirectoryMoveStrategyOverrideForTesting(strategy: DirectoryMoveStrategy | null): void {
  __directoryMoveStrategyOverride = strategy
}
export function resolveDirectoryMoveStrategy(): DirectoryMoveStrategy {
  return __directoryMoveStrategyOverride ?? platformDirectoryMoveStrategy
}

async function listRegularFileEntries(fromDirAbs: string): Promise<string[]> {
  const entries: string[] = []
  const walk = async (dirAbs: string, rel: string): Promise<void> => {
    const dirents = await fs.readdir(dirAbs, { withFileTypes: true })
    for (const entry of dirents) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) await walk(path.join(dirAbs, entry.name), entryRel)
      else if (entry.isFile()) entries.push(entryRel)
      // A symlink/junction or special entry cannot be moved create-only
      // (link(2) would FOLLOW it outside the tree): fail closed. The
      // caller restores every already-moved entry before reporting.
      else throw new UnsupportedDirectoryMoveError(`unsupported entry inside the moved folder: ${entryRel}`)
    }
  }
  await walk(fromDirAbs, '')
  entries.sort()
  return entries
}

/** Remove empty directories bottom-up; anything non-empty stays. A
 * failed rmdir simply leaves the directory — it is external property. */
export async function pruneEmptyDirectories(dirAbs: string): Promise<void> {
  let dirents
  try {
    dirents = await fs.readdir(dirAbs, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of dirents) {
    if (entry.isDirectory()) await pruneEmptyDirectories(path.join(dirAbs, entry.name))
  }
  await fs.rmdir(dirAbs).catch(() => {})
}

/** Relative subdirectory paths under dirAbs (excluding the root
 * itself), for destination directory-set parity. Symlinked directories
 * are rejected like the file walk rejects symlinked files. */
async function listDirectoryEntries(fromDirAbs: string): Promise<string[]> {
  const directories: string[] = []
  const walk = async (dirAbs: string, rel: string): Promise<void> => {
    const dirents = await fs.readdir(dirAbs, { withFileTypes: true })
    for (const entry of dirents) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        directories.push(entryRel)
        await walk(path.join(dirAbs, entry.name), entryRel)
      } else if (!entry.isFile()) {
        throw new UnsupportedDirectoryMoveError(`unsupported entry inside the moved folder: ${entryRel}`)
      }
    }
  }
  await walk(fromDirAbs, '')
  directories.sort()
  return directories
}

/**
 * Physical vault containment (round-6 F4, extended round-8 to every
 * per-entry path). A resolved string can stay inside the vault while
 * the FILESYSTEM path escapes it: with `vault/proj/sub → /outside`,
 * `vault/proj/sub/victim.bin` resolves to a string under the vault but
 * accesses a file outside it. Every journal-driven filesystem touch
 * (hash read, mkdir, rename, link — which also creates its private
 * staging in the source's parent) must first prove no ancestor below
 * the vault root is a symlink (Windows junction / reparse point reports
 * as a symlink under lstat). The leaf itself is checked too, because a
 * create-only link would FOLLOW a symlinked leaf into an external
 * inode. A missing leaf is contained.
 */
export async function isPhysicallyContained(vaultRoot: string, candidateAbs: string): Promise<boolean> {
  const root = path.resolve(vaultRoot)
  const resolved = path.resolve(candidateAbs)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return false
  let current = path.dirname(resolved)
  while (current.length > root.length) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) return false
    } catch {
      // A missing ancestor cannot be a symlink we'd escape through —
      // the mover/recovery creates it with mkdir -p as a real
      // directory. Keep walking up to check the ancestors that DO
      // exist (a symlinked grandparent is still caught).
    }
    current = path.dirname(current)
  }
  try {
    if ((await fs.lstat(resolved)).isSymbolicLink()) return false
  } catch {
    /* an absent leaf is contained */
  }
  return true
}

/** Hidden marker the replayable mover drops inside the destination
 * gate it created. Recovery treats a destination directory as "provably
 * ours" only when it finds this exact token — an empty directory alone
 * is NOT ownership proof (round-8 P1/P3). */
export const GATE_TOKEN_PREFIX = '.docus-folder-gate-'
export function gateTokenName(gateToken: string): string {
  return `${GATE_TOKEN_PREFIX}${gateToken}`
}


/**
 * The REPLAYABLE directory move: the Windows-compatible create-only
 * protocol. rename(2) cannot replace a directory on Windows (even an
 * empty one), so the tree is moved one file at a time instead:
 *
 *   1. mkdir(destination) — the same create-only gate as the atomic
 *      protocol; EEXIST means an external writer claimed it;
 *   2. EXACTLY the journaled entries move create-only (staging +
 *      link(2)) under their relative paths, parents created on demand;
 *   3. the destination is parity-checked against the entry list;
 *   4. the emptied source directories are pruned bottom-up.
 *
 * The move is replayable, not atomic: a crash between per-file moves
 * leaves the tree SPLIT between source and destination. The caller
 * writes a durable folder-move journal whose `entries` ARE the list
 * passed here BEFORE calling (see server/folderMoveTransaction.ts and
 * server/routes/folders.ts); startup crash recovery replays the
 * remaining entries from the same list — the journal is the proof that
 * decides the split. Moving ONLY the journaled set is what makes the
 * journal authoritative: a file added to the source by an external
 * writer after the journal was written simply stays at the source
 * (never lost, never split), and the destination parity check fails
 * closed if anything external lands inside the gate mid-move.
 *
 * Any external writer winning a destination path fails the WHOLE move
 * closed: every already-moved entry is rolled back create-only (a
 * re-used source path keeps its bytes at the destination instead of
 * clobbering the external file) and the gate tree is pruned.
 */
export type FolderMoveExecuteOptions = {
  /** Every subdirectory the journal declared (including empty ones);
   * created at the destination and verified by the end parity. */
  directories?: string[]
  /** Transaction token; when present the mover drops a hidden gate
   * marker inside the destination gate it creates, so recovery can tell
   * its own gate from an externally-created empty directory. */
  gateToken?: string
  /** The unpredictable gate-token secret (v3) persisted in the journal.
   * Written into the gate marker file so recovery can verify the exact
   * bytes, not just the filename (round-9 F2). */
  gateTokenValue?: string
  /** Vault root; when present every per-entry source AND destination
   * path is physically containment-checked (no symlinked ancestor)
   * before it is hashed/mkdir/renamed/linked (round-8 P0/P1). Also
   * passed through to rollback so compensation moves are contained
   * (round-9 F5). */
  vaultRoot?: string
  /** The full journal entries (with sourceHash and sourceDev/sourceIno)
   * for exact final parity verification — file set equality, per-file
   * content hash, and landed generation identity (round-9 F3). */
  entries?: readonly FolderMoveJournalEntry[]
}

export async function executeReplayableFolderMove(
  fromDirAbs: string,
  toDirAbs: string,
  entryRels: string[],
  options: FolderMoveExecuteOptions = {},
): Promise<{ restored: boolean }> {
  const directories = options.directories ?? []
  const vaultRoot = options.vaultRoot
  try {
    await fs.mkdir(toDirAbs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'ENOTDIR') return { restored: false }
    throw error
  }
  // Prove the gate is ours for recovery: drop the hidden marker before
  // anything else lands inside it. v3 (round-9 F2): the marker carries
  // the unpredictable gateTokenValue (persisted in the journal) so
  // recovery can verify the exact bytes, not just the filename.
  if (options.gateToken) {
    const tokenPath = path.join(toDirAbs, gateTokenName(options.gateToken))
    if (vaultRoot && !await isPhysicallyContained(vaultRoot, tokenPath)) {
      await fs.rmdir(toDirAbs).catch(() => {})
      throw new UnsupportedDirectoryMoveError(`gate token path escapes the vault: ${gateTokenName(options.gateToken)}`)
    }
    // O_CREAT | O_EXCL | O_WRONLY — create-only; EEXIST means an
    // external writer planted the exact token name first.
    try {
      const fh = await fs.open(tokenPath, 'wx')
      try {
        await fh.writeFile(options.gateTokenValue ?? '', 'utf8')
        await fh.sync()
      } finally {
        await fh.close()
      }
      await syncParentDirectoryBestEffort(tokenPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        await fs.rmdir(toDirAbs).catch(() => {})
        return { restored: false }
      }
      throw error
    }
  }
  if (__createOnlyMoveHooks?.afterReplayableGate) await __createOnlyMoveHooks.afterReplayableGate(toDirAbs)
  const removeGateToken = async (): Promise<void> => {
    if (options.gateToken) await fs.rm(path.join(toDirAbs, gateTokenName(options.gateToken)), { force: true })
  }
  const moved: string[] = []
  // Roll back every landed entry create-only with per-entry containment
  // (round-9 F5): each reverse source AND destination must be
  // physically contained immediately before the syscall — a symlink
  // planted after the forward move must not route compensation outside
  // the vault.
  const rollbackMoved = async (): Promise<boolean> => {
    let rollbackFailed = false
    for (const entryRel of [...moved].reverse()) {
      const fromEntry = path.join(toDirAbs, entryRel)
      const toEntry = path.join(fromDirAbs, entryRel)
      if (vaultRoot) {
        if (!await isPhysicallyContained(vaultRoot, fromEntry) || !await isPhysicallyContained(vaultRoot, toEntry)) {
          throw new UnsupportedDirectoryMoveError(
            `rollback containment failed for ${entryRel}: an external symlink or junction would escape the vault`,
          )
        }
      }
      try {
        await createOnlyMoveFile(fromEntry, toEntry)
      } catch {
        rollbackFailed = true
      }
    }
    await removeGateToken()
    await pruneEmptyDirectories(toDirAbs)
    return rollbackFailed
  }
  try {
    // Recreate the journaled directory structure first.
    for (const dirRel of directories) {
      const dirAbs = path.join(toDirAbs, dirRel)
      if (vaultRoot && !await isPhysicallyContained(vaultRoot, dirAbs)) {
        throw new UnsupportedDirectoryMoveError(`directory path escapes the vault: ${dirRel}`)
      }
      await fs.mkdir(dirAbs, { recursive: true })
    }
    for (const entryRel of entryRels) {
      const entryFromAbs = path.join(fromDirAbs, entryRel)
      const entryToAbs = path.join(toDirAbs, entryRel)
      if (vaultRoot
        && (!await isPhysicallyContained(vaultRoot, entryFromAbs)
          || !await isPhysicallyContained(vaultRoot, entryToAbs))) {
        throw new UnsupportedDirectoryMoveError(`entry path escapes the vault: ${entryRel}`)
      }
      await fs.mkdir(path.dirname(entryToAbs), { recursive: true })
      await createOnlyMoveFile(entryFromAbs, entryToAbs)
      moved.push(entryRel)
      await fireReplayableMovedEntryHook(entryRel)
    }
  } catch (error) {
    const rollbackFailed = await rollbackMoved()
    const code = (error as NodeJS.ErrnoException).code
    if (code && LINK_INCAPABLE_CODES.has(code)) {
      throw new UnsupportedDirectoryMoveError(
        `filesystem rejected a create-only file link (${code})${rollbackFailed ? '; rollback is incomplete — inspect the destination residue' : ''}`,
        { cause: error },
      )
    }
    if (error instanceof UnsupportedDirectoryMoveError) throw error
    if (!rollbackFailed && (error instanceof RenameDestinationOccupiedError || code === 'EEXIST' || code === 'ENOTDIR')) {
      return { restored: false }
    }
    throw error
  }
  // Exact final parity (round-9 F3): shared by mover AND recovery.
  // Must verify file-set equality, per-file content hash, directory-set
  // equality, and exact gate-token content. Any mismatch fails closed:
  // do NOT move metadata, do NOT remove the journal, do NOT roll
  // unverified destination bytes back to source.
  const parityFailed = await verifyExactParity(toDirAbs, options)
  if (parityFailed) {
    const rollbackFailed = await rollbackMoved()
    if (rollbackFailed) {
      throw new Error('exact parity failed and the rollback was incomplete')
    }
    return { restored: false }
  }
  // Clean up the empty source tree before the crash seam so a killed
  // process leaves the vault without the stale source directory. The
  // gate marker stays until after the seam — recovery needs it to
  // prove destination ownership. External content that landed in the
  // source during the move is untouched (directories stay non-empty).
  await pruneEmptyDirectories(fromDirAbs)
  // Crash seam: after parity passes but before metadata commit (F3).
  if (__createOnlyMoveHooks?.afterReplayableFinalParity) await __createOnlyMoveHooks.afterReplayableFinalParity(toDirAbs)
  await removeGateToken()
  await syncParentDirectoryBestEffort(toDirAbs)
  return { restored: true }
}

/** Shared exact final parity (round-9 F3) — used by the mover AND by
 * recovery replay. Verifies file-set equality (no missing, no extra),
 * per-file content hash, directory-set equality, exact gate-token file
 * presence + content, and no symlink/special/undeclared entries.
 * Returns true when parity fails (destination is not provably ours). */
export async function verifyExactParity(
  toDirAbs: string,
  options: FolderMoveExecuteOptions,
): Promise<boolean> {
  const expectedFiles = new Set(options.entries?.map((e) => e.relativeFilePath) ?? [])
  const expectedDirs = new Set(options.directories ?? [])
  const tokenName = options.gateToken ? gateTokenName(options.gateToken) : null
  const tokenContent = options.gateTokenValue ?? null
  const entryByRel = new Map((options.entries ?? []).map((e) => [e.relativeFilePath, e]))
  let landedFileCount = 0
  const landedDirs: string[] = []
  try {
    // Destination must be a real directory (not symlink/junction).
    const destStat = await fs.lstat(toDirAbs)
    if (destStat.isSymbolicLink()) return true
    if (!destStat.isDirectory()) return true

    const walk = async (dir: string, rel: string): Promise<boolean> => {
      const dirents = await fs.readdir(dir, { withFileTypes: true })
      for (const dirent of dirents) {
        const relPath = rel === '' ? dirent.name : `${rel}/${dirent.name}`
        const absPath = path.join(dir, dirent.name)
        if (dirent.isSymbolicLink()) return true // fail: unexpected symlink
        if (dirent.isDirectory()) {
          if (!expectedDirs.has(relPath)) return true // fail: undeclared dir
          landedDirs.push(relPath)
          if (await walk(absPath, relPath)) return true
        } else if (dirent.isFile()) {
          // Exact gate token: verify content, then skip from file set.
          if (tokenName && dirent.name === tokenName && rel === '') {
            if (tokenContent !== null) {
              try {
                if (await fs.readFile(absPath, 'utf8') !== tokenContent) return true
              } catch { return true }
            }
            continue
          }
          const entry = entryByRel.get(relPath)
          if (!entry) return true // fail: undeclared file
          if (!await fileHashMatchesBuffer(absPath, entry.sourceHash)) return true // fail: content mismatch
          // v3 generation proof (F4): a byte-identical external
          // replacement gets a fresh inode — the hard-linked landing
          // preserves the source identity. If the journal carried
          // sourceDev/sourceIno, the landing must still match.
          if (entry.sourceDev && entry.sourceIno) {
            try {
              const landingStat = await fs.stat(absPath, { bigint: true })
              if (landingStat.dev.toString() !== entry.sourceDev
                || landingStat.ino.toString() !== entry.sourceIno) return true
            } catch { return true }
          }
          landedFileCount++
        } else {
          return true // fail: special/socket/device/fifo
        }
      }
      return false
    }
    if (await walk(toDirAbs, '')) return true
  } catch {
    return true
  }
  // File set must be exactly equal (no missing, no extra).
  if (landedFileCount !== expectedFiles.size) return true
  // Directory set must be exactly equal.
  if (landedDirs.length !== expectedDirs.size) return true
  for (const dir of landedDirs) {
    if (!expectedDirs.has(dir)) return true
  }
  return false // parity passed
}

/** Binary-safe content hash verification — shared by inventory and
 * exact parity so buffer hashing is consistent everywhere. */
async function fileHashMatchesBuffer(absPath: string, expectedHash: string): Promise<boolean> {
  try {
    return sha256HexBuffer(await fs.readFile(absPath)) === expectedHash
  } catch {
    return false
  }
}

/** Execute the moved file set of a folder-move journal. The replayable
 * strategy moves EXACTLY `entryRels` (the journal is the authority);
 * the atomic strategy is a single rename(2) over the mkdir gate — the
 * whole directory crosses at once, so the entry list needs no replay. */
export async function executeFolderMove(
  strategy: DirectoryMoveStrategy,
  fromDirAbs: string,
  toDirAbs: string,
  entryRels: string[],
  options: FolderMoveExecuteOptions = {},
): Promise<{ restored: boolean }> {
  if (strategy === 'replayable-move') return executeReplayableFolderMove(fromDirAbs, toDirAbs, entryRels, options)
  return createOnlyMoveDirectory(fromDirAbs, toDirAbs, 'atomic-rename')
}

/**
 * Move a directory WITHOUT ever replacing external content. mkdir is
 * the create-only gate: EEXIST means an external writer claimed the
 * destination after any earlier check.
 *
 * `atomic-rename` (POSIX default): rename(2) then atomically replaces
 * OUR OWN empty gate directory — a single syscall, so a crash leaves
 * the whole tree at exactly one of the two paths, never split. If
 * external content lands inside the gate directory between mkdir and
 * rename, the rename fails (ENOTEMPTY) and the directory is no longer
 * ours: `restored: false` reports the reuse with the source tree left
 * intact.
 *
 * `replayable-move` (Windows default — rename(2) cannot replace a
 * directory there): the per-file journaled protocol, see
 * createOnlyMoveDirectoryReplayable. Tests can force either strategy
 * on any platform.
 */
export async function createOnlyMoveDirectory(
  fromDirAbs: string,
  toDirAbs: string,
  strategy: DirectoryMoveStrategy = platformDirectoryMoveStrategy,
): Promise<{ restored: boolean }> {
  if (strategy === 'replayable-move') {
    // Journal-less callers enumerate fresh; unsupported entries
    // (symlink/junction/special) fail closed BEFORE the gate is
    // created, so nothing needs rolling back.
    const entryRels = await listRegularFileEntries(fromDirAbs)
    const directories = await listDirectoryEntries(fromDirAbs)
    // Compute source hashes and dev/ino for exact final parity (F3/F4).
    // Journal-less callers (tests, external moves) still verify every
    // landed byte before committing.
    const entries: FolderMoveJournalEntry[] = await Promise.all(
      entryRels.map(async (rel) => {
        const absPath = path.join(fromDirAbs, rel)
        const buf = await fs.readFile(absPath)
        const stat = await fs.stat(absPath, { bigint: true })
        return {
          relativeFilePath: rel,
          sourceHash: sha256HexBuffer(buf),
          sourceDev: stat.dev.toString(),
          sourceIno: stat.ino.toString(),
        }
      }),
    )
    return executeReplayableFolderMove(fromDirAbs, toDirAbs, entryRels, { directories, entries })
  }
  try {
    await fs.mkdir(toDirAbs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'ENOTDIR') return { restored: false }
    throw error
  }
  if (__createOnlyMoveHooks?.afterMkdirGate) await __createOnlyMoveHooks.afterMkdirGate(toDirAbs)
  try {
    await renameWithTransientWindowsRetry(fromDirAbs, toDirAbs)
    await syncParentDirectoryBestEffort(toDirAbs)
    return { restored: true }
  } catch (error) {
    try {
      // Only removable while still OUR empty gate directory.
      await fs.rmdir(toDirAbs)
    } catch {
      // External content inside: the destination is re-used.
      return { restored: false }
    }
    const code = (error as NodeJS.ErrnoException).code
    // A directory rename this platform cannot perform (Windows: EPERM
    // on any existing directory; a link-incapable filesystem: the same
    // codes createOnlyMoveFile reports). Never fall back to a
    // check-then-rename — that is the overwrite race this primitive
    // exists to prevent. The caller can retry with 'replayable-move'.
    if (code && LINK_INCAPABLE_CODES.has(code)) {
      throw new UnsupportedDirectoryMoveError(`directory rename failed (${code}); the platform needs the replayable strategy`, { cause: error })
    }
    throw error
  }
}

export async function renameDocumentWithMetadata(input: {
  db: DatabaseT
  fromPath: string
  toPath: string
  fromAbs: string
  toAbs: string
  renameFile?: (from: string, to: string) => Promise<void>
  moveMetadata?: (db: DatabaseT, fromPath: string, toPath: string) => boolean
}): Promise<void> {
  const { db, fromPath, toPath, fromAbs, toAbs } = input
  // Default is create-only: an external file at the destination fails
  // the move closed instead of being replaced (POSIX rename would
  // atomically overwrite it).
  const renameFile = input.renameFile ?? createOnlyMoveFile
  const moveMetadata = input.moveMetadata ?? moveDocumentMetadataReplacingDestination
  // Custom rename functions are test/fault-injection seams and may not
  // operate on real paths. The production create-only mover always gets
  // a durable journal spanning file move through metadata commit.
  let journalPath: string | null = null
  let journalStagingPath: string | null = null
  if (input.renameFile === undefined) {
    const sourceRaw = await fs.readFile(fromAbs, 'utf8')
    journalPath = path.join(path.dirname(fromAbs), `.${path.basename(fromAbs)}.docus-journal-${randomUUID()}`)
    journalStagingPath = path.join(path.dirname(fromAbs), `.${path.basename(fromAbs)}.docus-rename-${randomUUID()}`)
    await writeDurableJournal(journalPath, {
      version: 1,
      op: 'file-rename',
      srcRel: fromPath,
      destRel: toPath,
      staging: path.basename(journalStagingPath),
      documentId: getDocumentMetadata(db, fromPath)?.id,
      sourceHash: sha256Hex(sourceRaw),
    })
  }
  const forwardRename = input.renameFile ?? ((from: string, to: string) => createOnlyMoveFile(from, to, journalStagingPath ?? undefined))
  try {
    await forwardRename(fromAbs, toAbs)
  } catch (error) {
    // A double reuse leaves the owned generation in staging. Preserve
    // the journal so startup/manual recovery can associate its identity;
    // ordinary destination contention restored the source completely.
    if (journalPath && !(error instanceof RenameSourceReusedError)) await removeDurableJournal(journalPath).catch(() => {})
    if (journalPath && error instanceof RenameSourceReusedError) {
      throw new RenameSourceReusedError(fromPath, {
        stagingPath: error.stagingPath,
        survivingPath: error.survivingPath,
        destinationOccupied: error.destinationOccupied,
        journalPath,
      })
    }
    throw error
  }
  if (__createOnlyMoveHooks?.afterFileMoveFinalized) await __createOnlyMoveHooks.afterFileMoveFinalized()
  try {
    if (!moveMetadata(db, fromPath, toPath)) {
      throw new Error(`source metadata missing: ${fromPath}`)
    }
    if (journalPath) await removeDurableJournal(journalPath).catch(() => {})
  } catch (metadataError) {
    try {
      await renameFile(toAbs, fromAbs)
    } catch (rollbackError) {
      if (rollbackError instanceof RenameDestinationOccupiedError) {
        // The original path was re-used externally: the create-only
        // rollback left the bytes at the destination rather than
        // overwriting the external file. The caller must keep the
        // identity with the bytes.
        throw new RenameSourceReusedError(fromPath, { survivingPath: 'destination', journalPath: journalPath ?? undefined })
      }
      if (rollbackError instanceof RenameSourceReusedError) {
        throw new RenameSourceReusedError(fromPath, {
          stagingPath: rollbackError.stagingPath,
          survivingPath: rollbackError.survivingPath,
          destinationOccupied: rollbackError.destinationOccupied,
          journalPath: journalPath ?? undefined,
        })
      }
      throw new AggregateError(
        [metadataError, rollbackError],
        'metadata move failed and filesystem rollback also failed',
      )
    }
    if (journalPath) await removeDurableJournal(journalPath).catch(() => {})
    throw metadataError
  }
}
