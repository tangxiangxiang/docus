<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TreeNode } from '../../lib/api'
import TreeRow from './TreeRow.vue'
import { useConfirm } from '../../composables/useConfirm'
import { usePrompt } from '../../composables/usePrompt'
import { useToast } from '../../composables/useToast'
import { createPost, createFolder, patchPost, deletePost, renameFolder, deleteFolder } from '../../lib/api'
import { ICON_NEW_FILE, ICON_NEW_FOLDER } from './icons'

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
const expanded = ref<Set<string>>(new Set(loadExpanded()))

// Always keep the implicit content root folder expanded so its children render.
if (!expanded.value.has('')) {
  expanded.value.add('')
}

function isInZettel(path: string | null): boolean {
  if (!path) return false
  return path === 'zettel' || path.startsWith('zettel/')
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
  // Reject moves from zettel (it's read-only).
  if (isInZettel(src)) { toast.error('Zettel 是永久笔记，不能移动'); return }
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
function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.kind === 'folder') {
      const found = findNode(n.children, path)
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

async function onRename(oldPath: string, newName: string) {
  const node = findNode(props.tree, oldPath)
  if (!node) return
  if (isInZettel(oldPath)) { toast.error('Zettel 是永久笔记，不能重命名'); return }
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

async function onDelete(p: string) {
  const node = findNode(props.tree, p)
  if (!node) return
  if (isInZettel(p)) { toast.error('Zettel 是永久笔记，不能删除'); return }
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

async function onMove(srcPath: string, targetFolder: string) {
  if (isInZettel(srcPath)) { toast.error('Zettel 是永久笔记，不能移动'); return }
  if (isInZettel(targetFolder)) { toast.error('不能移动到 zettel'); return }
  const filename = srcPath.split('/').pop()!
  const newPath = targetFolder ? `${targetFolder}/${filename}` : filename
  if (newPath === srcPath) return
  // Cycle check
  const srcNode = findNode(props.tree, srcPath)
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
  if (isInZettel(folder)) { toast.error('Zettel 是永久笔记，不能直接新建'); return }
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
      <div class="header-actions">
        <button
          class="new-btn icon-btn"
          aria-label="新建文件"
          title="新建文件"
          @click="onCreateIn('inbox', 'file')"
          v-html="ICON_NEW_FILE"
        />
        <button
          class="new-btn icon-btn"
          aria-label="新建文件夹"
          title="新建文件夹"
          @click="onCreateIn('inbox', 'folder')"
          v-html="ICON_NEW_FOLDER"
        />
      </div>
    </header>
    <ul v-if="tree.length" class="tree" role="tree">
      <TreeRow
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :depth="0"
        :current-path="currentPath"
        :expanded-set="expanded"
        :is-in-zettel="isInZettel(node.path)"
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
