<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { TreeNode } from '../../lib/api'
import TreeRow from './TreeRow.vue'
import { useConfirm } from '../../composables/useConfirm'
import { usePrompt } from '../../composables/usePrompt'
import { useToast } from '../../composables/useToast'
import { blockedMessage, isInZettel, PROTECTED_ROOTS } from '../../composables/zettelProtocol'
import { createPost, createFolder, patchPost, deletePost, renameFolder, deleteFolder } from '../../lib/api'
import { ICON_SCOPE_INBOX, ICON_SCOPE_LITERATURE, ICON_SCOPE_ZETTEL } from './icons'

// Map each Zettelkasten root to the icon shown in its scope chip.
const SCOPE_ICONS: Record<string, string> = {
  inbox: ICON_SCOPE_INBOX,
  literature: ICON_SCOPE_LITERATURE,
  zettel: ICON_SCOPE_ZETTEL,
}

const props = defineProps<{
  tree: TreeNode[]
  currentPath: string | null
}>()
const emit = defineEmits<{
  select: [path: string]
  refresh: []
}>()

const { confirm } = useConfirm()
const { prompt } = usePrompt()
const toast = useToast()

const STORAGE_KEY = 'docus.vault.expandedPaths'
const SCOPE_KEY = 'docus.vault.activeScope'
const expanded = ref<Set<string>>(new Set(loadExpanded()))

// Optional scope filter (the three Zettelkasten root names). When non-null,
// only that root's subtree is rendered — the other two are hidden. Click the
// same chip again to clear, or click a different one to switch. Persisted
// to localStorage so the view is restored on reload.
const activeScope = ref<string | null>(loadScope())
function loadScope(): string | null {
  try {
    const raw = localStorage.getItem(SCOPE_KEY)
    return raw && PROTECTED_ROOTS.has(raw) ? raw : null
  } catch { return null }
}
function toggleScope(root: string) {
  activeScope.value = activeScope.value === root ? null : root
  try { localStorage.setItem(SCOPE_KEY, activeScope.value ?? '') } catch { /* ignore */ }
}

// The server returns a single implicit root folder ("content", path "") whose
// children are the user's top-level folders. We don't surface that synthetic
// root in the UI — only its children are rendered.
const topLevel = computed<TreeNode[]>(() => {
  const root = props.tree[0]
  if (!root || root.kind !== 'folder') return []
  if (activeScope.value) {
    return root.children.filter((c) => c.path === activeScope.value)
  }
  return root.children
})

// Counts per root for the chip badges. Computed off the unfiltered tree so
// the chips always show real numbers, not "1 / 0 / 0" when scope is active.
const scopeCounts = computed<Record<string, number>>(() => {
  const root = props.tree[0]
  if (!root || root.kind !== 'folder') return {}
  const out: Record<string, number> = {}
  for (const c of root.children) {
    if (PROTECTED_ROOTS.has(c.path)) out[c.path] = countDescendantFiles(c)
  }
  return out
})

function loadExpanded(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === 'string') : []
  } catch { return [] }
}
function saveExpanded() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded.value])) } catch { /* ignore */ }
}

function toggle(path: string) {
  if (expanded.value.has(path)) expanded.value.delete(path)
  else expanded.value.add(path)
  expanded.value = new Set(expanded.value)
  saveExpanded()
}

// Default-expand ancestors of currentPath (skip zettel — it's collapsed by default).
watch(() => props.currentPath, (p) => {
  if (!p) return
  if (isInZettel(p)) return
  const segs = p.split('/')
  const ancestors: string[] = []
  let acc = ''
  for (let i = 0; i < segs.length - 1; i++) {
    acc = acc ? `${acc}/${segs[i]}` : segs[i]
    ancestors.push(acc)
  }
  let changed = false
  for (const a of ancestors) if (!expanded.value.has(a)) { expanded.value.add(a); changed = true }
  if (changed) { expanded.value = new Set(expanded.value); saveExpanded() }
}, { immediate: true })

