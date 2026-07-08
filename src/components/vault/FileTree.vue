<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { TreeNode, PostSummary } from '../../lib/api'
import TreeRow from './TreeRow.vue'
import { useConfirm } from '../../composables/useConfirm'
import { usePrompt } from '../../composables/usePrompt'
import { useToast } from '../../composables/useToast'
import { blockedMessage, isInZettel } from '../../composables/zettelProtocol'
import { createPost, createFolder, patchPost, deletePost, renameFolder, deleteFolder } from '../../lib/api'
import { suggestSlug } from '../../lib/ai-api'
import { isSlugSegment, toLocalSlug } from '../../lib/slug'
import { useScopeFilter } from '../../composables/vault/useScopeFilter'
import { ICON_SEARCH } from './icons'

const props = withDefaults(defineProps<{
  tree: TreeNode[]
  posts?: PostSummary[]
  activeTags?: string[]
  currentPath: string | null
}>(), {
  posts: () => [],
  activeTags: () => [],
})
const emit = defineEmits<{
  select: [path: string]
  refresh: []
  'remove-tag': [tag: string]
  'split-card': [path: string, mode: 'inbox' | 'literature']
  // archive-to-zettel is self-contained inside FileTree: handler calls
  // patchPost + emit('refresh') + (optionally) emit('select'). VaultView
  // doesn't need to know. Distinct from `move` because move-into-zettel
  // remains blocked by onMove — archive is a deliberate menu action that
  // bypasses that block.
  'archive-to-zettel': [path: string]
}>()

const { confirm } = useConfirm()
const { prompt } = usePrompt()
const toast = useToast()

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
  // Tag filter is OR: a file passes if it has at least one of the active
  // tags. We rebuild the subtree so non-matching files are hidden but
  // matching parents stay visible (so the user can navigate to the file).
  if (tagFilterSet.value.size) {
    children = children
      .map((c) => filterByTags(c, tagFilterSet.value))
      .filter((n): n is TreeNode => n !== null)
  }
  // Free-text query is AND-composed with the tag filter — both must pass.
  // filterByQuery is a no-op when the query is empty, so the cost on the
  // unfiltered path is one tree walk that returns nodes unchanged.
  if (effectiveQuery.value) {
    children = children
      .map((c) => filterByQuery(c, effectiveQuery.value))
      .filter((n): n is TreeNode => n !== null)
  }
  return children
})
// Path -> tags lookup so the tree filter can run in O(n) without scanning
// props.posts for every file node. Recomputed when posts or the active
// tag set changes.
const postsByPath = computed<Map<string, Set<string>>>(() => {
  const m = new Map<string, Set<string>>()
  for (const p of props.posts) m.set(p.path, new Set(p.tags))
  return m
})
const tagFilterSet = computed<Set<string>>(() => new Set(props.activeTags))

// Returns the node unchanged if it has no files (folder) but contains any
// matching descendant, the file itself if it matches, or null when the
// whole subtree is irrelevant under the active tag filter.
function filterByTags(node: TreeNode, tags: Set<string>): TreeNode | null {
  if (node.kind === 'file') {
    const t = postsByPath.value.get(node.path)
    return t && [...tags].some((tag) => t.has(tag)) ? node : null
  }
  const kids = node.children
    .map((c) => filterByTags(c, tags))
    .filter((n): n is TreeNode => n !== null)
  if (kids.length === 0) return null
  return { ...node, children: kids }
}

// Free-text search query, split into typed tag chips + content text.
// The two pieces render differently in the header:
//   - `tagTokens` shows up as #tag chip pills (same visual as the
//     activeTags chips that come from clicking a tag in TagPanel)
//   - `contentText` is what stays in the native <input>
// Both feed `effectiveQuery` (joined with a space) which the parser
// splits back into tag/content tokens for filterByQuery. Empty input
// + empty tagTokens = no filter. Composes AND with the tag filter
// above: a file passes only if the activeTag set, the typed tag
// tokens, AND the content tokens all let it through.
//
// Token extraction happens in `onContentInput`: any `#name` followed
// by whitespace OR end-of-input becomes a chip immediately. The
// end-of-input case means typing `#meta` alone (no trailing space)
// still chips — matches the user's mental model of "I typed a tag,
// that should be a chip now".
const contentText = ref('')
const tagTokens = ref<string[]>([])

