<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import type { TreeNode, PostSummary } from '../../lib/api'
import TreeRow from './TreeRow.vue'
import { useConfirm } from '../../composables/useConfirm'
import { usePrompt } from '../../composables/usePrompt'
import { useToast } from '../../composables/useToast'
import { blockedMessage, isInArchive } from '../../composables/archiveProtocol'
import { createPost, createFolder, patchPost, deletePost, renameFolder, deleteFolder, getRenameImpact } from '../../lib/api'
import { suggestSlug } from '../../lib/ai-api'
import { isSlugSegment, toLocalSlug } from '../../lib/slug'
import { useScopeFilter } from '../../composables/vault/useScopeFilter'
import { useArchiveNote } from '../../composables/vault/useArchiveNote'
import { getFallbackVaultFileChanges } from '../../composables/vault/context/fileChanges'
import { useOptionalVaultContext } from '../../composables/vault/context/useVaultContext'
import { ICON_SEARCH } from './icons'
import { useI18n } from '../../composables/useI18n'
import { useFileTreePreferences } from '../../composables/vault/useFileTreePreferences'

const props = withDefaults(defineProps<{
  tree: TreeNode[]
  posts?: PostSummary[]
  currentPath: string | null
}>(), {
  posts: () => [],
})
const emit = defineEmits<{
  select: [path: string]
  refresh: []
  // archive-note is self-contained inside FileTree: handler calls
  // patchPost + emit('refresh') + (optionally) emit('select'). VaultView
  // doesn't need to know. Distinct from `move` because move-into-archive
  // remains blocked by onMove — archive is a deliberate menu action that
  // bypasses that block.
  'archive-note': [path: string]
  'open-properties': [path: string]
}>()

const { confirm } = useConfirm()
const { prompt } = usePrompt()
const { archive: archiveNote } = useArchiveNote()
const toast = useToast()
const { t } = useI18n()
const { compactFileTree } = useFileTreePreferences()
const vaultContext = useOptionalVaultContext()
const publishChange = vaultContext?.fileChanges.publish ?? getFallbackVaultFileChanges().publish
const searchInputRef = ref<HTMLInputElement | null>(null)

const STORAGE_KEY = 'docus.vault.expandedPaths'
const expanded = ref<Set<string>>(new Set(loadExpanded()))

// Scope filter is owned by useScopeFilter (shared with the NavBar that
// renders the chips). We only read activeScope here — the filter is
// applied to topLevel below, and the chips live in the NavBar.
const { activeScope } = useScopeFilter()

async function suggestEnglishSlug(input: string, kind: 'file' | 'folder'): Promise<string> {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const local = toLocalSlug(trimmed)
  if (local && /^[\x00-\x7F]+$/.test(trimmed)) return local
  try {
    const out = await suggestSlug({ input: trimmed, kind })
    return out.slug
  } catch (e: any) {
    if (local) return local
    toast.error('AI 文件名生成失败: ' + (e.message ?? '未知错误'))
    return trimmed
  }
}

// The server returns a single implicit root folder ("content", path "") whose
// children are the user's top-level folders. We don't surface that synthetic
// root in the UI — only its children are rendered.
const topLevel = computed<TreeNode[]>(() => {
  const root = props.tree[0]
  if (!root || root.kind !== 'folder') return []
  let children = root.children
  if (activeScope.value) {
    children = children.filter((c) => c.path === activeScope.value)
  }
  // Rebuild the subtree so non-matching files are hidden while matching
  // ancestors remain visible. A matching folder keeps its complete subtree.
  if (filterTokens.value.length > 0) {
    children = children
      .map((c) => filterByQuery(c, filterTokens.value))
      .filter((n): n is TreeNode => n !== null)
  }
  return children
})
// Post metadata is used by TreeRow for secondary file information.
const postMetadataByPath = computed<Map<string, PostSummary>>(() =>
  new Map(props.posts.map((post) => [post.path, post])),
)

// Only ambiguous display titles pay the cost of an always-visible path hint.
// Count across the complete tree, not the filtered result, so a search/filter
// cannot make an otherwise ambiguous title suddenly look unique.
const duplicateTitles = computed<Set<string>>(() => {
  const counts = new Map<string, number>()
  const walk = (node: TreeNode) => {
    if (node.kind === 'file') {
      const title = (node.title.trim() || node.name).toLocaleLowerCase()
      counts.set(title, (counts.get(title) ?? 0) + 1)
    } else node.children.forEach(walk)
  }
  props.tree.forEach(walk)
  return new Set([...counts].filter(([, count]) => count > 1).map(([title]) => title))
})

// Files filter state is local to FileTree, so it survives view switches as
// long as the component remains mounted.
const contentText = ref('')

const effectiveQuery = computed(() => contentText.value.trim())
const filterTokens = computed(() =>
  effectiveQuery.value
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean),
)

