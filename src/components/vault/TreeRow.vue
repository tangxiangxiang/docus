<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import type { TreeNode } from '../../lib/api'
import { ICON_FOLDER, ICON_FOLDER_OPEN, ICON_FILE_MD, ICON_CHEVRON } from './icons'

const props = defineProps<{
  node: TreeNode
  depth: number
  currentPath: string | null
  expandedSet: Set<string>
  isInZettel?: boolean
  isProtectedRoot?: boolean
}>()

const emit = defineEmits<{
  select: [path: string]
  toggle: [path: string]
  rename: [oldPath: string, newName: string]
  delete: [path: string]
  move: [srcPath: string, targetFolder: string]
  'create-in': [folder: string, kind: 'file' | 'folder']
}>()

const isFolder = computed(() => props.node.kind === 'folder')
const isActive = computed(() => !isFolder.value && props.node.path === props.currentPath)
const isExpanded = computed(() => isFolder.value && props.expandedSet.has(props.node.path))
// Two reasons a node's context menu can hide write actions:
//  - it's inside the read-only zettel subtree (entire subtree is locked)
//  - it's itself a protected top-level folder (inbox / literature / zettel),
//    which can hold children but can't be renamed/deleted/re-parented.
const readonly = computed(() => !!props.isInZettel || !!props.isProtectedRoot)
const readonlyReason = computed<'zettel' | 'root' | null>(() => {
  if (props.isInZettel) return 'zettel'
  if (props.isProtectedRoot) return 'root'
  return null
})

// --- drag state ---
const isDragging = ref(false)
const isDropTarget = ref(false)
const dragDepth = ref(0)

function onDragStart(e: DragEvent) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData('text/x-docus-path', props.node.path)
  e.dataTransfer.effectAllowed = 'move'
  isDragging.value = true
}
function onDragEnd() {
  isDragging.value = false
  isDropTarget.value = false
  dragDepth.value = 0
}

function onDragEnter(e: DragEvent) {
  if (!isFolder.value) return
  e.preventDefault()
  dragDepth.value++
  isDropTarget.value = true
}
function onDragLeave() {
  if (!isFolder.value) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) isDropTarget.value = false
}
function onDragOver(e: DragEvent) {
  if (!isFolder.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}
function onDrop(e: DragEvent) {
  if (!isFolder.value) return
  e.preventDefault()
  e.stopPropagation()
  const src = e.dataTransfer?.getData('text/x-docus-path') ?? ''
  if (!src) return
  isDropTarget.value = false
  dragDepth.value = 0
  emit('move', src, props.node.path)
}

// --- context menu ---
const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

function showMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  menuVisible.value = true
  menuX.value = e.clientX
  menuY.value = e.clientY
  nextTick(() => {
    document.addEventListener('click', closeMenu, { once: true })
    document.addEventListener('keydown', onMenuEscape)
  })
}
function closeMenu() {
  menuVisible.value = false
  document.removeEventListener('keydown', onMenuEscape)
}
function onMenuEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') closeMenu()
}
function menuAction(fn: () => void) {
  closeMenu()
  fn()
}

// --- inline rename state ---
const renaming = ref(false)
const renameValue = ref('')

function startRename() {
  renaming.value = true
  renameValue.value = props.node.name
  nextTick(() => {
    const el = document.getElementById('docus-rename-input-' + props.node.path) as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}
function commitRename() {
  const name = renameValue.value.trim()
  renaming.value = false
  if (!name || name === props.node.name) return
  emit('rename', props.node.path, name)
}
function cancelRename() {
  renaming.value = false
}
</script>

<template>
  <li
    class="tree-row"
    :class="{ active: isActive, expanded: isExpanded, folder: isFolder, dragging: isDragging, 'drop-target': isDropTarget }"
    :style="{ '--depth': depth }"
    :draggable="!renaming"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
    @contextmenu="showMenu"
  >
    <span
      v-if="isFolder"
      class="chevron"
      :class="{ expanded: isExpanded }"
      @click.stop="emit('toggle', node.path)"
      v-html="ICON_CHEVRON"
    />
    <span v-else class="chevron-spacer" />

    <span class="row-icon" v-if="isFolder" v-html="isExpanded ? ICON_FOLDER_OPEN : ICON_FOLDER" />
    <span class="row-icon" v-else v-html="ICON_FILE_MD" />

    <template v-if="renaming">
      <input
        :id="'docus-rename-input-' + node.path"
        v-model="renameValue"
        class="rename-input"
        @keydown.enter="commitRename"
        @keydown.escape="cancelRename"
        @blur="commitRename"
        @click.stop
      />
    </template>
    <template v-else>
      <a
        class="row-name"
        href="#"
        @click.prevent="isFolder ? emit('toggle', node.path) : emit('select', node.path)"
      >{{ node.name }}</a>
    </template>

    <Teleport to="body">
      <div
        v-if="menuVisible"
        class="tree-context-menu"
        :style="{ left: menuX + 'px', top: menuY + 'px' }"
        @click.stop
      >
        <template v-if="isFolder && !readonly">
          <button @click="menuAction(() => emit('create-in', node.path, 'file'))">新建文件</button>
          <button @click="menuAction(() => emit('create-in', node.path, 'folder'))">新建文件夹</button>
          <hr />
        </template>
        <button v-if="!readonly" @click="menuAction(startRename)">重命名</button>
        <hr v-if="!readonly" />
        <button v-if="!readonly" class="danger" @click="menuAction(() => emit('delete', node.path))">删除</button>
        <span v-if="readonly" class="readonly-hint">
          <template v-if="readonlyReason === 'zettel'">Zettel · 永久笔记</template>
          <template v-else>顶层目录 · 不可修改</template>
        </span>
      </div>
    </Teleport>

    <ul v-if="isFolder && isExpanded" class="tree-children">
      <TreeRow
        v-for="child in (node as any).children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :current-path="currentPath"
        :expanded-set="expandedSet"
        :is-in-zettel="isInZettel || (child.path === 'zettel' || child.path.startsWith('zettel/'))"
        :is-protected-root="child.path === 'inbox' || child.path === 'literature' || child.path === 'zettel'"
        @select="(p) => emit('select', p)"
        @toggle="(p) => emit('toggle', p)"
        @rename="(oldP, n) => emit('rename', oldP, n)"
        @delete="(p) => emit('delete', p)"
        @move="(src, folder) => emit('move', src, folder)"
        @create-in="(folder, kind) => emit('create-in', folder, kind)"
      />
    </ul>
  </li>
</template>