// --- drag on root (move to content root) ---
const isRootDropTarget = ref(false)
const rootDragDepth = ref(0)
function onRootDragEnter(e: DragEvent) { e.preventDefault(); rootDragDepth.value++; isRootDropTarget.value = true }
function onRootDragLeave() { rootDragDepth.value = Math.max(0, rootDragDepth.value - 1); if (rootDragDepth.value === 0) isRootDropTarget.value = false }
function onRootDragOver(e: DragEvent) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' }
async function onRootDrop(e: DragEvent) {
  e.preventDefault()
  const src = e.dataTransfer?.getData('text/x-docus-path') ?? ''
  isRootDropTarget.value = false
  rootDragDepth.value = 0
  if (!src) return
  // Reject moves of protected roots (the three top-level folders are part
  // of the Zettelkasten protocol and cannot be re-parented) or anything
  // inside the read-only zettel/ subtree.
  {
    const msg = blockedMessage(src, 'move')
    if (msg) { toast.error(msg); return }
  }
  const filename = src.split('/').pop()!
  const targetPath = filename
  if (targetPath === src) return
  try {
    await patchPost(src, { targetPath })
    emit('refresh')
    if (props.currentPath === src) emit('select', targetPath)
    toast.info('已移动到根目录')
  } catch (err: any) {
    toast.error('移动失败: ' + (err.message ?? '未知错误'))
  }
}

// --- helpers ---
// findNode now accepts an optional `kind` filter. The reason: a file and a
// folder can legitimately share the same path string (e.g. `inbox/notes.md`
// and `inbox/notes/` both surface as path='inbox/notes' in the API), and
// buildTree sorts folders first. Without the filter, a path-only lookup
// would always resolve to the folder even when the user right-clicked the
// file — so renaming the file would silently rename the folder, deleting
// the file would attempt to delete the folder, and the move cycle check
// would never fire. Callers in this file pass the kind that was emitted
// from TreeRow alongside the path.
function findNode(nodes: TreeNode[], path: string, kind?: 'file' | 'folder'): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path && (kind === undefined || n.kind === kind)) return n
    if (n.kind === 'folder') {
      const found = findNode(n.children, path, kind)
      if (found) return found
    }
  }
  return null
}
function countDescendants(n: TreeNode): number {
  if (n.kind !== 'folder') return 0
  return n.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0)
}
// File-only descendant count for the scope chips. Folders are organizational
// scaffolding, not content — a chip showing `zettel 12` should read as
// "12 permanent notes", not "12 children including N subfolders". The
// folder-aware countDescendants above stays as-is because onDelete still
// uses it to show "N items will be removed" on folder delete.
function countDescendantFiles(n: TreeNode): number {
  if (n.kind !== 'folder') return 0
  return n.children.reduce(
    (acc, c) => acc + (c.kind === 'file' ? 1 : 0) + countDescendantFiles(c),
    0,
  )
}

// --- row event handlers ---
async function onSelect(p: string) { emit('select', p) }
async function onToggle(p: string) { toggle(p) }

async function onRename(oldPath: string, newName: string, kind: 'file' | 'folder') {
  // Look up the node by *both* path and kind — see findNode for why path
  // alone is ambiguous. A user right-clicking `inbox/notes.md` while the
  // folder `inbox/notes/` also exists must rename the file, not the folder.
  const node = findNode(props.tree, oldPath, kind)
  if (!node) return
  {
    const msg = blockedMessage(oldPath, 'rename')
    if (msg) { toast.error(msg); return }
  }
  try {
    if (node.kind === 'folder') {
      const parent = oldPath.split('/').slice(0, -1).join('/')
      const newPath = parent ? `${parent}/${newName}` : newName
      const res = await renameFolder(oldPath, newPath)
      toast.success(`已重命名 (${res.moved.length} 项)`)
    } else {
      await patchPost(oldPath, { name: newName })
    }
    emit('refresh')
  } catch (e: any) {
    toast.error('重命名失败: ' + e.message)
  }
}

async function onDelete(p: string, kind: 'file' | 'folder') {
  // Same disambiguation as onRename — see findNode. A path-only lookup
  // would resolve a delete on `inbox/notes` to whichever node appears
  // first in the tree (the folder), and the wrong entity would be
  // deleted (or a confirm dialog would be shown for the wrong target).
  const node = findNode(props.tree, p, kind)
  if (!node) return
  {
    const msg = blockedMessage(p, 'delete')
    if (msg) { toast.error(msg); return }
  }
  const count = node.kind === 'folder' ? countDescendants(node) + 1 : 1
  const ok = await confirm(
    node.kind === 'folder'
      ? `删除文件夹 "${node.name}" 及其内 ${count - 1} 项?`
      : `删除 "${node.name}"?`,
  )
  if (!ok) return
  try {
    if (node.kind === 'folder') await deleteFolder(p, true)
    else await deletePost(p)
    emit('refresh')
  } catch (e: any) { toast.error('删除失败: ' + e.message) }
}

