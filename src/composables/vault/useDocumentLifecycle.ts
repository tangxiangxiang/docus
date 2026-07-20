import type { PostSummary } from '../../lib/api'
import {
  createFolder,
  createPost,
  deleteFolder,
  deletePost,
  patchPost,
  renameFolder,
} from '../../lib/api'
import type { VaultFileChanges } from './context/fileChanges'
import type { DocumentMutationBarrier } from './editor-tabs/useDocumentSave'
import type {
  DraftDeletePolicy,
  DraftDeleteConfirmation,
  DraftDocumentIdentity,
  DraftFileMutationBarrier,
  DraftFileTransactionResult,
  DraftPathMapping,
} from './draft-recovery/useDraftFileTransactions'
import { createPathMutationLock, toMutationPaths } from './pathMutationLock'

export class DocumentMutationConflictError extends Error {
  constructor() {
    super('document mutation in progress')
    this.name = 'DocumentMutationConflictError'
  }
}

export interface DocumentLifecycle {
  createFile(input: { path: string; title?: string }): Promise<PostSummary>
  createFolder(path: string): Promise<{ path: string }>
  renameFile(
    fromPath: string,
    body: { name?: string; targetPath?: string; updateReferences?: boolean },
    referencePaths?: readonly string[],
  ): Promise<PostSummary>
  renameFolder(
    fromFolder: string,
    toFolder: string,
    affectedPaths: readonly string[],
    updateReferences?: boolean,
    referencePaths?: readonly string[],
  ): Promise<{ path: string; moved: string[]; updatedReferences?: Array<{ path: string; raw: string; mtime: number }> }>
  deleteFile(
    path: string,
    options?: {
      draftPolicy?: DraftDeletePolicy
      draftConfirmations?: readonly DraftDeleteConfirmation[]
    },
  ): Promise<{ ok: true }>
  deleteFolder(
    path: string,
    affectedPaths: readonly string[],
    options?: {
      draftPolicy?: DraftDeletePolicy
      draftConfirmations?: readonly DraftDeleteConfirmation[]
    },
  ): Promise<{ deleted: string[] }>
  captureDraftDeleteConfirmations(
    paths: readonly string[],
  ): DraftDeleteConfirmation[]
}

export interface LifecycleOptions {
  fileChanges: VaultFileChanges
  mutationLock: ReturnType<typeof createPathMutationLock>
  prepareDocumentMutation(paths: readonly string[], lockAll?: boolean): Promise<DocumentMutationBarrier>
  getOpenDocumentPaths(): readonly string[]
  applyReferenceWrites(updatedReferences: ReadonlyArray<{ path: string; raw: string; mtime: number }>): Promise<void>
  renameOpenDocuments(mappings: ReadonlyArray<{ from: string; to: string }>): void
  removeOpenDocuments(paths: readonly string[]): void
  refresh(): Promise<void>
  resolveDocumentIdentity?(path: string): Promise<DraftDocumentIdentity | null>
  prepareDraftFileMutation?(
    identities: readonly DraftDocumentIdentity[],
  ): Promise<DraftFileMutationBarrier>
  captureDraftDeleteConfirmation?(
    path: string,
  ): DraftDeleteConfirmation | null
  findDraftsByPaths?(
    paths: readonly string[],
  ): Promise<readonly DraftDocumentIdentity[]>
  onDraftTransactionSettled?(
    results: readonly DraftFileTransactionResult[],
  ): Promise<void> | void
  warnDraftTransaction?(results: readonly DraftFileTransactionResult[]): void
}

function folderMapping(fromFolder: string, toFolder: string, path: string): string | null {
  if (path === fromFolder) return toFolder
  if (!path.startsWith(`${fromFolder}/`)) return null
  return `${toFolder}${path.slice(fromFolder.length)}`
}