function filterByQuery(node: TreeNode, tokens: string[]): TreeNode | null {
  if (node.kind === 'file') {
    const hay = `${node.path}\n${node.title}`.toLocaleLowerCase()
    return tokens.every((token) => hay.includes(token)) ? node : null
  }
  // Matching a folder path keeps its complete subtree, which makes folder
  // filtering behave like quick navigation rather than a file-only search.
  if (tokens.every((needle) => node.path.toLocaleLowerCase().includes(needle))) {
    return node
  }
  const kids = node.children
    .map((c) => filterByQuery(c, tokens))
    .filter((n): n is TreeNode => n !== null)
  if (kids.length === 0) return null
  return { ...node, children: kids }
}

// Per-file match annotation, derived by re-walking the already-filtered
// tree. Each token is assigned to its first matching field in this order:
// title, filename, directory path. Folder matches are not annotated — a
// folder kept because the user typed its name is a scope expansion,
// not a "match", and adding a tooltip there would be noise. The
// derived map is empty when the query is empty, so TreeRow's
// `matchInfo?` prop stays unset and Vue strips the `title` attribute
// entirely.
export interface MatchInfo {
  name?: boolean
  path?: boolean
  title?: boolean
}
const matchedFields = computed<Map<string, MatchInfo>>(() => {
  if (filterTokens.value.length === 0) return new Map()
  const m = new Map<string, MatchInfo>()
  const walk = (node: TreeNode) => {
    if (node.kind !== 'file') {
      for (const c of node.children) walk(c)
      return
    }
    const info: MatchInfo = {}
    const nameLc = node.name.toLocaleLowerCase()
    const titleLc = node.title.toLocaleLowerCase()
    const directoryLc = node.path.split('/').slice(0, -1).join('/').toLocaleLowerCase()
    for (const needle of filterTokens.value) {
      if (titleLc.includes(needle)) info.title = true
      else if (nameLc.includes(needle)) info.name = true
      else if (directoryLc.includes(needle)) info.path = true
    }
    if (info.path || info.name || info.title) m.set(node.path, info)
  }
  for (const n of topLevel.value) walk(n)
  return m
})

// When a search is active, force every folder in the *filtered* tree to
// be expanded so the user sees the matches without clicking through.
// We don't write to `expanded` itself — that set is persisted to
// localStorage and represents the user's deliberate collapse state. The
// search-time override is layered on top via `effectiveExpanded`, and
// disappears the moment the query clears, restoring the saved layout.
const searchForcedExpanded = computed<Set<string> | null>(() => {
  if (!effectiveQuery.value) return null
  const set = new Set<string>()
  const walk = (n: TreeNode) => {
    if (n.kind !== 'folder') return
    set.add(n.path)
    for (const c of n.children) walk(c)
  }
  for (const n of topLevel.value) walk(n)
  return set
})
const effectiveExpanded = computed<Set<string>>(() => {
  const base = expanded.value
  const over = searchForcedExpanded.value
  if (!over) return base
  const u = new Set(base)
  for (const p of over) u.add(p)
  return u
})

type VisibleTreeItem = { node: TreeNode; parentKey: string | null }
const visibleItems = computed<VisibleTreeItem[]>(() => {
  const items: VisibleTreeItem[] = []
  const walk = (nodes: TreeNode[], parentKey: string | null) => {
    for (const node of nodes) {
      items.push({ node, parentKey })
      if (node.kind === 'folder' && effectiveExpanded.value.has(node.path)) {
        walk(node.children, nodeKey(node))
      }
    }
  }
  walk(topLevel.value, null)
  return items
})
const focusedNodeKey = ref<string | null>(null)

function nodeKey(node: Pick<TreeNode, 'kind' | 'path'>): string {
  return `${node.kind}:${node.path}`
}

function setFocused(path: string, kind: 'file' | 'folder', focusDom = false) {
  focusedNodeKey.value = `${kind}:${path}`
  if (focusDom) {
    nextTick(() => {
      const rows = document.querySelectorAll<HTMLElement>('.file-tree [data-tree-key]')
      Array.from(rows).find((row) => row.dataset.treeKey === focusedNodeKey.value)?.focus()
    })
  }
}

function onTreeKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    searchInputRef.value?.focus()
    return
  }
  const index = visibleItems.value.findIndex(({ node }) => nodeKey(node) === focusedNodeKey.value)
  if (index < 0) return
  const item = visibleItems.value[index]
  const node = item.node
  let target: VisibleTreeItem | undefined
  if (e.key === 'ArrowDown') target = visibleItems.value[index + 1]
  else if (e.key === 'ArrowUp') target = visibleItems.value[index - 1]
  else if (e.key === 'ArrowRight' && node.kind === 'folder') {
    if (!effectiveExpanded.value.has(node.path)) toggle(node.path)
    else target = visibleItems.value[index + 1]
  } else if (e.key === 'ArrowLeft') {
    if (node.kind === 'folder' && effectiveExpanded.value.has(node.path)) toggle(node.path)
    else if (item.parentKey) target = visibleItems.value.find(({ node: candidate }) => nodeKey(candidate) === item.parentKey)
  } else if (e.key === 'Enter') {
    if (node.kind === 'folder') toggle(node.path)
    else emit('select', node.path)
  } else if (e.key === 'F2') {
    void onRequestRename(node.path, node.kind)
  } else if (e.key === 'Delete') {
    void onDelete(node.path, node.kind)
  } else return
  e.preventDefault()
  e.stopPropagation()
  if (target) setFocused(target.node.path, target.node.kind, true)
}

watch([visibleItems, () => props.currentPath], ([items, currentPath]) => {
  if (focusedNodeKey.value && items.some(({ node }) => nodeKey(node) === focusedNodeKey.value)) return
  const current = items.find(({ node }) => node.kind === 'file' && node.path === currentPath)
  const fallback = current ?? items[0]
  focusedNodeKey.value = fallback ? nodeKey(fallback.node) : null
}, { immediate: true })

function clearContentText() {
  contentText.value = ''
}

function onQueryKeydown(e: KeyboardEvent) {
  // Esc inside the filter clears it but does not propagate, so
  // the vault's global Esc handler (which closes panels / tabs)
  // doesn't fire on the same keypress. Mirrors the same escape on
  // TagPanel's tag-filter input.
  if (e.key === 'Escape' && contentText.value) {
    e.stopPropagation()
    contentText.value = ''
  }
}

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