async function onMove(srcPath: string, targetFolder: string, srcKind: 'file' | 'folder') {
  {
    const msg = blockedMessage(srcPath, 'move')
    if (msg) { toast.error(msg); return }
  }
  // The three top-level folders keep their names but their *contents* are
  // fully editable. The one place we still refuse to write is zettel, which
  // is the read-only permanent-notes sink. inbox / literature must remain
  // valid drop targets so a file can be promoted out of a sub-folder
  // (e.g. moving inbox/test/foo.md back up to inbox/foo.md).
  if (targetFolder === 'zettel') { toast.error('Zettel 是永久笔记，不能直接写入'); return }
  const filename = srcPath.split('/').pop()!
  const newPath = targetFolder ? `${targetFolder}/${filename}` : filename
  if (newPath === srcPath) return
  // Cycle check — kind-aware lookup. Without the kind filter, dragging a
  // file that shares a name with a folder would never trigger this
  // guard even if the path happened to also be an ancestor of the
  // target, because findNode would return null for the file but the
  // guard only fires when srcNode is a folder. With the kind, the
  // check runs against the actual source entity.
  const srcNode = findNode(props.tree, srcPath, srcKind)
  if (srcNode?.kind === 'folder' && (newPath === srcPath || newPath.startsWith(srcPath + '/'))) {
    toast.error('不能将文件夹移动到自身')
    return
  }
  try {
    await patchPost(srcPath, { targetPath: newPath })
    emit('refresh')
    if (props.currentPath === srcPath) emit('select', newPath)
  } catch (e: any) {
    toast.error('移动失败: ' + (e.message ?? '未知错误'))
  }
}

async function onCreateIn(folder: string, kind: 'file' | 'folder') {
  {
    const msg = blockedMessage(folder, 'create')
    if (msg) { toast.error(msg); return }
  }
  const title = await prompt({
    title: kind === 'file' ? `在 ${folder || 'inbox'} 中新建文件` : `在 ${folder || 'inbox'} 中新建文件夹`,
    placeholder: '名称',
  })
  if (!title) return
  const name = title.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!name) { toast.error('名称无效'); return }
  const path = folder ? `${folder}/${name}` : name
  try {
    if (kind === 'file') await createPost({ path, title: name })
    else await createFolder(path)
    expanded.value.add(folder)
    expanded.value = new Set(expanded.value)
    saveExpanded()
    emit('refresh')
  } catch (e: any) { toast.error('创建失败: ' + e.message) }
}
</script>

<template>
  <aside
    class="file-tree"
    :class="{ 'drop-target-root': isRootDropTarget }"
    @dragenter="onRootDragEnter"
    @dragleave="onRootDragLeave"
    @dragover="onRootDragOver"
    @drop="onRootDrop"
  >
    <header>
      <span class="title">资源管理器</span>
      <div class="scope-chips" role="tablist" aria-label="范围过滤">
        <button
          v-for="root in PROTECTED_ROOTS"
          :key="root"
          class="scope-chip"
          :class="{ active: activeScope === root }"
          :aria-pressed="activeScope === root"
          :aria-label="activeScope === root ? `已过滤为 ${root}（再次点击取消）` : `只看 ${root}`"
          :title="activeScope === root ? `已过滤为 ${root}（再次点击取消）` : `只看 ${root}`"
          @click="toggleScope(root)"
        >
          <span class="scope-chip-icon" v-html="SCOPE_ICONS[root]" />
          <span class="scope-chip-count">{{ scopeCounts[root] ?? 0 }}</span>
        </button>
      </div>
    </header>
    <ul v-if="topLevel.length" class="tree" role="tree">
      <TreeRow
        v-for="node in topLevel"
        :key="node.path"
        :node="node"
        :depth="0"
        :current-path="currentPath"
        :expanded-set="expanded"
        @select="onSelect"
        @toggle="onToggle"
        @rename="onRename"
        @delete="onDelete"
        @move="onMove"
        @create-in="onCreateIn"
      />
    </ul>
    <p v-else class="empty">还没有文件。</p>
  </aside>
</template>
