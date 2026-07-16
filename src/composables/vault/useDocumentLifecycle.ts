import type { PostSummary } from '../../lib/api'
import {
  createPost,
  deleteFolder,
  deletePost,
  patchPost,
  renameFolder,
} from '../../lib/api'
import type { VaultFileChanges } from './context/fileChanges'
import type { DocumentMutationBarrier } from './editor-tabs/useDocumentSave'
import { createPathMutationLock, toMutationPaths } from './pathMutationLock'

export class DocumentMutationConflictError extends Error {
  constructor() {
    super('document mutation in progress')
    this.name = 'DocumentMutationConflictError'
  }
}

export interface DocumentLifecycle {
  createFile(input: { path: string; title?: string }): Promise<PostSummary>
  renameFile(
    fromPath: string,
    body: { name?: string; targetPath?: string; updateReferences?: boolean },
  ): Promise<PostSummary>
  renameFolder(
    fromFolder: string,
    toFolder: string,
    affectedPaths: readonly string[],
    updateReferences?: boolean,
  ): Promise<{ path: string; moved: string[]; updatedReferences?: Array<{ path: string; raw: string }> }>
  deleteFile(path: string): Promise<{ ok: true }>
  deleteFolder(path: string, affectedPaths: readonly string[]): Promise<{ deleted: string[] }>
}

interface LifecycleOptions {
  fileChanges: VaultFileChanges
  mutationLock: ReturnType<typeof createPathMutationLock>
  prepareDocumentMutation(paths: readonly string[]): Promise<DocumentMutationBarrier>
  renameOpenDocuments(mappings: ReadonlyArray<{ from: string; to: string }>): void
  removeOpenDocuments(paths: readonly string[]): void
  refresh(): Promise<void>
}

function folderMapping(fromFolder: string, toFolder: string, path: string): string | null {
  if (path === fromFolder) return toFolder
  if (!path.startsWith(`${fromFolder}/`)) return null
  return `${toFolder}${path.slice(fromFolder.length)}`
}

export function useDocumentLifecycle(options: LifecycleOptions): DocumentLifecycle {
  async function refreshBestEffort(label: string): Promise<void> {
    try {
      await options.refresh()
    } catch (error) {
      console.warn(`[useDocumentLifecycle] ${label} succeeded, but Vault refresh failed`, error)
    }
  }

  function publishReferenceWrites(updatedReferences: ReadonlyArray<{ path: string; raw: string }> = []): void {
    const seen = new Set<string>()
    for (const updated of updatedReferences) {
      const key = `${updated.path}\0${updated.raw}`
      if (seen.has(key)) continue
      seen.add(key)
      options.fileChanges.publish({ path: updated.path, kind: 'write', newRaw: updated.raw })
    }
  }

  async function withMutation<T>(
    paths: readonly string[],
    operation: (barrier: DocumentMutationBarrier) => Promise<T>,
  ): Promise<T> {
    const release = options.mutationLock.acquire(toMutationPaths(paths))
    if (!release) throw new DocumentMutationConflictError()
    let barrier: DocumentMutationBarrier | null = null
    let committed = false
    try {
      barrier = await options.prepareDocumentMutation(paths)
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
    const created = await createPost(input)
    options.fileChanges.publish({ path: created.path, kind: 'write', source: 'editor-lifecycle' })
    await refreshBestEffort(`Create ${created.path}`)
    return created
  }

  async function renameFile(
    fromPath: string,
    body: { name?: string; targetPath?: string; updateReferences?: boolean },
  ): Promise<PostSummary> {
    return withMutation([fromPath], async (barrier) => {
      const renamed = await patchPost(fromPath, body)
      const mapping = { from: fromPath, to: renamed.path }
      options.renameOpenDocuments([mapping])
      options.fileChanges.publish({
        oldPath: fromPath,
        path: renamed.path,
        kind: 'rename',
        source: 'editor-lifecycle',
      })
      publishReferenceWrites(renamed.updatedReferences)
      barrier.commit([renamed.path])
      await refreshBestEffort(`Rename ${fromPath} to ${renamed.path}`)
      return renamed
    })
  }

  async function renameFolderLifecycle(
    fromFolder: string,
    toFolder: string,
    affectedPaths: readonly string[],
    updateReferences = false,
  ) {
    return withMutation(affectedPaths, async (barrier) => {
      const result = await renameFolder(fromFolder, toFolder, updateReferences)
      const moved = new Set(result.moved)
      const mappings = affectedPaths.flatMap((from) => {
        const to = folderMapping(fromFolder, result.path, from)
        return to && moved.has(to) ? [{ from, to }] : []
      })
      options.renameOpenDocuments(mappings)
      for (const mapping of mappings) {
        options.fileChanges.publish({
          oldPath: mapping.from,
          path: mapping.to,
          kind: 'rename',
          source: 'editor-lifecycle',
        })
      }
      publishReferenceWrites(result.updatedReferences)
      barrier.commit(mappings.map(({ to }) => to))
      await refreshBestEffort(`Rename folder ${fromFolder} to ${result.path}`)
      return result
    })
  }

  async function deleteFileLifecycle(path: string): Promise<{ ok: true }> {
    return withMutation([path], async (barrier) => {
      const result = await deletePost(path)
      options.removeOpenDocuments([path])
      options.fileChanges.publish({ path, kind: 'delete', source: 'editor-lifecycle' })
      barrier.commit()
      await refreshBestEffort(`Delete ${path}`)
      return result
    })
  }

  async function deleteFolderLifecycle(path: string, affectedPaths: readonly string[]): Promise<{ deleted: string[] }> {
    return withMutation(affectedPaths, async (barrier) => {
      const result = await deleteFolder(path, true)
      options.removeOpenDocuments(result.deleted)
      for (const deletedPath of result.deleted) {
        options.fileChanges.publish({ path: deletedPath, kind: 'delete', source: 'editor-lifecycle' })
      }
      barrier.commit()
      await refreshBestEffort(`Delete folder ${path}`)
      return result
    })
  }

  return {
    createFile,
    renameFile,
    renameFolder: renameFolderLifecycle,
    deleteFile: deleteFileLifecycle,
    deleteFolder: deleteFolderLifecycle,
  }
}
