import { createHash, randomUUID } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * Write a small JSON journal durably (O_EXCL create + write + fsync) so
 * it is on disk BEFORE the operation it describes begins. Startup crash
 * recovery (server/crashRecovery.ts) uses it to tell an interrupted
 * commit from an orphaned temp and to verify both generations by hash.
 */
export async function writeDurableJournal(journalPath: string, entry: unknown): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(
      journalPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    )
    await handle.writeFile(JSON.stringify(entry), { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = null
    // fsync(file) persists bytes, but a newly-created directory entry is
    // not power-loss durable until its parent directory is synced too.
    await syncParentDirectoryBestEffort(journalPath)
  } catch (error) {
    await handle?.close().catch(() => {})
    await fs.rm(journalPath, { force: true }).catch(() => {})
    await syncParentDirectoryBestEffort(journalPath)
    throw error
  }
}

/** Remove a journal and durably persist disappearance of its directory
 * entry. This prevents a completed operation's journal from reappearing
 * after power loss and being replayed on the next startup. */
export async function removeDurableJournal(journalPath: string): Promise<void> {
  await fs.rm(journalPath, { force: true })
  await syncParentDirectoryBestEffort(journalPath)
}

/** Atomically replace an owned journal with a new durable recovery
 * phase. The temporary entry and the final rename are both directory
 * synced, so repeated startup recovery observes either complete state. */
export async function rewriteDurableJournal(journalPath: string, entry: unknown): Promise<void> {
  const temporaryPath = `${journalPath}.rewrite-${randomUUID()}`
  await writeDurableJournal(temporaryPath, entry)
  try {
    await fs.rename(temporaryPath, journalPath)
    await syncParentDirectoryBestEffort(journalPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    await syncParentDirectoryBestEffort(temporaryPath)
    throw error
  }
}

/** Test-only hooks for real crash tests: a child process installs a
 * hook that kills the process hard at the exact protocol point under
 * test. Null in production; tests reset in afterEach/finally. */
export type AtomicWriteCrashHooks = {
  afterJournalWrite?: () => void | Promise<void>
  afterTakeover?: () => void | Promise<void>
}
let __atomicWriteCrashHooks: AtomicWriteCrashHooks | null = null
export function __setAtomicWriteCrashHooksForTesting(hooks: AtomicWriteCrashHooks | null): void {
  __atomicWriteCrashHooks = hooks
}

export interface PreparedAtomicTextWrite {
  readonly temporaryPath: string
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
 * A prepared replacement whose commit is ownership-verified: it never
 * overwrites a generation it did not verify. See commit() below.
 */
export interface PreparedAtomicTextReplace {
  readonly temporaryPath: string
  /**
   * Commit the replacement with an external-writer-safe protocol:
   *
   *   1. OWNERSHIP — atomically rename the current target aside to a
   *      private staging path. Whoever wins this rename owns the old
   *      generation; there is no check-to-rename window afterwards.
   *   2. VERIFY — the staged bytes must still equal `expectedRaw`.
   *      An external save that landed before the takeover is detected
   *      here: the staged bytes are restored create-only and the
   *      commit fails closed.
   *   3. COMMIT — link(2) the new generation into the target path.
   *      link is create-only: if an external writer recreated the
   *      path while we held the staged generation, EEXIST fails the
   *      commit and the external file is preserved untouched.
   *
   * Any external generation wins. The caller's bytes are never written
   * over a generation the caller did not prove it still owned.
   */
  commit(expectedRaw: string): Promise<void>
  rollback(): Promise<void>
}

/** Prepare a durable temporary file whose commit atomically creates, but can
 * never replace, the target path. */
export async function prepareAtomicTextCreate(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<PreparedAtomicTextWrite> {
  const prepared = await prepareAtomicTextWrite(targetPath, raw, options)
  let settled = false
  return {
    temporaryPath: prepared.temporaryPath,
    async commit() {
      if (settled) return
      try {
        // link(2) is the create-only counterpart to rename: it atomically
        // fails with EEXIST and never replaces a newer generation.
        await fs.link(prepared.temporaryPath, targetPath)
        settled = true
        await fs.rm(prepared.temporaryPath, { force: true }).catch(() => {})
        await syncParentDirectoryBestEffort(targetPath)
      } catch (error) {
        settled = true
        await fs.rm(prepared.temporaryPath, { force: true }).catch(() => {})
        throw error
      }
    },
    async rollback() {
      if (settled) return
      settled = true
      await fs.rm(prepared.temporaryPath, { force: true }).catch(() => {})
    },
  }
}

export interface StableTextSnapshot {
  raw: string
  stat: {
    mtimeMs: number
    size: number
    mode: number
  }
}

export class AtomicTextWriteConflictError extends Error {
  readonly current: StableTextSnapshot

  constructor(current: StableTextSnapshot) {
    super('document changed before atomic replacement')
    this.name = 'AtomicTextWriteConflictError'
    this.current = current
  }
}

/** The target disappeared (an external delete) before the commit could
 * take ownership of its generation. */
export class AtomicTextWriteTargetMissingError extends Error {
  constructor(targetPath: string) {
    super(`atomic replacement target disappeared: ${targetPath}`)
    this.name = 'AtomicTextWriteTargetMissingError'
  }
}

export class UnstableTextSnapshotError extends Error {
  readonly latest: StableTextSnapshot

  constructor(latest: StableTextSnapshot) {
    super('document did not stabilize while reading')
    this.name = 'UnstableTextSnapshotError'
    this.latest = latest
  }
}

export async function syncParentDirectoryBestEffort(targetPath: string): Promise<void> {
  let directory: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    directory = await fs.open(path.dirname(targetPath), constants.O_RDONLY)
    await directory.sync()
  } catch {
    // Directory fsync is not supported on every platform/filesystem.
  } finally {
    await directory?.close().catch(() => {})
  }
}

export async function renameWithTransientWindowsRetry(from: string, to: string): Promise<void> {
  const delays = process.platform === 'win32' ? [0, 5, 20, 50] : [0]
  let lastError: unknown
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error
    }
  }
  throw lastError
}