const effectiveQuery = computed(() => {
  const parts: string[] = []
  for (const t of tagTokens.value) parts.push('#' + t)
  const ct = contentText.value.trim()
  if (ct) parts.push(ct)
  return parts.join(' ')
})

// Summary join. Title already lives on TreeNode (file variant); summary
// does not — it's only on PostSummary. We index by path so the filter
// below can look it up in O(1) per file instead of scanning props.posts
// at every node.
const summaryByPath = computed<Map<string, string>>(() => {
  const m = new Map<string, string>()
  for (const p of props.posts) m.set(p.path, p.summary ?? '')
  return m
})

function filterByQuery(node: TreeNode, q: string): TreeNode | null {
  const parsed = parseQuery(q)
  if (parsed.tagTokens.length === 0 && parsed.contentTokens.length === 0) return node
  if (node.kind === 'file') {
    const summary = summaryByPath.value.get(node.path) ?? ''
    const tags = postsByPath.value.get(node.path) ?? new Set<string>()
    // AND across all tokens; OR within a tag token's matches (a file
    // passes if any of its tags contains the needle as a substring).
    const tagOk = parsed.tagTokens.every((needle) =>
      [...tags].some((tag) => tag.toLowerCase().includes(needle)),
    )
    if (!tagOk) return null
    const contentOk = parsed.contentTokens.every((needle) => {
      const hay = `${node.name}\n${node.title}\n${summary}`.toLowerCase()
      return hay.includes(needle)
    })
    if (!contentOk) return null
    return node
  }
  // Folder: a folder can satisfy content tokens via its own name
  // (typing "zettel" → entire zettel subtree kept), but tag tokens
  // can only match file-level data, so they always recurse. Keeping
  // any content token matching the folder's own name is enough; the
  // AND with tag tokens happens during the descendant walk.
  if (parsed.contentTokens.some((needle) => node.name.toLowerCase().includes(needle))) {
    return node
  }
  const kids = node.children
    .map((c) => filterByQuery(c, q))
    .filter((n): n is TreeNode => n !== null)
  if (kids.length === 0) return null
  return { ...node, children: kids }
}

// Parse a free-text query into two token lists. Tokens starting with
// `#` are tag tokens (the `#` is stripped, rest lowercased); the rest
// are content tokens matched against filename / title / summary. Empty
// tokens (just `#` or whitespace) are dropped. All tokens AND with
// each other; within a tag token, any of the file's tags containing
// the needle as a substring passes (consistent with TagPanel's
// tag-list filter, which also uses substring).
interface ParsedQuery {
  tagTokens: string[]
  contentTokens: string[]
}
function parseQuery(q: string): ParsedQuery {
  const tokens = q.trim().split(/\s+/).filter(Boolean)
  const tagTokens: string[] = []
  const contentTokens: string[] = []
  for (const t of tokens) {
    if (t.startsWith('#')) {
      const tag = t.slice(1).toLowerCase()
      if (tag) tagTokens.push(tag)
    } else {
      contentTokens.push(t.toLowerCase())
    }
  }
  return { tagTokens, contentTokens }
}

