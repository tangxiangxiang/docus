// The Zettelkasten protocol: the three top-level folders (inbox / literature
// / zettel) are part of the spec and cannot be renamed / deleted / re-parented,
// and the entire zettel/ subtree is a read-only permanent-notes sink. These
// rules are pure — no state, no async — so a module of exported functions is
// the right shape (not a `useXxx()` factory like useToast/useConfirm).
//
// Before this module the rules lived inline in FileTree.vue and TreeRow.vue,
// with the set `{'inbox','literature','zettel'}` duplicated literally across
// both files. Adding a fourth protected root, or changing the user-facing
// messages, used to mean editing three places.

export const PROTECTED_ROOTS: ReadonlySet<string> = new Set(['inbox', 'literature', 'zettel'])

/** True for any path inside the read-only zettel/ subtree. */
export function isInZettel(path: string | null | undefined): boolean {
  if (!path) return false
  return path === 'zettel' || path.startsWith('zettel/')
}

/** True for the three top-level folders that must keep their names. */
export function isProtectedRoot(path: string | null | undefined): boolean {
  return !!path && PROTECTED_ROOTS.has(path)
}

/**
 * Why a path is read-only, or null if it is not. Use this in templates to
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

/** Hint text shown in the context menu when a row is read-only. */
export function readonlyHintLabel(path: string | null | undefined): string {
  return readonlyReason(path) === 'zettel' ? 'Zettel · 永久笔记' : '顶层目录 · 不可修改'
}

/**
 * User-facing error message for a blocked write op on `path`, or null if the
 * op is allowed. Callers do `if (msg) { toast.error(msg); return }` — this
 * shape matches the actual usage pattern (no caller needs a structured
 * `reason` separately; the op is either allowed or it isn't).
 *
 * The four ops match the four buttons in the context menu: rename / delete
 * / move / create-in. The 'move' op is for the *source* path of a move (we
 * block moves that originate from a protected or zettel path). The
 * *target-side* check (cannot drop into `zettel` itself) is handled inline
 * at the call site — its message is a one-off.
 */
export function blockedMessage(
  path: string | null | undefined,
  op: 'rename' | 'delete' | 'move' | 'create',
): string | null {
  if (isProtectedRoot(path)) {
    const label = path!
    if (op === 'rename') return `${label} 是固定目录，不能重命名`
    if (op === 'delete') return `${label} 是固定目录，不能删除`
    if (op === 'move')   return `${label} 是固定目录，不能移动`
    // 'create' on a protected root isn't blocked — you can put files into
    // inbox / literature. Only the create-into-zettel path is blocked, and
    // that's the same as `isInZettel(path)`.
  }
  if (isInZettel(path)) {
    if (op === 'rename') return 'Zettel 是永久笔记，不能重命名'
    if (op === 'delete') return 'Zettel 是永久笔记，不能删除'
    if (op === 'move')   return 'Zettel 是永久笔记，不能移动'
    if (op === 'create') return 'Zettel 是永久笔记，不能直接新建'
  }
  return null
}