/**
 * Restore a staged generation to the target path WITHOUT ever
 * replacing a newer one: link(2) is create-only, so a path an external
 * writer recreated wins — the staged bytes then stay quarantined on
 * disk under their staging name rather than clobbering the new
 * generation. `quarantined: true` reports that the staged bytes could
 * not be restored and remain on disk under their staging name.
 */
export async function restoreStagedGeneration(
  stagedPath: string,
  targetPath: string,
): Promise<{ quarantined: boolean }> {
  try {
    await fs.link(stagedPath, targetPath)
    await fs.rm(stagedPath, { force: true }).catch(() => {})
    return { quarantined: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // A newer external generation owns the path: never clobber it.
      return { quarantined: true }
    }
    // link failed for some other reason; put the bytes back only if
    // the path is still unclaimed.
    const targetExists = await fs.stat(targetPath).then(() => true, () => false)
    if (!targetExists) {
      try {
        await renameWithTransientWindowsRetry(stagedPath, targetPath)
        return { quarantined: false }
      } catch {
        return { quarantined: true }
      }
    }
    return { quarantined: true }
  }
}

async function writeTemporaryTextFile(
  targetPath: string,
  raw: string,
  options: { mode?: number },
): Promise<string> {
  const directory = path.dirname(targetPath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.docus-save-${randomUUID()}`,
  )
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      options.mode,
    )
    await handle.writeFile(raw, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = null
    if (options.mode !== undefined) {
      await fs.chmod(temporaryPath, options.mode)
    }
  } catch (error) {
    await handle?.close().catch(() => {})
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
  return temporaryPath
}

export async function prepareAtomicTextWrite(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<PreparedAtomicTextReplace> {
  const temporaryPath = await writeTemporaryTextFile(targetPath, raw, options)
  const replacementHash = sha256Hex(raw)
  let settled = false

  return {
    temporaryPath,
    async commit(expectedRaw: string) {
      if (settled) return
      const stagedPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.docus-staged-${randomUUID()}`,
      )
      const journalPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.docus-journal-${randomUUID()}`,
      )
      const fail = async (error: unknown): Promise<never> => {
        settled = true
        await fs.rm(temporaryPath, { force: true }).catch(() => {})
        await removeDurableJournal(journalPath).catch(() => {})
        throw error
      }
      // 0. JOURNAL: a durable record of this commit's intent and both
      //    generations' hashes, fsync'd BEFORE the takeover. If this
      //    process dies at any point after the takeover rename below
      //    (kill -9, power loss, container stop), the formal path would
      //    otherwise be left missing with only hidden staging files —
      //    the note would appear to vanish. Startup crash recovery
      //    (server/crashRecovery.ts) reads this journal, verifies the
      //    staged/replacement bytes against the hashes, and either
      //    completes the commit or restores the old generation before
      //    the HTTP server accepts a single request. The journal is
      //    removed LAST; a failed commit removes it in fail().
      try {
        await writeDurableJournal(journalPath, {
          version: 1,
          op: 'replace',
          staged: path.basename(stagedPath),
          replacement: path.basename(temporaryPath),
          expectedHash: sha256Hex(expectedRaw),
          replacementHash,
        })
      } catch (error) {
        return fail(error)
      }
      if (__atomicWriteCrashHooks?.afterJournalWrite) await __atomicWriteCrashHooks.afterJournalWrite()
      // 1. OWNERSHIP: atomically take the current generation aside. An
      //    external save that landed before this rename travels with
      //    the bytes to staging and is detected at verification; one
      //    that recreates the path afterwards loses to the create-only
      //    link below. Either way it is never silently overwritten.
      try {
        await renameWithTransientWindowsRetry(targetPath, stagedPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return fail(new AtomicTextWriteTargetMissingError(targetPath))
        }
        return fail(error)
      }
      // Publish the takeover durably before continuing: a crash after
      // this point must see the staged bytes on the next startup.
      await syncParentDirectoryBestEffort(targetPath)
      if (__atomicWriteCrashHooks?.afterTakeover) await __atomicWriteCrashHooks.afterTakeover()
      // 2. VERIFY the owned generation.
      let stagedSnapshot: StableTextSnapshot
      try {
        stagedSnapshot = await readStableTextSnapshot(stagedPath)
      } catch (error) {
        await restoreStagedGeneration(stagedPath, targetPath)
        return fail(error)
      }
      if (stagedSnapshot.raw !== expectedRaw) {
        await restoreStagedGeneration(stagedPath, targetPath)
        return fail(new AtomicTextWriteConflictError(stagedSnapshot))
      }
      // 3. COMMIT create-only: link(2) never replaces. EEXIST means a
      //    new external generation landed while we held the staged
      //    bytes — preserve it. The staged generation equals
      //    expectedRaw, which the caller already holds, so both of our
      //    files are removed and the conflict reports the winner.
      try {
        await fs.link(temporaryPath, targetPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          await fs.rm(stagedPath, { force: true }).catch(() => {})
          let current: StableTextSnapshot
          try {
            current = await readStableTextSnapshot(targetPath)
          } catch {
            return fail(error)
          }
          return fail(new AtomicTextWriteConflictError(current))
        }
        await restoreStagedGeneration(stagedPath, targetPath)
        return fail(error)
      }
      settled = true
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
      await fs.rm(stagedPath, { force: true }).catch(() => {})
      // The journal goes LAST: while it exists, recovery still knows
      // this commit was in flight and can finish or undo it.
      await removeDurableJournal(journalPath).catch(() => {})
      await syncParentDirectoryBestEffort(targetPath)
    },
    async rollback() {
      if (settled) return
      settled = true
      await fs.rm(temporaryPath, { force: true }).catch(() => {})
    },
  }
}

/**
 * Read around stat so a content change observed during snapshot collection is
 * retried instead of pairing an old body with a newer file status.
 */
export async function readStableTextSnapshot(
  targetPath: string,
  maxAttempts = 3,
): Promise<StableTextSnapshot> {
  let latest: StableTextSnapshot | null = null
  const numericStat = async () => {
    const stat = await fs.stat(targetPath)
    return {
      mtimeMs: Number(stat.mtimeMs),
      size: Number(stat.size),
      mode: Number(stat.mode),
    }
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = await fs.readFile(targetPath, 'utf8')
    const stat = await numericStat()
    const after = await fs.readFile(targetPath, 'utf8')
    latest = {
      raw: after,
      stat: after === before ? stat : await numericStat(),
    }
    if (after === before) return latest
  }
  throw new UnstableTextSnapshotError(latest!)
}

/**
 * Replace a text file only while its current bytes still match the
 * caller's expectation, with no check-to-rename window: the commit
 * takes ownership of the current generation first (atomic rename
 * aside), verifies it, and links the replacement in create-only. An
 * external writer winning any race keeps its bytes and the call fails
 * closed with AtomicTextWriteConflictError (or
 * AtomicTextWriteTargetMissingError if the target was deleted). The
 * file's mode is preserved.
 */
export async function atomicReplaceTextIfUnchanged(
  targetPath: string,
  expectedRaw: string,
  replacementRaw: string,
  options: { mode?: number } = {},
): Promise<void> {
  let mode = options.mode
  if (mode === undefined) {
    mode = await fs.stat(targetPath).then((stat) => Number(stat.mode), () => undefined)
  }
  const prepared = await prepareAtomicTextWrite(targetPath, replacementRaw, { mode })
  try {
    await prepared.commit(expectedRaw)
  } catch (error) {
    await prepared.rollback()
    throw error
  }
}

/**
 * Remove a text file only while the bytes being removed still match the
 * caller's write. Renaming first means a writer that changes the same inode
 * before cleanup is detected on the staged file and restored create-only
 * (a recreated path wins), rather than being silently deleted. If the
 * bytes changed, the removal is a no-op: the caller's write is already
 * gone and the external bytes stay. A missing target is likewise a
 * no-op — there is nothing left to remove.
 */
export async function atomicRemoveTextIfUnchanged(
  targetPath: string,
  expectedRaw: string,
): Promise<void> {
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.docus-remove-${randomUUID()}`,
  )
  try {
    await renameWithTransientWindowsRetry(targetPath, stagedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  let staged: StableTextSnapshot
  try {
    staged = await readStableTextSnapshot(stagedPath)
  } catch (error) {
    await restoreStagedGeneration(stagedPath, targetPath)
    throw error
  }
  if (staged.raw !== expectedRaw) {
    await restoreStagedGeneration(stagedPath, targetPath)
    return
  }
  await fs.rm(stagedPath)
  await syncParentDirectoryBestEffort(targetPath)
}

/**
 * Unconditional replacement: prepare + rename. Callers that need
 * external-writer safety must use atomicReplaceTextIfUnchanged (or
 * prepareAtomicTextWrite's ownership-verified commit) instead.
 */
export async function atomicReplaceText(
  targetPath: string,
  raw: string,
  options: { mode?: number } = {},
): Promise<void> {
  const temporaryPath = await writeTemporaryTextFile(targetPath, raw, options)
  try {
    await renameWithTransientWindowsRetry(temporaryPath, targetPath)
    await syncParentDirectoryBestEffort(targetPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}