// Default-expand ancestors of currentPath. Archive can now contain
// classification folders, so the active archived note should be revealed too.
watch(() => props.currentPath, (p) => {
  if (!p) return
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
  // of the vault protocol and cannot be re-parented). Archive children
  // are handled below because they may move inside archive but not out of it.
  {
    const msg = blockedMessage(src, 'move')
    if (msg) { toast.error(msg); return }
  }
  if (isInArchive(src)) { toast.error('Archive 笔记只能在 archive 内移动'); return }
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

// --- row event handlers ---
async function onSelect(p: string) { emit('select', p) }
async function onToggle(p: string) { toggle(p) }

async function onRename(oldPath: string, newName: string, kind: 'file' | 'folder') {
  const safeName = toLocalSlug(newName) || newName.trim()
  // Look up the node by *both* path and kind — see findNode for why path
  // alone is ambiguous. A user right-clicking `inbox/notes.md` while the
  // folder `inbox/notes/` also exists must rename the file, not the folder.
  const node = findNode(props.tree, oldPath, kind)
  if (!node) return
  {
    const msg = blockedMessage(oldPath, 'rename')
    if (msg) { toast.error(msg); return }
  }
  if (!isSlugSegment(safeName)) {
    toast.error('名称只能使用小写英文、数字和连字符')
    return
  }
  try {
    if (node.kind === 'folder') {
      const parent = oldPath.split('/').slice(0, -1).join('/')
      const newPath = parent ? `${parent}/${safeName}` : safeName
      let updateReferences = false
      try {
        const impact = await getRenameImpact(oldPath, true)
        updateReferences = impact.count > 0
          ? await confirm(`有 ${impact.count} 篇文档引用此文件夹中的笔记。是否同时更新这些引用？\n\n取消将仅重命名文件夹。`)
          : false
      } catch { /* advisory */ }
      const res = updateReferences
        ? await renameFolder(oldPath, newPath, true)
        : await renameFolder(oldPath, newPath)
      for (const updated of res.updatedReferences ?? []) {
        publishChange({ path: updated.path, kind: 'write', newRaw: updated.raw })
      }
      toast.success(`已重命名 (${res.moved.length} 项)`)
    } else {
      let updateReferences = false
      try {
        const impact = await getRenameImpact(oldPath)
        updateReferences = impact.count > 0
          ? await confirm(`有 ${impact.count} 篇文档引用此笔记。是否同时更新这些引用？\n\n取消将仅重命名文件。`)
          : false
      } catch { /* impact preview is advisory; renaming still works */ }
      const renamed = await patchPost(oldPath, updateReferences ? { name: safeName, updateReferences: true } : { name: safeName })
      for (const updated of renamed.updatedReferences ?? []) {
        if (updated.path !== renamed.path) publishChange({ path: updated.path, kind: 'write', newRaw: updated.raw })
      }
    }
    emit('refresh')
  } catch (e: any) {
    toast.error('重命名失败: ' + e.message)
  }
}

async function onRequestRename(oldPath: string, kind: 'file' | 'folder') {
  const node = findNode(props.tree, oldPath, kind)
  if (!node) return
  {
    const msg = blockedMessage(oldPath, 'rename')
    if (msg) { toast.error(msg); return }
  }
  const title = await prompt({
    title: kind === 'file' ? `重命名文件 ${node.name}` : `重命名文件夹 ${node.name}`,
    placeholder: '中文标题或英文路径名',
    initial: node.name,
    actionLabel: '✧',
    actionTitle: '翻译为英文路径名',
    transform: async (value) => suggestEnglishSlug(value, kind),
  })
  if (!title) return
  await onRename(oldPath, title, kind)
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
  // The three top-level folders keep their names but their contents are
  // editable according to the protocol. Dropping a non-archive note directly
  // on archive/ is still too vague, so the explicit archive action owns that
  // path. Existing archive items may move within archive for reclassification,
  // but not out into inbox/literature/root.
  const sourceInArchive = isInArchive(srcPath)
  const targetInArchive = isInArchive(targetFolder)
  if (!sourceInArchive && targetFolder === 'archive') { toast.error('Archive 是已归档笔记，不能直接写入'); return }
  if (sourceInArchive && !targetInArchive) { toast.error('Archive 笔记只能在 archive 内移动'); return }
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

// Archive handler. Distinct from onMove: this is the explicit product action
// of archiving a finished note from inbox/ or literature/ straight into the
// archive/ root. Classified archiving can also happen by dragging an eligible
// inbox/literature note onto an archive subfolder; the server whitelist's
// "source must be in inbox/ or literature/" check backs up both paths.
async function onArchiveNote(path: string) {
  const movedPath = await archiveNote(path)
  if (!movedPath) return
  emit('refresh')
  if (props.currentPath === path) emit('select', movedPath)
}

async function onCreateIn(folder: string, kind: 'file' | 'folder') {
  {
    const msg = blockedMessage(folder, kind === 'file' ? 'create-file' : 'create-folder')
    if (msg) { toast.error(msg); return }
  }
  let sourceTitle = ''
  const title = await prompt({
    title: kind === 'file' ? `在 ${folder || 'inbox'} 中新建文件` : `在 ${folder || 'inbox'} 中新建文件夹`,
    placeholder: '中文标题或英文路径名',
    actionLabel: '✧',
    actionTitle: '翻译为英文路径名',
    transform: async (value) => {
      sourceTitle = value.trim()
      return suggestEnglishSlug(value, kind)
    },
  })
  if (!title) return
  const name = toLocalSlug(title)
  if (!name || !isSlugSegment(name)) {
    toast.error('名称只能使用小写英文、数字和连字符')
    return
  }
  const path = folder ? `${folder}/${name}` : name
  try {
    if (kind === 'file') await createPost({ path, title: sourceTitle || title })
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
    :aria-label="t('file_tree.label')"
    :class="{ 'drop-target-root': isRootDropTarget }"
    @dragenter="onRootDragEnter"
    @dragleave="onRootDragLeave"
    @dragover="onRootDragOver"
    @drop="onRootDrop"
    @keydown="onTreeKeydown"
  >
    <header>
      <!-- Filters by title, filename, and directory path. Matching is
           case-insensitive and multiple tokens compose with AND.
      -->
      <div class="search">
        <span class="search-icon" v-html="ICON_SEARCH" aria-hidden="true" />
        <input
          ref="searchInputRef"
          v-model="contentText"
          class="search-input"
          type="text"
          :placeholder="t('file_tree.search')"
          :aria-label="t('file_tree.search')"
          @keydown="onQueryKeydown"
        />
        <button
          v-if="contentText"
          class="search-clear-x"
          :title="t('file_tree.clear_search')"
          :aria-label="t('file_tree.clear_search')"
          @click="clearContentText"
        >×</button>
      </div>
    </header>
    <ul v-if="topLevel.length" class="tree" role="tree">
      <TreeRow
        v-for="node in topLevel"
        :key="node.path"
        :node="node"
        :depth="0"
        :current-path="currentPath"
        :focused-node-key="focusedNodeKey"
        :expanded-set="effectiveExpanded"
        :matched-fields="matchedFields"
        :search-active="Boolean(effectiveQuery)"
        :compact="compactFileTree"
        :duplicate-titles="duplicateTitles"
        :metadata-by-path="postMetadataByPath"
        @select="onSelect"
        @toggle="onToggle"
        @rename="onRename"
        @request-rename="onRequestRename"
        @delete="onDelete"
        @move="onMove"
        @create-in="onCreateIn"
        @archive-note="onArchiveNote"
        @open-properties="(path) => emit('open-properties', path)"
        @focus="setFocused"
      />
    </ul>
    <p v-else-if="effectiveQuery" class="empty">{{ t('file_tree.no_query_match', { query: effectiveQuery }) }}</p>
    <p v-else class="empty">{{ t('file_tree.empty') }}</p>
  </aside>
</template>