export function useDocumentLifecycle(options: LifecycleOptions): DocumentLifecycle {
  function captureDraftDeleteConfirmations(
    paths: readonly string[],
  ): DraftDeleteConfirmation[] {
    return paths.flatMap((path) => {
      const confirmation = options.captureDraftDeleteConfirmation?.(path)
      return confirmation ? [confirmation] : []
    })
  }

  async function identities(paths: readonly string[]): Promise<DraftDocumentIdentity[]> {
    if (!options.resolveDocumentIdentity) return []
    const resolved: DraftDocumentIdentity[] = []
    let cursor = 0
    const workers = Array.from(
      { length: Math.min(4, paths.length) },
      async () => {
        while (cursor < paths.length) {
          const path = paths[cursor++]
          const identity = await options.resolveDocumentIdentity!(path)
          if (identity) resolved.push(identity)
        }
      },
    )
    await Promise.all(workers)
    return resolved
  }

  async function unresolvedDraftIdentities(
    paths: readonly string[],
    resolved: readonly DraftDocumentIdentity[],
  ): Promise<DraftDocumentIdentity[]> {
    if (!options.findDraftsByPaths) return []
    const resolvedPaths = new Set(resolved.map(({ documentPath }) => documentPath))
    const unresolvedPaths = paths.filter((path) => !resolvedPaths.has(path))
    return unresolvedPaths.length > 0
      ? [...await options.findDraftsByPaths(unresolvedPaths)]
      : []
  }

  async function reportDraftResults(
    results: readonly DraftFileTransactionResult[],
  ): Promise<void> {
    try {
      await options.onDraftTransactionSettled?.(results)
    } catch {
      // Recovery UI synchronization is best-effort. The authoritative file
      // transaction has already succeeded and must not be reported as failed.
    }
    const warnings = results.filter(({ status }) => (
      status === 'identity-mismatch'
      || status === 'conflict'
      || status === 'unsupported'
      || status === 'failed'
      || status === 'stale'
    ))
    if (warnings.length > 0) options.warnDraftTransaction?.(warnings)
  }

  async function refreshBestEffort(label: string): Promise<void> {
    try {
      await options.refresh()
    } catch (error) {
      console.warn(`[useDocumentLifecycle] ${label} succeeded, but Vault refresh failed`, error)
    }
  }

  async function applyAndPublishReferenceWrites(
    updatedReferences: ReadonlyArray<{ path: string; raw: string; mtime: number }> = [],
  ): Promise<void> {
    await options.applyReferenceWrites(updatedReferences)
    const seen = new Set<string>()
    for (const updated of updatedReferences) {
      const key = `${updated.path}\0${updated.raw}`
      if (seen.has(key)) continue
      seen.add(key)
      options.fileChanges.publish({
        path: updated.path,
        kind: 'write',
        newRaw: updated.raw,
        newMtime: updated.mtime,
        source: 'editor-lifecycle',
      })
    }
  }

  async function withMutation<T>(
    paths: readonly string[],
    operation: (barrier: DocumentMutationBarrier) => Promise<T>,
    lockAll = false,
  ): Promise<T> {
    const release = lockAll
      ? options.mutationLock.acquireAll()
      : options.mutationLock.acquire(toMutationPaths(paths))
    if (!release) throw new DocumentMutationConflictError()
    let barrier: DocumentMutationBarrier | null = null
    let committed = false
    try {
      barrier = await options.prepareDocumentMutation(paths, lockAll)
      const result = await operation(barrier)
      committed = true
      return result
    } catch (error) {
      if (!committed) barrier?.rollback()
      throw error
    } finally {
      release()
    }
  }

  async function createFile(input: { path: string; title?: string }): Promise<PostSummary> {
    return withMutation([input.path], async (barrier) => {
      const created = await createPost(input)
      options.fileChanges.publish({ path: created.path, kind: 'write', source: 'editor-lifecycle' })
      barrier.commit()
      await refreshBestEffort(`Create ${created.path}`)
      return created
    })
  }

  async function createFolderLifecycle(path: string): Promise<{ path: string }> {
    return withMutation([path], async (barrier) => {
      const created = await createFolder(path)
      barrier.commit([path])
      await refreshBestEffort(`Create folder ${created.path}`)
      return created
    })
  }

  function requestedTargetPath(
    fromPath: string,
    body: { name?: string; targetPath?: string },
  ): string | null {
    if (body.targetPath) return body.targetPath
    if (!body.name) return null
    const slash = fromPath.lastIndexOf('/')
    return slash === -1 ? body.name : `${fromPath.slice(0, slash)}/${body.name}`
  }

  async function renameFile(
    fromPath: string,
    body: { name?: string; targetPath?: string; updateReferences?: boolean },
    referencePaths: readonly string[] = [],
  ): Promise<PostSummary> {
    const targetPath = requestedTargetPath(fromPath, body)
    const lockAll = body.updateReferences === true
    const mutationPaths = [
      fromPath,
      ...(targetPath ? [targetPath] : []),
      ...referencePaths,
      ...(lockAll ? options.getOpenDocumentPaths() : []),
    ]
    return withMutation(mutationPaths, async (barrier) => {
      const before = (await identities([fromPath]))[0] ?? null
      const unresolvedDrafts = before
        ? []
        : await unresolvedDraftIdentities([fromPath], [])
      const preparedDrafts = before ? [before] : unresolvedDrafts
      const draftBarrier = preparedDrafts.length > 0 && options.prepareDraftFileMutation
        ? await options.prepareDraftFileMutation(preparedDrafts)
        : null
      let renamed: PostSummary
      try {
        renamed = await patchPost(fromPath, body)
      } catch (error) {
        await draftBarrier?.rollback()
        throw error
      }
      const mapping = { from: fromPath, to: renamed.path }
      // The server rename has already succeeded. Tab migration is a
      // best-effort UX step — if it throws, the server state is
      // already moved, so we MUST still publish the rename, refresh
      // the tree, and return success to the caller. Otherwise the
      // user sees a "rename failed" toast while the file is already
      // moved on disk, leaving the tree / tabs inconsistent with the
      // server.
      try {
        if (draftBarrier && before) {
          const after = (await identities([renamed.path]))[0] ?? null
          const draftResults = after?.documentId === before.documentId
            ? await draftBarrier.commitMoves([{
                vaultId: before.vaultId,
                documentId: before.documentId,
                fromPath,
                toPath: renamed.path,
              }])
            : await draftBarrier.commitMoves([], [before])
          if (!after || after.documentId !== before.documentId) {
            draftResults.push({
              documentId: before.documentId,
              oldPath: fromPath,
              newPath: renamed.path,
              status: 'identity-mismatch',
            })
          }
          try {
            options.renameOpenDocuments([mapping])
          } finally {
            await draftBarrier.finalizeAfterTabMigration?.()
          }
          await reportDraftResults(draftResults)
        } else if (draftBarrier) {
          const draftResults = await draftBarrier.commitMoves([], unresolvedDrafts)
          try {
            options.renameOpenDocuments([mapping])
          } finally {
            await draftBarrier.finalizeAfterTabMigration?.()
          }
          await reportDraftResults([
            ...draftResults,
            ...unresolvedDrafts.map((draft) => ({
              documentId: draft.documentId,
              oldPath: draft.documentPath,
              newPath: renamed.path,
              status: 'identity-mismatch' as const,
            })),
          ])
        } else {
          options.renameOpenDocuments([mapping])
        }
      } catch (error) {
        console.warn(`[useDocumentLifecycle] Server rename ${fromPath} → ${renamed.path} succeeded, but Tab migration threw:`, error)
      }
      options.fileChanges.publish({
        oldPath: fromPath,
        path: renamed.path,
        kind: 'rename',
        source: 'editor-lifecycle',
      })
      await applyAndPublishReferenceWrites(renamed.updatedReferences)
      barrier.commit(options.getOpenDocumentPaths())
      await refreshBestEffort(`Rename ${fromPath} to ${renamed.path}`)
      return renamed
    }, lockAll)
  }

  async function renameFolderLifecycle(
    fromFolder: string,
    toFolder: string,
    affectedPaths: readonly string[],
    updateReferences = false,
    referencePaths: readonly string[] = [],
  ) {
    const mutationPaths = [...affectedPaths, ...referencePaths, ...options.getOpenDocumentPaths()]
    return withMutation(mutationPaths, async (barrier) => {
      const before = await identities(affectedPaths)
      const unresolvedDrafts = await unresolvedDraftIdentities(affectedPaths, before)
      const draftBarrier = options.prepareDraftFileMutation
        ? await options.prepareDraftFileMutation([...before, ...unresolvedDrafts])
        : null
      let result: Awaited<ReturnType<typeof renameFolder>>
      try {
        result = await renameFolder(fromFolder, toFolder, updateReferences)
      } catch (error) {
        await draftBarrier?.rollback()
        throw error
      }
      const moved = new Set(result.moved)
      const mappings = affectedPaths.flatMap((from) => {
        const to = folderMapping(fromFolder, result.path, from)
        return to && moved.has(to) ? [{ from, to }] : []
      })
      if (draftBarrier) {
        const byOldPath = new Map(before.map((identity) => [identity.documentPath, identity]))
        const after = await identities(mappings.map(({ to }) => to))
        const afterByPath = new Map(after.map((identity) => [identity.documentPath, identity]))
        const draftMappings: DraftPathMapping[] = []
        const preserved: DraftDocumentIdentity[] = [...unresolvedDrafts]
        const mismatches: DraftFileTransactionResult[] = unresolvedDrafts.map((draft) => ({
          documentId: draft.documentId,
          oldPath: draft.documentPath,
          newPath: folderMapping(fromFolder, result.path, draft.documentPath) ?? undefined,
          status: 'identity-mismatch',
        }))
        for (const mapping of mappings) {
          const source = byOldPath.get(mapping.from)
          const target = afterByPath.get(mapping.to)
          if (source && target?.documentId === source.documentId) {
            draftMappings.push({
              vaultId: source.vaultId,
              documentId: source.documentId,
              fromPath: mapping.from,
              toPath: mapping.to,
            })
          } else if (source) {
            preserved.push(source)
            mismatches.push({
              documentId: source.documentId,
              oldPath: mapping.from,
              newPath: mapping.to,
              status: 'identity-mismatch',
            })
          }
        }
        const draftResults = await draftBarrier.commitMoves(draftMappings, preserved)
        // Server folder rename already succeeded. If Tab migration
        // throws, swallow the error so the rename event still
        // publishes and refresh runs below. The barrier still
        // finalizes in the `finally` so draft persistence is
        // never permanently locked.
        try {
          options.renameOpenDocuments(mappings)
        } catch (error) {
          console.warn(
            `[useDocumentLifecycle] Server folder rename ${fromFolder} → ${result.path} succeeded, but Tab migration threw:`,
            error,
          )
        } finally {
          await draftBarrier.finalizeAfterTabMigration?.()
        }
        await reportDraftResults([...draftResults, ...mismatches])
      } else {
        try {
          options.renameOpenDocuments(mappings)
        } catch (error) {
          // Server rename already succeeded — Tab migration is best
          // effort; swallow the error so the rename event still
          // publishes and refresh runs below.
          console.warn(`[useDocumentLifecycle] Server rename folder ${fromFolder} → ${result.path} succeeded, but Tab migration threw:`, error)
        }
      }
      for (const mapping of mappings) {
        options.fileChanges.publish({
          oldPath: mapping.from,
          path: mapping.to,
          kind: 'rename',
          source: 'editor-lifecycle',
        })
      }
      await applyAndPublishReferenceWrites(result.updatedReferences)
      barrier.commit(options.getOpenDocumentPaths())
      await refreshBestEffort(`Rename folder ${fromFolder} to ${result.path}`)
      return result
    }, true)
  }

  async function deleteFileLifecycle(
    path: string,
    lifecycleOptions: {
      draftPolicy?: DraftDeletePolicy
      draftConfirmations?: readonly DraftDeleteConfirmation[]
    } = {},
  ): Promise<{ ok: true }> {
    return withMutation([path], async (barrier) => {
      const before = (await identities([path]))[0] ?? null
      const unresolvedDrafts = before
        ? []
        : await unresolvedDraftIdentities([path], [])
      const preparedDrafts = before ? [before] : unresolvedDrafts
      const draftBarrier = preparedDrafts.length > 0 && options.prepareDraftFileMutation
        ? await options.prepareDraftFileMutation(preparedDrafts)
        : null
      let result: { ok: true }
      try {
        result = await deletePost(path)
      } catch (error) {
        await draftBarrier?.rollback()
        throw error
      }
      let draftHandoffFailed = false
      if (draftBarrier && before) {
        const confirmation = lifecycleOptions.draftConfirmations?.find(
          (candidate) => candidate.documentId === before.documentId
            && candidate.documentPath === before.documentPath,
        )
        const draftResults = await draftBarrier.commitDeletes([{
          ...before,
          policy: lifecycleOptions.draftPolicy ?? 'preserve',
          confirmation,
        }])
        await reportDraftResults(draftResults)
        draftHandoffFailed = draftResults.some((result) => result.status === 'failed')
      } else if (draftBarrier) {
        const preserved = await draftBarrier.commitDeletes(unresolvedDrafts.map((draft) => ({
          ...draft,
          policy: 'preserve',
        })))
        await reportDraftResults([
          ...preserved,
          ...unresolvedDrafts.map((draft) => ({
            documentId: draft.documentId,
            oldPath: draft.documentPath,
            status: 'identity-mismatch' as const,
          })),
        ])
        draftHandoffFailed = preserved.some((result) => result.status === 'failed')
      }
      // If the draft handoff failed, the user's unsaved content lives
      // only in the in-memory persistence entry. Keep the editor tab
      // open — it is the only surface still holding those bytes, and
      // closing it here would permanently lose content the conflict
      // store was supposed to preserve.
      if (!draftHandoffFailed) {
        options.removeOpenDocuments([path])
      }
      options.fileChanges.publish({ path, kind: 'delete', source: 'editor-lifecycle' })
      barrier.commit()
      await refreshBestEffort(`Delete ${path}`)
      return result
    })
  }

  async function deleteFolderLifecycle(
    path: string,
    affectedPaths: readonly string[],
    lifecycleOptions: {
      draftPolicy?: DraftDeletePolicy
      draftConfirmations?: readonly DraftDeleteConfirmation[]
    } = {},
  ): Promise<{ deleted: string[] }> {
    return withMutation([...affectedPaths, ...options.getOpenDocumentPaths()], async (barrier) => {
      const before = await identities(affectedPaths)
      const unresolvedDrafts = await unresolvedDraftIdentities(affectedPaths, before)
      const draftBarrier = options.prepareDraftFileMutation
        ? await options.prepareDraftFileMutation([...before, ...unresolvedDrafts])
        : null
      let result: { deleted: string[] }
      try {
        result = await deleteFolder(path, true)
      } catch (error) {
        await draftBarrier?.rollback()
        throw error
      }
      let failedHandoffPaths: ReadonlySet<string> | null = null
      if (draftBarrier) {
        const deleted = new Set(result.deleted)
        const draftResults = await draftBarrier.commitDeletes(
          [
            ...before.filter((identity) => deleted.has(identity.documentPath)).map((identity) => ({
              ...identity,
              policy: lifecycleOptions.draftPolicy ?? 'preserve',
              confirmation: lifecycleOptions.draftConfirmations?.find(
                (candidate) => candidate.documentId === identity.documentId
                  && candidate.documentPath === identity.documentPath,
              ),
            })),
            ...unresolvedDrafts
              .filter((identity) => deleted.has(identity.documentPath))
              .map((identity) => ({ ...identity, policy: 'preserve' as const })),
          ],
        )
        failedHandoffPaths = new Set(
          draftResults
            .filter((transaction) => transaction.status === 'failed')
            .map((transaction) => transaction.oldPath),
        )
        await reportDraftResults([
          ...draftResults,
          ...unresolvedDrafts.map((draft) => ({
            documentId: draft.documentId,
            oldPath: draft.documentPath,
            status: 'identity-mismatch' as const,
          })),
        ])
      }
      // A path whose draft handoff failed keeps its Document tab open —
      // the in-memory persistence entry is the only surface still
      // holding those bytes, and closing the tab here would permanently
      // lose them (same guard as deleteFileLifecycle, applied per path:
      // one failed document must not hold its successfully deleted /
      // preserved siblings' tabs open, and must not close its own).
      const keepOpen = failedHandoffPaths
      options.removeOpenDocuments(keepOpen
        ? result.deleted.filter((deletedPath) => !keepOpen.has(deletedPath))
        : result.deleted)
      for (const deletedPath of result.deleted) {
        options.fileChanges.publish({ path: deletedPath, kind: 'delete', source: 'editor-lifecycle' })
      }
      barrier.commit(options.getOpenDocumentPaths())
      await refreshBestEffort(`Delete folder ${path}`)
      return result
    }, true)
  }

  return {
    createFile,
    createFolder: createFolderLifecycle,
    renameFile,
    renameFolder: renameFolderLifecycle,
    deleteFile: deleteFileLifecycle,
    deleteFolder: deleteFolderLifecycle,
    captureDraftDeleteConfirmations,
  }
}
