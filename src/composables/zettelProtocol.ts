// The Zettelkasten protocol: the three top-level folders (inbox / literature
// / zettel) are part of the spec and cannot be renamed / deleted / re-parented.
// The zettel/ subtree is structurally protected: permanent notes cannot be
// directly created there, but folders may be created and existing zettel items
// may be moved inside the subtree to organize them. These rules are pure — no
// state, no async — so a module of exported functions is the right shape (not a
// `useXxx()` factory like useToast/useConfirm).
//
// Before this module the rules lived inline in FileTree.vue and TreeRow.vue,
// with the set `{'inbox','literature','zettel'}` duplicated literally across
// both files. Adding a fourth protected root, or changing the user-facing
// messages, used to mean editing three places.

export const PROTECTED_ROOTS: ReadonlySet<string> = new Set(['inbox', 'literature', 'zettel'])

/** True for any path inside the protected zettel/ subtree.
 *
 * Case-insensitive on purpose: macOS APFS (the default dev filesystem) is
 * case-insensitive, so `Zettel/` and `zettel/` resolve to the same directory
 * at the OS level. Treating them as the same subtree at the protocol layer
 * means the gates behave identically regardless of which the user typed.
 */
export function isInZettel(path: string | null | undefined): boolean {
  if (!path) return false
  const p = path.toLowerCase()
  return p === 'zettel' || p.startsWith('zettel/')
}

/** True for the three top-level folders that must keep their names. */
export function isProtectedRoot(path: string | null | undefined): boolean {
  return !!path && PROTECTED_ROOTS.has(path)
}

/**
 * Why a path is structurally locked, or null if it is not. Use this in templates to
 * pick a hint label and to gate write actions:
 *   readonlyReason(node.path) === null  // editable
 *   readonlyReason(node.path) === 'zettel'  // inside permanent notes
 *   readonlyReason(node.path) === 'root'    // a protected top-level folder
 */
export type ReadonlyReason = 'zettel' | 'root' | null
export function readonlyReason(path: string | null | undefined): ReadonlyReason {
  if (isInZettel(path)) return 'zettel'
  if (isProtectedRoot(path)) return 'root'
  return null
}

// Write-permission matrix — kept as named booleans rather than one
// "readonly" flag because the protocol's two read-only states allow
// different ops:
//   • protected root (inbox/literature/zettel) — names are pinned, but
//     children are still user content. create-in is allowed, rename /
//     delete / drag-out are not.
//   • zettel subtree (zettel and anything below) — permanent-notes area.
//     Existing items cannot be renamed / deleted, and new notes cannot be
//     directly created there. Moves are allowed inside zettel so users can
//     reorganize permanent notes without flattening the whole tree.
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
 * Folder creation (organizational subfolders inside zettel) is always
 * allowed for any folder — see TreeRow.vue's context menu, which renders
 * "新建文件夹" unconditionally on isFolder rows. The split between file
 * and folder creation lives here so callers can gate the two buttons
 * independently without re-implementing the zettel subtree check.
 */
export function canCreateFileChild(path: string | null | undefined): boolean {
  // Permanent notes should enter zettel through archive/draft flows, not
  // ad-hoc file creation from the tree menu. Protected roots
  // (inbox/literature) keep their own names but accept new children.
  return !isInZettel(path)
}

/**
 * User-facing error message for a blocked write op on `path`, or null if the
 * op is allowed. Callers do `if (msg) { toast.error(msg); return }` — this
 * shape matches the actual usage pattern (no caller needs a structured
 * `reason` separately; the op is either allowed or it isn't).
 *
 * The five ops match the buttons in the context menu: rename / delete /
 * move / create-file / create-folder. The 'move' op is for the *source*
 * path of a move. The target-side checks (for example, keeping zettel notes
 * inside zettel) are handled inline at the call site because they need
 * both source and target.
 */
export function blockedMessage(
  path: string | null | undefined,
  op: 'rename' | 'delete' | 'move' | 'create-file' | 'create-folder',
): string | null {
  if (isProtectedRoot(path)) {
    const label = path!
    if (op === 'rename') return `${label} 是固定目录，不能重命名`
    if (op === 'delete') return `${label} 是固定目录，不能删除`
    if (op === 'move')   return `${label} 是固定目录，不能移动`
    // create-file / create-folder on a protected root aren't blocked —
    // you can put files into inbox / literature. Only the create-into-zettel
    // path is blocked, and that's the same as `isInZettel(path)` below.
  }
  if (isInZettel(path)) {
    if (op === 'rename') return 'Zettel 是永久笔记，不能重命名'
    if (op === 'delete') return 'Zettel 是永久笔记，不能删除'
    if (op === 'move')   return null
    if (op === 'create-file') return 'Zettel 是永久笔记，不能直接新建笔记'
    if (op === 'create-folder') return null
  }
  return null
}
