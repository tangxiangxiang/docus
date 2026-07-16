// The Archive protocol: the three top-level folders (inbox / literature
// / archive) are part of the spec and cannot be renamed / deleted / re-parented.
// The archive/ subtree is structurally protected: archived notes cannot be
// directly created there, but folders may be created and existing archive items
// may be moved inside the subtree to organize them. These rules are pure — no
// state, no async — so a module of exported functions is the right shape (not a
// `useXxx()` factory like useToast/useConfirm).
//
// Before this module the rules lived inline in FileTree.vue and TreeRow.vue,
// with the set `{'inbox','literature','archive'}` duplicated literally across
// both files. Adding a fourth protected root, or changing the user-facing
// messages, used to mean editing three places.

export const PROTECTED_ROOTS: ReadonlySet<string> = new Set(['inbox', 'literature', 'archive'])

/** True for any path inside the protected archive/ subtree.
 *
 * Case-insensitive on purpose: macOS APFS (the default dev filesystem) is
 * case-insensitive, so `Archive/` and `archive/` resolve to the same directory
 * at the OS level. Treating them as the same subtree at the protocol layer
 * means the gates behave identically regardless of which the user typed.
 */
export function isInArchive(path: string | null | undefined): boolean {
  if (!path) return false
  const p = path.toLowerCase()
  return p === 'archive' || p.startsWith('archive/')
}

/** True for the three top-level folders that must keep their names. */
export function isProtectedRoot(path: string | null | undefined): boolean {
  return !!path && PROTECTED_ROOTS.has(path)
}

/**
 * Why a path is structurally locked, or null if it is not. Use this in templates to
 * pick a hint label and to gate write actions:
 *   readonlyReason(node.path) === null     // editable
 *   readonlyReason(node.path) === 'archive' // inside archived notes
 *   readonlyReason(node.path) === 'root'    // a protected top-level folder
 */
export type ReadonlyReason = 'archive' | 'root' | null
export function readonlyReason(path: string | null | undefined): ReadonlyReason {
  if (isInArchive(path)) return 'archive'
  if (isProtectedRoot(path)) return 'root'
  return null
}

// Write-permission matrix — kept as named booleans rather than one
// "readonly" flag because the protocol's two read-only states allow
// different ops:
//   • protected root (inbox/literature/archive) — names are pinned, but
//     children are still user content. create-in is allowed, rename /
//     delete / drag-out are not.
//   • archive subtree (archive and anything below) — archived-notes area.
//     Existing items cannot be renamed / deleted, and new notes cannot be
//     directly created there. Moves are allowed inside archive so users can
//     reorganize archived notes without flattening the whole tree.
// Templates and TreeRow use these to gate individual menu items and the
// draggable attribute. Keep these in sync with `blockedMessage`: any new
// op added there needs a corresponding canX below.
/** True for paths whose name/content entry can be renamed or deleted. */
export function canModify(path: string | null | undefined): boolean {
  return readonlyReason(path) === null
}

/** True for paths that can be dragged/re-parented. */
export function canMove(path: string | null | undefined): boolean {
  if (!path) return false
  if (isProtectedRoot(path)) return false
  return true
}
/** True for folders that may receive directly created notes.
 *
 * Folder creation (organizational subfolders inside archive) is always
 * allowed for any folder — see TreeRow.vue's context menu, which renders
 * "新建文件夹" unconditionally on isFolder rows. The split between file
 * and folder creation lives here so callers can gate the two buttons
 * independently without re-implementing the archive subtree check.
 */
export function canCreateFileChild(path: string | null | undefined): boolean {
  // Archived notes should enter archive through explicit archive/move flows,
  // not ad-hoc file creation from the tree menu. Protected roots
  // (inbox/literature) keep their own names but accept new children.
  return !isInArchive(path)
}

/**
 * User-facing error message for a blocked write op on `path`, or null if the
 * op is allowed. Callers do `if (msg) { toast.error(msg); return }` — this
 * shape matches the actual usage pattern (no caller needs a structured
 * `reason` separately; the op is either allowed or it isn't).
 *
 * The five ops match the buttons in the context menu: rename / delete /
 * move / create-file / create-folder. The 'move' op is for the *source*
 * path of a move. The target-side checks (for example, keeping archive notes
 * inside archive) are handled inline at the call site because they need
 * both source and target.
 */
export function blockedMessage(
  path: string | null | undefined,
  op: 'rename' | 'delete' | 'move' | 'create-file' | 'create-folder',
  t: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  if (isProtectedRoot(path)) {
    const label = path!
    if (op === 'rename') return t('file_tree.protected_rename', { path: label })
    if (op === 'delete') return t('file_tree.protected_delete', { path: label })
    if (op === 'move')   return t('file_tree.protected_move', { path: label })
    // create-file / create-folder on a protected root aren't blocked —
    // you can put files into inbox / literature. Only the create-into-archive
    // path is blocked, and that's the same as `isInArchive(path)` below.
  }
  if (isInArchive(path)) {
    if (op === 'rename') return t('file_tree.archive_rename')
    if (op === 'delete') return t('file_tree.archive_delete')
    if (op === 'move')   return null
    if (op === 'create-file') return t('file_tree.archive_create')
    if (op === 'create-folder') return null
  }
  return null
}