// Per-file match annotation, derived by re-walking the already-filtered
// tree. Each entry names the fields whose text contained the query, so
// TreeRow can render a native tooltip like "Matched in: filename,
// summary". Tag matches are reported as `tag: true` and rendered as
// "tags" in the tooltip. Folder-name matches are NOT annotated — a
// folder kept because the user typed its name is a scope expansion,
// not a "match", and adding a tooltip there would be noise. The
// derived map is empty when the query is empty, so TreeRow's
// `matchInfo?` prop stays unset and Vue strips the `title` attribute
// entirely.
export interface MatchInfo {
  name?: boolean
  title?: boolean
  summary?: boolean
  tag?: boolean
}
const matchedFields = computed<Map<string, MatchInfo>>(() => {
  const parsed = parseQuery(effectiveQuery.value)
  if (parsed.tagTokens.length === 0 && parsed.contentTokens.length === 0) return new Map()
  const m = new Map<string, MatchInfo>()
  const walk = (node: TreeNode) => {
    if (node.kind !== 'file') {
      for (const c of node.children) walk(c)
      return
    }
    const summary = summaryByPath.value.get(node.path) ?? ''
    const tags = postsByPath.value.get(node.path) ?? new Set<string>()
    const info: MatchInfo = {}
    // A file only reaches this walk if it already passed filterByQuery
    // — i.e. all tag needles hit at least one tag. So `info.tag` is a
    // simple boolean of "the query had any tag tokens AND this file
    // satisfied all of them" — we don't need to re-check per-tag.
    if (parsed.tagTokens.length > 0) {
      const tagOk = parsed.tagTokens.every((needle) =>
        [...tags].some((tag) => tag.toLowerCase().includes(needle)),
      )
      if (tagOk) info.tag = true
    }
    if (parsed.contentTokens.length > 0) {
      const nameLc = node.name.toLowerCase()
      const titleLc = node.title.toLowerCase()
      const summaryLc = summary.toLowerCase()
      for (const needle of parsed.contentTokens) {
        if (nameLc.includes(needle)) info.name = true
        if (titleLc.includes(needle)) info.title = true
        if (summaryLc.includes(needle)) info.summary = true
      }
    }
    if (info.tag || info.name || info.title || info.summary) m.set(node.path, info)
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

// Extract `#token`s out of the input value into `tagTokens`. A token
// is only extracted when it's complete: preceded by start-of-input
// or whitespace AND followed by whitespace. `#meta ` (with trailing
// space) becomes a chip; `#meta` typed alone stays as text in the
// input — the user hasn't committed the token yet (they might be
// about to type `#metadata`, etc). To commit a trailing token, the
// user types a space (or Esc clears everything). Tokens are matched
// as `[a-z0-9-]+` after the `#`; characters outside that set abort
// the match. Cursor is placed at the end of the stripped value so
// the user can continue typing seamlessly without manually
// repositioning.
function onContentInput(e: Event) {
  const input = e.target as HTMLInputElement
  const value = input.value
  const tokenRe = /(?:^|\s)(#[\w-]+)(?=\s)/g
  const extracted: string[] = []
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(value)) !== null) {
    const tag = m[1].slice(1).toLowerCase()
    if (tag && !tagTokens.value.includes(tag) && !extracted.includes(tag)) {
      extracted.push(tag)
    }
  }
  if (extracted.length > 0) {
    tagTokens.value = [...tagTokens.value, ...extracted]
  }
  const newValue = value.replace(tokenRe, '').replace(/^\s+/, '')
  contentText.value = newValue
  input.value = newValue
  input.setSelectionRange(newValue.length, newValue.length)
}

function removeTypedToken(tag: string) {
  tagTokens.value = tagTokens.value.filter((t) => t !== tag)
}

function clearContentText() {
  contentText.value = ''
}

function onQueryKeydown(e: KeyboardEvent) {
  // Esc inside the search box clears BOTH the typed tag chips and the
  // content text — the full search state — but does NOT propagate, so
  // the vault's global Esc handler (which closes panels / tabs)
  // doesn't fire on the same keypress. Mirrors the same escape on
  // TagPanel's tag-filter input.
  if (e.key === 'Escape' && (contentText.value || tagTokens.value.length)) {
    e.stopPropagation()
    contentText.value = ''
    tagTokens.value = []
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
  // of the Zettelkasten protocol and cannot be re-parented). Zettel children
  // are handled below because they may move inside zettel but not out of it.
  {
    const msg = blockedMessage(src, 'move')
    if (msg) { toast.error(msg); return }
  }
  if (isInZettel(src)) { toast.error('Zettel 笔记只能在 zettel 内移动'); return }
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
      const res = await renameFolder(oldPath, newPath)
      toast.success(`已重命名 (${res.moved.length} 项)`)
    } else {
      await patchPost(oldPath, { name: safeName })
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
  // editable according to the protocol. Dropping a non-zettel note directly
  // on zettel/ is still too vague, so the explicit archive action owns that
  // path. Existing zettel items may move within zettel for reclassification,
  // but not out into inbox/literature/root.
  const sourceInZettel = isInZettel(srcPath)
  const targetInZettel = isInZettel(targetFolder)
  if (!sourceInZettel && targetFolder === 'zettel') { toast.error('Zettel 是永久笔记，不能直接写入'); return }
  if (sourceInZettel && !targetInZettel) { toast.error('Zettel 笔记只能在 zettel 内移动'); return }
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

async function onSplitCard(path: string) {
  // The mode is derived from the path prefix — we don't ask the
  // user. The right-click context is unambiguous: a file under
  // inbox/ is inbox mode, under literature/ is literature mode.
  // The slash-command form in the AI panel lets the user pick, but
  // here the path IS the choice.
  const mode: 'inbox' | 'literature' = path.startsWith('literature/') || path === 'literature'
    ? 'literature'
    : 'inbox'
  emit('split-card', path, mode)
}

// Archive handler. Distinct from onMove: this is the explicit product action
// of promoting a finished note from inbox/ or literature/ straight into the
// zettel/ root. Classified archiving can also happen by dragging an eligible
// inbox/literature note onto a zettel subfolder; the server whitelist's
// "source must be in inbox/ or literature/" check backs up both paths.
async function onArchiveToZettel(path: string) {
  const filename = path.split('/').pop()!
  const targetPath = 'zettel/' + filename
  if (targetPath === path) return
  try {
    await patchPost(path, { targetPath })
    emit('refresh')
    if (props.currentPath === path) emit('select', targetPath)
    toast.success('已归档到 zettel')
  } catch (e: any) {
    toast.error('归档失败: ' + (e.message ?? '未知错误'))
  }
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
    aria-label="File explorer"
    :class="{ 'drop-target-root': isRootDropTarget }"
    @dragenter="onRootDragEnter"
    @dragleave="onRootDragLeave"
    @dragover="onRootDragOver"
    @drop="onRootDrop"
  >
    <header>
      <!-- Always-on search input. Filters the tree by file name /
           title / summary (case-insensitive, contains) and AND-composes
           with the tag chips inlined to the left of the input. Tag
           chips come from two sources:
             1. `activeTags` — tags clicked in TagPanel, persisted in
                useTagFilter; × removes via `remove-tag` emit.
             2. `tagTokens`  — `#tag` tokens extracted from typed input
                on whitespace/end boundaries; × removes locally.
           The native input only ever shows the content portion (after
           tag extraction), so the user sees their typed tags as styled
           chips and their plain search text in the input. -->
      <div class="search">
        <span class="search-icon" v-html="ICON_SEARCH" aria-hidden="true" />
        <span
          v-for="tag in activeTags"
          :key="`active-${tag}`"
          class="tag-filter-chip"
        >
          <span class="tag-filter-chip-name">#{{ tag }}</span>
          <button
            class="tag-filter-chip-x"
            :aria-label="`移除过滤 ${tag}`"
            :title="`移除过滤 ${tag}`"
            @click="emit('remove-tag', tag)"
          >×</button>
        </span>
        <span
          v-for="tag in tagTokens"
          :key="`typed-${tag}`"
          class="tag-filter-chip"
        >
          <span class="tag-filter-chip-name">#{{ tag }}</span>
          <button
            class="tag-filter-chip-x"
            :aria-label="`移除输入标签 ${tag}`"
            :title="`移除输入标签 ${tag}`"
            @click="removeTypedToken(tag)"
          >×</button>
        </span>
        <input
          v-model="contentText"
          class="search-input"
          type="text"
          placeholder="Search file"
          aria-label="搜索文件"
          @input="onContentInput"
          @keydown="onQueryKeydown"
        />
        <button
          v-if="contentText"
          class="search-clear-x"
          title="清空搜索"
          aria-label="清空搜索"
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
        :expanded-set="effectiveExpanded"
        :matched-fields="matchedFields"
        @select="onSelect"
        @toggle="onToggle"
        @rename="onRename"
        @request-rename="onRequestRename"
        @delete="onDelete"
        @move="onMove"
        @create-in="onCreateIn"
        @split-card="onSplitCard"
        @archive-to-zettel="onArchiveToZettel"
      />
    </ul>
    <p v-else-if="effectiveQuery && activeTags.length" class="empty">没有同时匹配 tag 和 “{{ effectiveQuery }}” 的文件。</p>
    <p v-else-if="effectiveQuery" class="empty">没有匹配 “{{ effectiveQuery }}” 的文件。</p>
    <p v-else-if="activeTags.length" class="empty">没有匹配这些 tag 的文件。</p>
    <p v-else class="empty">还没有文件。</p>
  </aside>
</template>
