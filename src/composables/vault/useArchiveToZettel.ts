// Shared archive-to-zettel logic.
//
// Two places in the vault need to push a file into zettel/<slug>.md:
//   - FileTree's right-click "归档到 zettel" menu item
//   - AiPanel's Drafts panel archive button
//
// Both compute the same targetPath, call the same patchPost endpoint,
// handle the same server-side -2 suffix collision, and toast the same
// success / failure messages. The only thing they differ on is which
// events they emit afterward — FileTree emits 'refresh' and maybe
// 'select', AiPanel emits 'refresh-tree' and 'open'. So the composable
// owns the patch + toast + collision handling and returns the final
// path; the caller does its own emits.

import { useToast } from '../useToast'
import { patchPost } from '../../lib/api'

export function useArchiveToZettel() {
  const toast = useToast()

  /**
   * Move `path` to `targetPath` (default: zettel/<filename>). Returns
   * the final path the server wrote (which may have a -2 / -3 suffix
   * on collision), or null if no action was taken (target equals
   * source, or no filename could be derived). Errors are toasted and
   * return null.
   *
   * The optional `targetPath` override is used by batch archive: the
   * caller pre-computes unique names from the full posts[] snapshot
   * so server-side collision suffixes don't pile up as -2/-3/-4/...
   * When omitted, falls back to zettel/<filename>.
   */
  async function archive(path: string, targetPath?: string): Promise<string | null> {
    const filename = path.split('/').pop()
    if (!filename) return null
    const finalTarget = targetPath ?? `zettel/${filename}`
    if (finalTarget === path) return null
    try {
      const moved = await patchPost(path, { targetPath: finalTarget })
      const displayFrom = finalTarget.replace(/^zettel\//, '')
      const displayTo = moved.path.replace(/^zettel\//, '').replace(/\.md$/, '')
      const toastMsg = displayFrom === displayTo
        ? '已归档到 zettel'
        : `已归档到 ${moved.path}`
      toast.success(toastMsg)
      return moved.path
    } catch (err: any) {
      toast.error('归档失败: ' + (err.message ?? '未知错误'))
      return null
    }
  }

  return { archive }
}